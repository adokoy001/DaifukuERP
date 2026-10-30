// Types for scripts/pack-new.mjs (plain Node ESM) so scripts/test/pack-new*.test.ts are checked by `pnpm typecheck`.
export interface PackNames {
  kebab: string;
  snake: string;
  pascal: string;
  camel: string;
  code: string;
  dir: string;
  packageName: string;
  packExport: string;
  entity: string;
  entityExport: string;
  entityFile: string;
  action: string;
  extKey: string;
  sampleCode: string;
  spec: string;
  migration: string;
}
export interface PackLabels {
  ja: string;
  en: string;
  jaDefaulted: boolean;
  warnings: string[];
}
export interface PackNewArgs {
  help: false;
  name: string;
  register: boolean;
  dryRun: boolean;
  root: string;
  labelJa?: string;
  labelEn?: string;
}
export interface PlannedFile {
  path: string;
  content: string;
}
export interface PlannedEdit {
  path: string;
  before: string;
  after: string;
}
export interface PackPlan {
  packDir: string;
  specPath: string;
  files: PlannedFile[];
  edits: PlannedEdit[];
  steps: string[];
}
export interface Collisions {
  problems: string[];
  warnings: string[];
}
export interface SignalSource {
  on(event: 'SIGINT' | 'SIGTERM', listener: (signal: NodeJS.Signals) => void): unknown;
  off(event: 'SIGINT' | 'SIGTERM', listener: (signal: NodeJS.Signals) => void): unknown;
}
export interface PackNewIo {
  /** Returns the first directory created, or undefined when it already existed (mkdirSync recursive). */
  mkdir(path: string): string | undefined;
  mkdtemp(prefix: string): string;
  writeFile(path: string, content: string, flag?: string): void;
  readFile(path: string): string;
  rename(from: string, to: string): void;
  remove(path: string): void;
  exists(path: string): boolean;
  signals: SignalSource;
}
export interface Writable {
  write(chunk: string): unknown;
}

export const ROOT: string;
export const TEMPLATE_DIR: string;
export const NAME_PATTERN: RegExp;
export const NAME_MIN: number;
export const NAME_MAX: number;
export const LABEL_MAX: number;
export const RESERVED_NAMES: readonly string[];
export const DECLARATION_DIRS: readonly string[];
export const EXT_KEY_DIRS: readonly string[];
export const STAGING_DIR: string;
export const REGISTER_FILES: Readonly<{
  catalog: string;
  runtimePackage: string;
  runtimeTest: string;
  workforceSpec: string;
}>;
export const CATALOG_TEST_MARKER: string;
export const TEMPLATE_COUNT_PATTERN: RegExp;
export const TEMPLATE_FILES: readonly (readonly [string, (names: PackNames) => string])[];
export const USAGE: string;
export const defaultIo: Readonly<PackNewIo>;

export class PackNewUsageError extends Error {}
export class PackNewError extends Error {
  constructor(message: string, problems?: string[]);
  problems: string[];
}
export class PackNewInterrupted extends Error {
  constructor(signal: NodeJS.Signals);
  signal: NodeJS.Signals;
  problems?: string[];
}

export function parsePackNewArgs(argv: string[]): PackNewArgs | { help: true };
export function packNames(kebab: string): PackNames;
export function validatePackName(name: unknown): string[];
export function validateLabel(text: string, option: string): string[];
export function defaultLabels(names: PackNames, given?: { labelJa?: string; labelEn?: string }): PackLabels;
export function catalogKeys(text: string): string[];
export function stagingLeftovers(root: string): string[];
export function findCollisions(root: string, names: PackNames): Collisions;
export function escapeMarkdown(text: string): string;
export function renderTemplate(template: string, values: Record<string, string>, source?: string): string;
export function registrationLines(
  names: PackNames,
  count: number | null,
): { catalog: string; runtimePackage: string; runtimeTest: string; workforceSpec: string };
export function nextSteps(names: PackNames, options: { register: boolean; count?: number | null }): string[];
export function planPack(input: {
  root: string;
  names: PackNames;
  labels: PackLabels;
  today: string;
  register: boolean;
}): Promise<PackPlan>;
export function assertTargets(
  root: string,
  plan: Pick<PackPlan, 'packDir' | 'specPath'>,
): { target: string; spec: string };
export function writePlan(
  plan: PackPlan,
  root: string,
  overrides?: Partial<PackNewIo>,
): Promise<{ created: string[]; edited: string[] }>;
export function lineDiff(before: string, after: string, context?: number): string[];
export function main(
  argv: string[],
  options?: { stdout?: Writable; stderr?: Writable; today?: string; io?: Partial<PackNewIo> },
): Promise<number>;
