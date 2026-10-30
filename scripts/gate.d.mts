// Types for scripts/gate.mjs (plain Node ESM) so scripts/test/gate.test.ts is checked by `pnpm typecheck`.
export type Tier = 'quick' | 'light' | 'full';
export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}
export type Git = (args: string[]) => GitResult;
export interface Base {
  ref: string | null;
  commit: string | null;
  source: 'option' | 'env' | 'merge-base' | 'parent' | 'head' | 'none';
  /** true unless the base is explicit or merge-base(HEAD, origin/main). */
  fallback: boolean;
  notes: string[];
}
export interface Change {
  path: string;
  deleted: boolean;
}
export interface WorkspacePackage {
  dir: string;
  name: string;
  /** Names of the workspace packages this package depends on. */
  dependencies?: string[];
}
export interface Classification {
  all: string[];
  present: string[];
  deleted: string[];
  deletedSources: string[];
  formattable: string[];
  lintable: string[];
  markdown: string[];
  typecheck: boolean;
  boundaries: boolean;
  apps: { api: boolean; web: boolean };
  browserSpecs: string[];
  deploy: string[];
  widen: { format: string[]; eslint: string[]; unit: string[] };
  packages: string[];
}
export interface EscalationReason {
  path: string;
  rule: string;
  why: string;
  widenDb: boolean;
}
export interface Escalation {
  required: boolean;
  widenDb: boolean;
  reasons: EscalationReason[];
}
export interface EscalationRule {
  pattern: string;
  exclude?: string[];
  widenDb: boolean;
  why: string;
}
export interface Options {
  help: false;
  tier: Tier;
  base: string | undefined;
  keepGoing: boolean;
  dryRun: boolean;
  withSmoke: boolean;
  withoutBrowser: boolean;
  provision: boolean;
  playwrightArgs: string[];
  /** light: defer migration/setup DB suites without a schema-relevant change (false with GATE_DEFER_SCHEMA_SUITES=0). */
  deferSchemaSuites?: boolean;
  /** CLI --serial (light only): one step at a time and one DB process. */
  serial?: boolean;
  /** CLI --db-shards as given (light only); resolveConcurrency validates it. */
  dbShardsOption?: string;
  /** light: run the static lane and the DB lane side by side (resolveConcurrency). Absent means one step at a time. */
  parallel?: boolean;
  /** light: split the DB step over this many test databases (resolveConcurrency). Absent means 1. */
  dbShards?: number;
}
export interface Command {
  program: 'pnpm' | 'node';
  args: string[];
}
export interface Selection {
  project: 'unit' | 'db';
  sources: string[];
  triggers: string[];
  extra: string[];
  /** light DB only: defer graph-selected migration/setup suites without a schema-relevant change. */
  deferSchemaSuites?: boolean;
  /** escalated light DB split over shards: every test file of the project. */
  all?: boolean;
}
export interface Selected {
  files: number;
  total?: number;
  via?: Record<string, number>;
  deferred?: number;
}
export interface Step {
  id: string;
  command: Command | null;
  env: Record<string, string>;
  selection: Selection | null;
  skip: { result: 'skipped' | 'no-target'; reason: string } | null;
  blocked: string | null;
  special: 'browser:prepare' | 'browser' | 'smoke' | 'identity' | null;
  note: string | null;
  selected?: Selected | undefined;
  selectedFiles?: string[] | undefined;
  deferredFiles?: string[] | undefined;
  /** parallel light: steps of one lane run in order; lanes of one phase run side by side. */
  lane?: string | undefined;
  /** light DB: the number of shard databases asked for. */
  shards?: number | undefined;
  /** parallel light: seconds from the first step's start to this step's start. */
  offset?: number | undefined;
  /** parallel light: the step's output file, relative to the repository root. */
  log?: string | undefined;
  /** parallel light: vitest FAIL lines of the failed step's log ("<file> > <suite> > <test>"). */
  failed?: string[] | undefined;
  shardResults?: ShardResult[] | undefined;
}
export interface ShardResult {
  index: number;
  database: string;
  files: number;
  paths: string[];
  estimate: number;
  seconds: number;
  result: string;
  reason: string | null;
  /** vitest FAIL lines of a failed shard's log (at most MAX_FAILED_TESTS). */
  failed?: string[];
  log: string | null;
}
export interface ShardDatabase {
  index: number;
  database: string;
  ownerUrl: string;
  appUrl: string;
}
export interface Concurrency {
  parallel: boolean;
  dbShards: number;
  notes: string[];
}
export interface StepResult extends Step {
  result: string;
  seconds: number;
  reason: string | null;
}
export interface SelectionResult {
  project: 'unit' | 'db';
  total: number;
  /** `reasons`: every rule that selected the file, when more than one did (`via` is the first). */
  selected: { file: string; via: string; reasons?: string[] }[];
  deferred?: { file: string; reason: string }[];
  schemaReasons?: SchemaReason[];
}
export interface SchemaReason {
  path: string;
  why: string;
}
export interface ReportStep {
  id: string;
  result: string;
  seconds: number;
  lane: string | null;
  offset: number | null;
  selected: Selected | null;
  deferred: string[];
  shards: ShardResult[] | null;
  command: string;
  summary: string;
  log: string | null;
  failed: string[];
  note: string | null;
  reason: string | null;
}
export interface Report {
  schema: 1;
  tier: Tier;
  result: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  seconds: number;
  head: string | null;
  base: Base;
  baseFallback: boolean;
  changed: { count: number; deleted: number; files: string[]; truncated: boolean };
  packages: string[];
  escalation: { required: boolean; widenDb: boolean; message: string | null; reasons: EscalationReason[] };
  partial: boolean;
  partialReasons: string[];
  skipped: { id: string; result: string; reason: string | null }[];
  concurrency: Concurrency;
  steps: ReportStep[];
  options: {
    keepGoing: boolean;
    withSmoke: boolean;
    withoutBrowser: boolean;
    provision: boolean;
    playwrightArgs: string[];
  };
  provisioned: { databases: string[]; ports: Record<string, number> } | null;
  hints: string[];
}

