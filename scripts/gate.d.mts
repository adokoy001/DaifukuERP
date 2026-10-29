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
  notes: string[];
}
export interface Change {
  path: string;
  deleted: boolean;
}
export interface WorkspacePackage {
  dir: string;
  name: string;
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
}
export interface Escalation {
  required: boolean;
  reasons: EscalationReason[];
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
}
export interface Selected {
  files: number;
  total?: number;
  via?: Record<string, number>;
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
}
export interface StepResult extends Step {
  result: string;
  seconds: number;
  reason: string | null;
}
export interface SelectionResult {
  project: 'unit' | 'db';
  total: number;
  selected: { file: string; via: string }[];
}
export interface ReportStep {
  id: string;
  result: string;
  seconds: number;
  selected: Selected | null;
  command: string;
  summary: string;
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
  changed: { count: number; deleted: number; files: string[]; truncated: boolean };
  packages: string[];
  escalation: { required: boolean; message: string | null; reasons: EscalationReason[] };
  partial: boolean;
  partialReasons: string[];
  skipped: { id: string; result: string; reason: string | null }[];
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
export const ESCALATION_RULES: readonly { pattern: string; why: string }[];
export const WIDEN_RULES: Readonly<{ format: string[]; eslint: string[]; unit: string[] }>;
export const DEPLOY_PATTERNS: readonly string[];
export const E2E_DATABASE_NAME: RegExp;
export const IDENTITY_DATABASE_NAME: RegExp;
export const GUIDANCE: Readonly<Record<'testDb' | 'browser' | 'identity' | 'provision' | 'smoke', string>>;
export const USAGE: string;
export class GateUsageError extends Error {}

export function globToRegExp(pattern: string): RegExp;
export function matchesAny(path: string, patterns: readonly string[]): boolean;
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
export function classifyChanges(changes: readonly Change[], packages?: readonly WorkspacePackage[]): Classification;
export function detectEscalation(
  changes: readonly Change[],
  rules?: readonly { pattern: string; why: string }[],
): Escalation;
export function referenceTriggers(paths: readonly string[]): string[];
export function selectByReference(
  triggers: readonly string[],
  specFiles: readonly string[],
  readText: (file: string) => string,
): string[];
export function selectByTestDirectory(paths: readonly string[], specFiles: readonly string[]): string[];
export function parseGateScript(script: string): string[] | null;
export function planSteps(input: {
  tier: Tier;
  cls: Classification;
  base: Base;
  escalation: Escalation;
  options: Options;
  gateScripts?: string[] | null;
}): Step[];
export function provisionTargets(env: Record<string, string | undefined>): { owner: URL; app: URL } | null;
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
    execute: (step: Step) => Promise<{ ok: boolean; result?: string; reason?: string | null; interrupted?: boolean }>;
    prepare?: (step: Step) => Promise<Step>;
    now?: () => number;
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
}): Report;
export function formatTable(report: Report): string;
export function reportFileName(tier: Tier, startedAt: Date): string;
export function parseCli(argv: string[]): Options | { help: true };
export function gitRunner(cwd?: string): Git;
export function provisionDatabaseName(kind: 'e2e' | 'identity', now?: Date, random?: string): string;
export function databaseUrl(url: URL, name: string): string;
export interface Session {
  runDir: string;
  databases: string[];
  ports: Record<string, number>;
  browserEnv: Record<string, string | undefined> | null;
  interrupted: number | null;
  stop(): Promise<void>;
}
export function createSession(runDir: string): Session;
export function prepareBrowserFixture(session: Session): Promise<{ ok: boolean }>;
