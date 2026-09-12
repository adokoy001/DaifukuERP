export type SetupMode = 'install' | 'upgrade';
export interface SetupOptions {
  mode: SetupMode;
  envFile: string;
  stateDir: string;
  execute: boolean;
  confirmTarget?: string | undefined;
  maintenanceConfirmed: boolean;
  allowRemote: boolean;
  tenantName?: string | undefined;
  companyCode?: string | undefined;
  companyName?: string | undefined;
  adminEmail?: string | undefined;
  adminName?: string | undefined;
  adminPasswordFile?: string | undefined;
  generateAdminPassword: boolean;
}
export interface SetupSecrets { ownerUrl: string; appUrl: string; restoreUrl?: string | undefined; jwtSecret?: string | undefined }
export interface Identity { tenantId: string; tenantName: string; companyCode: string; companyName: string; adminEmail: string; adminName: string; companyId?: string; userId?: string }
export interface SetupState { format: 1; operationMode: SetupMode; targetId: string; identity?: Identity; phase: string; seededModules: string[]; completedHash?: string; backups: string[] }
export interface MigrationFile { idx: number; tag: string; when: number; hash: string }
export interface Target { id: string; database: string; host: string; port: string; owner: string; postgres: number }
export interface SetupPlan {
  mode: SetupMode; target: Target; empty: boolean; applied: number; pending: string[]; migrationHash: string;
  backupDirectory: string; restoreTarget: string | null; restoreEmpty: boolean; otherConnections: number; noOp: boolean;
}
export class SetupError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'SetupError'; }
}
export function safeFailure(error: unknown): string {
  if (error instanceof SetupError) return `${error.code}: ${error.message}`;
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,30}$/.test(error.code) ? error.code : 'OPERATION_FAILED';
  return `${code}: 操作に失敗しました。秘密を含む可能性がある詳細は表示していません。対象をresetせず、計画とcheckpointを確認してください。`;
}