export const ROOT: string;
export const TIERS: readonly Tier[];
export const FORMAT_EXTENSIONS: ReadonlySet<string>;
export const LINT_EXTENSIONS: ReadonlySet<string>;
export const MODULE_EXTENSIONS: ReadonlySet<string>;
export const FILE_ARGUMENT_LIMIT: number;
export const MAX_REPORTED_FILES: number;
export const ALWAYS_DB_SUITES: readonly string[];
export const ESCALATION_RULES: readonly EscalationRule[];
export const WIDEN_RULES: Readonly<{ format: string[]; eslint: string[]; unit: string[] }>;
export const TYPECHECK_ALL: readonly string[];
export const DEPLOY_PATTERNS: readonly string[];
export const E2E_DATABASE_NAME: RegExp;
export const IDENTITY_DATABASE_NAME: RegExp;
export const TEST_DATABASE_NAME: RegExp;
export const CHANGED_FILES_IN_TABLE: number;
export const STOP_GRACE_MS: number;
export const MAX_DB_SHARDS: number;
export const SHARD_INFIX: string;
export const SHARD_NAME_LIMIT: number;
export const SHARD_DATABASE_NAME: RegExp;
export const DEFAULT_SUITE_SECONDS: number;
export const FAILURE_TAIL_LINES: number;
export const MAX_FAILED_TESTS: number;
export const DURATIONS_FILE: string;
export const BASE_FALLBACK_REFS: readonly string[];
export const GUIDANCE: Readonly<Record<'testDb' | 'browser' | 'identity' | 'provision' | 'smoke', string>>;
export const USAGE: string;
export class GateUsageError extends Error {}
export class StepError extends Error {
  constructor(message: string, details?: Partial<Step>);
  details: Partial<Step>;
}

