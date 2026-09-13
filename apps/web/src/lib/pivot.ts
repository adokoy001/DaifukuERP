import { parseDecimalString } from './decimal.ts';

/** Browser exploration limits include subtotal cells, so a sparse cube never allocates a dense product. */
export const MAX_PIVOT_ROWS = 50_000;
export const MAX_PIVOT_STATES = 100_000;
export const PIVOT_AVERAGE_MIN_SCALE = 6;
const MAX_DECIMAL_DIGITS = 128;
const MAX_DECIMAL_SCALE = 30;

export type PivotGrain = 'value' | 'year' | 'quarter' | 'month' | 'day';
export type PivotOperation = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'rows';
export interface PivotAxis { field: string; grain?: PivotGrain }
export interface PivotMeasure { field: string; op: PivotOperation }
export interface PivotConfig { rows: PivotAxis[]; columns: PivotAxis[]; measures: PivotMeasure[] }
export interface PivotNode {
  key: string;
  path: (string | null)[];
  depth: number;
  parent: string | null;
  children: string[];
  label: string;
}
export interface PivotResult {
  rowNodes: PivotNode[];
  columnNodes: PivotNode[];
  /** Missing combinations have no cell. Null means that the metric has no numeric observations. */
  cells: Record<string, (string | null)[]>;
  rowCount: number;
  cellCount: number;
  measureCount: number;
}
export type PivotErrorCode = 'invalid_config' | 'row_limit' | 'cell_limit' | 'invalid_date' | 'invalid_value';
export class PivotError extends Error {
  constructor(readonly code: PivotErrorCode) { super(code); this.name = 'PivotError'; }
}
export const PIVOT_ROOT_KEY = '[]';
export function cellKey(rowKey: string, columnKey: string): string { return JSON.stringify([rowKey, columnKey]); }

interface Decimal { coefficient: bigint; scale: number }
interface Aggregate { value: Decimal | null; count: number }
interface Observation { value: Decimal | null; present: boolean }
const powers: bigint[] = [1n];
function defined<T>(value: T | undefined): T { if (value === undefined) throw new PivotError('invalid_value'); return value; }
function power(scale: number): bigint {
  while (powers.length <= scale) powers.push(defined(powers[powers.length - 1]) * 10n);
  return defined(powers[scale]);
}
function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return { coefficient: a.coefficient * power(scale - a.scale) + b.coefficient * power(scale - b.scale), scale };
}
function compare(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale);
  const difference = a.coefficient * power(scale - a.scale) - b.coefficient * power(scale - b.scale);
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}
function format(value: Decimal): string {
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient).toString();
  if (value.scale === 0) return `${negative ? '-' : ''}${digits}`;
  const padded = digits.padStart(value.scale + 1, '0');
  const fraction = padded.slice(-value.scale).replace(/0+$/, '');
  const integer = padded.slice(0, -value.scale);
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}
/** Mean is rounded half away from zero, to at least six places, preserving a finer input scale. */
function average(value: Decimal, count: number): Decimal {
  const scale = Math.max(PIVOT_AVERAGE_MIN_SCALE, value.scale);
  const numerator = value.coefficient * power(scale - value.scale);
  const denominator = BigInt(count);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if ((remainder < 0n ? -remainder : remainder) * 2n >= denominator) quotient += numerator < 0n ? -1n : 1n;
  return { coefficient: quotient, scale };
}
function decimal(input: unknown): Decimal | null {
  if (input === null || input === undefined || input === '') return null;
  // Decimal amounts arrive as strings. Integer count/minute fields may arrive as safe numbers.
  if (typeof input !== 'string' && (typeof input !== 'number' || !Number.isSafeInteger(input))) throw new PivotError('invalid_value');
  const source = String(input).trim();
  if (source === '') return null;
  if (source.length > MAX_DECIMAL_DIGITS + 3) throw new PivotError('invalid_value');
  const parsed = parseDecimalString(source);
  if (!parsed || parsed.int.length + parsed.frac.length > MAX_DECIMAL_DIGITS || parsed.frac.length > MAX_DECIMAL_SCALE) throw new PivotError('invalid_value');
  const coefficient = BigInt(`${parsed.int}${parsed.frac}`);
  return { coefficient: parsed.neg ? -coefficient : coefficient, scale: parsed.frac.length };
}
function present(input: unknown): boolean {
  if (input === null || input === undefined) return false;
  if (typeof input === 'string') return input.trim() !== '';
  if (typeof input === 'boolean') return true;
  if (typeof input === 'number' && Number.isFinite(input)) return true;
  throw new PivotError('invalid_value');
}
function fieldValue(row: Record<string, unknown>, field: string): unknown {
  return Object.hasOwn(row, field) ? row[field] : undefined;
}
function calendarValue(input: string, grain: Exclude<PivotGrain, 'value'>): string {
  // Use the recorded calendar date, never the browser's time zone. Reject impossible dates.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(input);
  if (!match) throw new PivotError('invalid_date');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0) || (input.length > 10 && (!Number.isFinite(Date.parse(input)) || Number(input.slice(11, 13)) > 23))) throw new PivotError('invalid_date');
  if (grain === 'year') return defined(match[1]);
  if (grain === 'quarter') return `${match[1]}-Q${Math.ceil(month / 3)}`;
  if (grain === 'month') return `${match[1]}-${match[2]}`;
  return input.slice(0, 10);
}
function axisValue(row: Record<string, unknown>, axis: PivotAxis): string | null {
  const value = fieldValue(row, axis.field);
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value))) throw new PivotError('invalid_value');
  const label = String(value);
  if (label.length > 2_048) throw new PivotError('invalid_value');
  if (!axis.grain || axis.grain === 'value') return label;
  return calendarValue(label, axis.grain);
}
const grains = new Set(['value', 'year', 'quarter', 'month', 'day']);
const operations = new Set(['sum', 'avg', 'min', 'max', 'count', 'rows']);
function validField(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128; }
/** Runtime validation also protects settings imported from browser storage. */
export function validatePivotConfig(config: PivotConfig): void {
  if (!config || !Array.isArray(config.rows) || !Array.isArray(config.columns) || !Array.isArray(config.measures)
    || config.rows.length > 3 || config.columns.length > 3 || config.measures.length < 1 || config.measures.length > 3) throw new PivotError('invalid_config');
  for (const axes of [config.rows, config.columns]) {
    const seen = new Set<string>();
    for (const axis of axes) {
      if (!axis || !validField(axis.field) || (axis.grain !== undefined && !grains.has(axis.grain))) throw new PivotError('invalid_config');
      const key = JSON.stringify([axis.field, axis.grain ?? 'value']);
      if (seen.has(key)) throw new PivotError('invalid_config');
      seen.add(key);
    }
  }
  for (const measure of config.measures) {
    if (!measure || !validField(measure.field) || !operations.has(measure.op)) throw new PivotError('invalid_config');
  }
}
function root(): PivotNode { return { key: PIVOT_ROOT_KEY, path: [], depth: 0, parent: null, children: [], label: '総計' }; }
function ensurePath(nodes: Map<string, PivotNode>, path: (string | null)[]): string[] {
  const keys = [PIVOT_ROOT_KEY];
  for (let depth = 1; depth <= path.length; depth++) {
    const prefix = path.slice(0, depth), key = JSON.stringify(prefix), parent = defined(keys[depth - 1]);
    keys.push(key);
    if (nodes.has(key)) continue;
    const value = defined(prefix[depth - 1]);
    nodes.set(key, { key, path: prefix, depth, parent, children: [], label: value === null ? '(未設定)' : value === '' ? '(空文字)' : value });
    defined(nodes.get(parent)).children.push(key);
  }
  return keys;
}
const collator = new Intl.Collator('ja', { numeric: true });
function sortedNodes(nodes: Map<string, PivotNode>): PivotNode[] {
  for (const node of nodes.values()) node.children.sort((a, b) => {
    const va = defined(defined(nodes.get(a)).path.at(-1)), vb = defined(defined(nodes.get(b)).path.at(-1));
    if (va === null) return vb === null ? 0 : 1;
    if (vb === null) return -1;
    return collator.compare(va, vb) || (a < b ? -1 : a > b ? 1 : 0);
  });
  const ordered: PivotNode[] = [];
  const visit = (key: string) => { const node = defined(nodes.get(key)); ordered.push(node); node.children.forEach(visit); };
  visit(PIVOT_ROOT_KEY);
  return ordered;
}
/** Root is always open. Expand a node to show its immediate children and expanded descendants. */
export function visibleNodes(nodes: readonly PivotNode[], expanded: ReadonlySet<string>): PivotNode[] {
  const index = new Map(nodes.map(node => [node.key, node])), visible: PivotNode[] = [];
  const visit = (key: string) => {
    const node = index.get(key);
    if (!node) return;
    visible.push(node);
    if (node.depth === 0 || expanded.has(node.key)) node.children.forEach(visit);
  };
  visit(PIVOT_ROOT_KEY);
  return visible;
}
function observe(row: Record<string, unknown>, measure: PivotMeasure): Observation {
  if (measure.op === 'rows') return { value: null, present: true };
  const input = fieldValue(row, measure.field);
  return measure.op === 'count' ? { value: null, present: present(input) } : { value: decimal(input), present: false };
}
function accumulate(state: Aggregate, observation: Observation, op: PivotOperation): void {
  if (op === 'rows' || op === 'count') { if (observation.present) state.count++; return; }
  const value = observation.value;
  if (value === null) return;
  state.count++;
  if (state.value === null) state.value = value;
  else if (op === 'sum' || op === 'avg') state.value = add(state.value, value);
  else if ((op === 'min' && compare(value, state.value) < 0) || (op === 'max' && compare(value, state.value) > 0)) state.value = value;
}
function resultValue(state: Aggregate, op: PivotOperation): string | null {
  if (op === 'rows' || op === 'count') return String(state.count);
  if (state.value === null) return null;
  return format(op === 'avg' ? average(state.value, state.count) : state.value);
}