export function globToRegExp(pattern: string): RegExp;
export function matchesAny(path: string, patterns: readonly string[]): boolean;
export function matchesRule(path: string, rule: Pick<EscalationRule, 'pattern' | 'exclude'>): boolean;
export function isTestFile(path: string): boolean;
export function isDeletedSource(change: Change): boolean;
export function quoteArg(arg: string): string;
export function commandText(command: Command | null): string;
export function commandSummary(command: Command | null): string;
export function resolveBase(input: {
  explicit?: string | undefined;
  env?: Record<string, string | undefined>;
  git: Git;
}): Base;
export function collectChangeSet(input: { base: Base; git: Git; exists: (path: string) => boolean }): Change[];
export function parseWorkspacePatterns(yaml: string): string[];
export function loadWorkspacePackages(root?: string): WorkspacePackage[];
export function packageOf(path: string, packages: readonly WorkspacePackage[]): WorkspacePackage | null;
export function workspaceClosure(name: string, packages: readonly WorkspacePackage[]): string[];
export function classifyChanges(changes: readonly Change[], packages?: readonly WorkspacePackage[]): Classification;
export function detectEscalation(changes: readonly Change[], rules?: readonly EscalationRule[]): Escalation;
export function referenceTriggers(paths: readonly string[]): string[];
export function selectByReference(
  triggers: readonly string[],
  specFiles: readonly string[],
  readText: (file: string) => string,
): string[];
export function selectByTestDirectory(paths: readonly string[], specFiles: readonly string[]): string[];
export function spawnsProcesses(text: string): boolean;
export function scopeOf(path: string, packages: readonly WorkspacePackage[]): string | null;
export function selectBySubprocessScope(
  paths: readonly string[],
  spawningSpecs: readonly string[],
  packages: readonly WorkspacePackage[],
): string[];
export function subprocessEntries(
  spec: string,
  text: string,
  scope: string | null,
  exists: (path: string) => boolean,
): string[];
export function setupFileTargets(text: string, specFiles: readonly string[]): string[];
export function buildsSchemaFromMigrations(text: string, readSibling?: (relativePath: string) => string): boolean;
export function declaresSchema(text: string): boolean;
export function deferSchemaSuites(
  selected: readonly { file: string; via: string; reasons?: readonly string[] }[],
  input: {
    changed: readonly string[];
    declaring?: readonly string[];
    reached?: readonly string[];
    schemaSuites: ReadonlySet<string>;
    packages?: readonly WorkspacePackage[];
  },
): {
  selected: { file: string; via: string; reasons?: readonly string[] }[];
  deferred: { file: string; reason: string }[];
  reasons: SchemaReason[];
};
export function parseGateScript(script: string): string[] | null;
export function planSteps(input: {
  tier: Tier;
  cls: Classification;
  base: Base;
  escalation: Escalation;
  options: Options;
  gateScripts?: string[] | null;
}): Step[];
export function defaultDbShards(cpus: number): number;
export function resolveConcurrency(
  input: { tier: Tier; serial?: boolean; dbShards?: string | number | undefined },
  env?: Record<string, string | undefined>,
  cpus?: number,
): Concurrency;
export function shardDatabaseName(database: string, index: number): string;
export function shardDatabases(
  env: Record<string, string | undefined>,
  count: number,
): { shards: ShardDatabase[]; reason: string | null };
export function parseSuiteDurations(texts: readonly string[], project?: string): Map<string, number>;
export function parseGateDurations(text: string, project?: string): Map<string, number>;
export function readSuiteDurations(root?: string, project?: string): Map<string, number>;
export function captureSuiteDurations(files: readonly string[], root?: string, project?: string): Map<string, number>;
export function recordSuiteDurations(measured: ReadonlyMap<string, number>, root?: string, project?: string): void;
export function partitionShards(
  files: readonly string[],
  durations: ReadonlyMap<string, number>,
  count: number,
): { files: string[]; estimate: number }[];
export function planShards(
  step: Pick<Step, 'selectedFiles' | 'shards'>,
  durations: ReadonlyMap<string, number>,
  available: readonly ShardDatabase[],
): (ShardDatabase & { files: string[]; estimate: number })[];
export function planPhases<T extends Pick<Step, 'lane'>>(steps: readonly T[]): { index: number; item: T }[][][];
export function testSummary(text: string): string;
export function failedTests(text: string): string[];
export function failedFiles(tests: readonly string[]): string[];
export function provisionTargets(env: Record<string, string | undefined>): { owner: URL; app: URL } | null;
export function testDatabaseProblems(env: Record<string, string | undefined>): string[];
export function testDatabaseLabel(env: Record<string, string | undefined>, shards?: number): string;
export function smokePrerequisites(
  env: Record<string, string | undefined>,
  reach?: { api?: boolean; web?: boolean },
): string[];
export function browserPrerequisites(
  env: Record<string, string | undefined>,
  reach?: { api?: boolean; web?: boolean },
): string[];
export function applyPreflight(
  steps: readonly Step[],
  input: { env: Record<string, string | undefined>; options: Options; reach?: { api?: boolean; web?: boolean } },
): Step[];
export function applySelection(step: Step, selection: SelectionResult, root?: string): Step;
export function runSteps(
  steps: readonly Step[],
  input: {
    keepGoing?: boolean;
    execute: (step: Step) => Promise<{
      ok: boolean;
      result?: string;
      reason?: string | null;
      interrupted?: boolean;
      cancelled?: boolean;
      /** Fields merged into the step result (log, note, shardResults). */
      details?: Partial<Step>;
    }>;
    prepare?: (step: Step) => Promise<Step>;
    now?: () => number;
    isInterrupted?: () => boolean;
    /**
     * Fail-fast with lanes: stop the steps still running in other lanes (`runningIds`; their result becomes
     * "cancelled").
     */
    cancel?: (failedId: string, runningIds: string[]) => void;
  },
): Promise<{ steps: StepResult[]; ok: boolean; interrupted: boolean }>;
export function buildReport(input: {
  tier: Tier;
  options: Options;
  base: Base;
  head?: string | null;
  changes: readonly Change[];
  cls: Classification;
  escalation: Escalation;
  steps: readonly (Step & { result: string; seconds?: number; reason?: string | null })[];
  startedAt: Date;
  finishedAt: Date;
  result: string;
  provisioned?: { databases: string[]; ports: Record<string, number> } | null;
  concurrency?: Concurrency | null;
}): Report;
export function formatTable(report: Report): string;
export function baseWarning(base: Base): string;
export function reportFileName(tier: Tier, startedAt: Date): string;
export function parseCli(argv: string[]): Options | { help: true };
export function gitRunner(cwd?: string): Git;
export function provisionDatabaseName(kind: 'e2e' | 'identity', now?: Date, random?: string): string;
export function databaseUrl(url: URL, name: string): string;
type Env = Record<string, string | undefined>;
export function scrubbedEnv(env: Env, keep?: readonly string[]): Env;
export function identityStepEnv(env: Env, provisioned?: { owner: string; app: string } | null): Env;
export function browserFixtureEnv(env: Env, fixture: { owner: string; app: string; date: string }): Env;
export function provisionGuard(
  step: Pick<Step, 'special'>,
  state: { provision: boolean; browserEnv: Env | null; passed: readonly string[]; planned: readonly string[] },
): string | null;
export interface Session {
  runDir: string;
  databases: string[];
  ports: Record<string, number>;
  browserEnv: Env | null;
  interrupted: number | null;
  passed: string[];
  planned: string[];
  /** Running step commands and the id of the step that started each. */
  running: Map<unknown, string | null>;
  cancelled: Set<string>;
  /** Notes for the report's concurrency (shard databases created, one DB process and why). */
  notes: string[];
  dryRun?: boolean;
  interruptCurrent(signal: NodeJS.Signals): void;
  cancelOthers(failedId: string, ids?: readonly string[]): void;
  stop(): Promise<void>;
}
export function createSession(runDir: string): Session;
export interface CommandOutcome {
  ok: boolean;
  reason?: string | null;
  interrupted?: boolean;
  cancelled?: boolean;
}
export type RunCommand = (
  command: Command,
  env: Env,
  session: Session,
  options: { log?: string | undefined; owner?: string | null },
) => Promise<CommandOutcome>;
export type EnsureShardDatabases = (shards: readonly ShardDatabase[], env: Env) => Promise<string[]>;
export function availableShards(
  step: Pick<Step, 'shards' | 'selectedFiles'>,
  session: Pick<Session, 'dryRun'>,
  deps?: { env?: Env; ensure?: EnsureShardDatabases },
): Promise<{ available: ShardDatabase[]; notes: string[] }>;
export function runShardedDb(
  step: Step,
  session: Session,
  deps?: { env?: Env; run?: RunCommand; ensure?: EnsureShardDatabases; root?: string; print?: (line: string) => void },
): Promise<CommandOutcome & { details: Partial<Step> }>;
export function prepareBrowserFixture(session: Session): Promise<{ ok: boolean }>;