/** Every subtotal receives raw observations; means are never combined as a mean of means. */
export function pivot(rows: readonly Record<string, unknown>[], config: PivotConfig): PivotResult {
  validatePivotConfig(config);
  if (!Array.isArray(rows)) throw new PivotError('invalid_value');
  if (rows.length > MAX_PIVOT_ROWS) throw new PivotError('row_limit');
  const rowNodes = new Map([[PIVOT_ROOT_KEY, root()]]), columnNodes = new Map([[PIVOT_ROOT_KEY, root()]]);
  const states = new Map<string, Aggregate[]>();
  const getCell = (rowKey: string, columnKey: string): Aggregate[] => {
    const key = cellKey(rowKey, columnKey);
    let aggregates = states.get(key);
    if (!aggregates) {
      if ((states.size + 1) * config.measures.length > MAX_PIVOT_STATES) throw new PivotError('cell_limit');
      aggregates = config.measures.map(() => ({ value: null, count: 0 }));
      states.set(key, aggregates);
    }
    return aggregates;
  };
  // Even an empty snapshot has explicit record counts of zero and missing numeric totals.
  getCell(PIVOT_ROOT_KEY, PIVOT_ROOT_KEY);
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new PivotError('invalid_value');
    const rowKeys = ensurePath(rowNodes, config.rows.map(axis => axisValue(row, axis)));
    const columnKeys = ensurePath(columnNodes, config.columns.map(axis => axisValue(row, axis)));
    const observations = config.measures.map(measure => observe(row, measure));
    for (const rowKey of rowKeys) for (const columnKey of columnKeys) {
      const aggregates = getCell(rowKey, columnKey);
      for (let i = 0; i < config.measures.length; i++) accumulate(defined(aggregates[i]), defined(observations[i]), defined(config.measures[i]).op);
    }
  }
  const cells: PivotResult['cells'] = {};
  for (const [key, aggregates] of states) cells[key] = aggregates.map((state, i) => resultValue(state, defined(config.measures[i]).op));
  return { rowNodes: sortedNodes(rowNodes), columnNodes: sortedNodes(columnNodes), cells, rowCount: rows.length, cellCount: states.size, measureCount: config.measures.length };
}
