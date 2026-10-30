// /admin/tokens (docs/specs/machine-credentials.md AC-27..AC-30, AC-33): pure rules for the API key screen — the issue
// draft and its validation, status and expiry text, purpose labels, the usage snippet, history labels and the warning
// added to the user deactivation confirmation. No React, no requests.
import type { Label } from '../api/types.ts';

export type MachinePurpose = 'mcp' | 'integration';
export type MachineStatus = 'active' | 'expired' | 'revoked' | 'suspended';

export interface MachineCredential {
  id: string;
  name: string;
  purpose: MachinePurpose;
  companyId: string;
  companyCode: string;
  companyName: string;
  roles: string[];
  issuedBy: { id: string; name: string };
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  lastDeniedAt: string | null;
  revokedAt: string | null;
  revokedBy: { id: string; name: string } | null;
  revokeReason: string | null;
  status: MachineStatus;
}

export interface MachineCredentialList {
  items: MachineCredential[];
  truncated: boolean;
  roles: string[];
  companies: { id: string; code: string; name: string }[];
  limits: { maxActive: number; maxDays: number };
}

export interface MachineAuditEntry {
  id: string;
  op: string;
  actorType: string;
  actorId: string;
  actorName: string | null;
  at: string;
  reason: string | null;
}

/** AC-28: the offered validity periods (days); the server accepts any whole number from 1 to 365. */
export const EXPIRY_CHOICES = [30, 90, 180, 365] as const;
export const DEFAULT_EXPIRY_DAYS = 90;
/** AC-27: an active key expiring within this many days shows "N days left". */
export const EXPIRY_WARNING_DAYS = 30;
const DAY_MS = 86_400_000;

export interface TokenDraft {
  name: string;
  purpose: MachinePurpose;
  companyId: string;
  roles: string[];
  expiresInDays: number;
  password: string;
  code: string;
}
export type TokenField = 'name' | 'purpose' | 'companyId' | 'roles' | 'expiresInDays' | 'password' | 'code';
/** Field order for focusing the first error (AC-28). */
export const TOKEN_FIELDS: readonly TokenField[] = [
  'name',
  'purpose',
  'companyId',
  'roles',
  'expiresInDays',
  'password',
  'code',
];

export function emptyDraft(companyId: string): TokenDraft {
  return {
    name: '',
    purpose: 'integration',
    companyId,
    roles: [],
    expiresInDays: DEFAULT_EXPIRY_DAYS,
    password: '',
    code: '',
  };
}

/** AC-28: what must be filled in before anything is sent (the server checks the rest). */
export function draftErrors(draft: TokenDraft, mfaEnabled: boolean): Partial<Record<TokenField, Label>> {
  const errors: Partial<Record<TokenField, Label>> = {};
  const name = draft.name.trim();
  if (!name) errors.name = { ja: '名前を入力してください。', en: 'Enter a name.' };
  else if (name.length > 100) errors.name = { ja: '名前は 100 文字以内です。', en: 'Use at most 100 characters.' };
  if (!draft.roles.length) errors.roles = { ja: 'ロールを 1 つ以上選んでください。', en: 'Choose at least one role.' };
  if (!draft.companyId) errors.companyId = { ja: '会社を選んでください。', en: 'Choose a company.' };
  if (!draft.password)
    errors.password = {
      ja: '本人確認のため現在のパスワードを入力してください。',
      en: 'Enter your current password to confirm it is you.',
    };
  if (mfaEnabled && !draft.code.trim())
    errors.code = { ja: '認証コードを入力してください。', en: 'Enter your authenticator code.' };
  return errors;
}

export function firstErrorField(errors: Partial<Record<TokenField, unknown>>): TokenField | undefined {
  return TOKEN_FIELDS.find((field) => errors[field] !== undefined);
}

/** Server issue paths (`name`, `roles.1`, `expiresInDays`, …) mapped onto the dialog fields; the rest is form-level. */
export function issueField(path: string): TokenField | undefined {
  const head = path.replace(/^body\./, '').split('.')[0] ?? '';
  return (TOKEN_FIELDS as readonly string[]).includes(head) ? (head as TokenField) : undefined;
}

export const STATUS_LABEL: Record<MachineStatus, Label> = {
  active: { ja: '有効', en: 'Active' },
  expired: { ja: '期限切れ', en: 'Expired' },
  revoked: { ja: '失効', en: 'Revoked' },
  suspended: { ja: '停止中', en: 'Suspended' },
};
export const STATUS_TONE: Record<MachineStatus, 'success' | 'neutral' | 'danger' | 'warning'> = {
  active: 'success',
  expired: 'neutral',
  revoked: 'danger',
  suspended: 'warning',
};
export const PURPOSE_LABEL: Record<MachinePurpose, Label> = {
  integration: { ja: '連携（REST API）', en: 'Integration (REST API)' },
  mcp: { ja: 'AI エージェント（MCP）', en: 'AI agent (MCP)' },
};

/** Whole days until `expiresAt`, rounded up (a key expiring in 2 hours has 1 day left). */
export function daysLeft(expiresAt: string, now: Date): number {
  return Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS);
}

/** AC-27: "N days left" for an active key that expires within 30 days, else null. */
export function expiryNote(item: Pick<MachineCredential, 'status' | 'expiresAt'>, now: Date): Label | null {
  if (item.status !== 'active') return null;
  const days = daysLeft(item.expiresAt, now);
  if (days > EXPIRY_WARNING_DAYS) return null;
  return { ja: `期限まで ${days} 日`, en: days === 1 ? '1 day left' : `${days} days left` };
}

export const UNUSED: Label = { ja: '未使用', en: 'Unused' };

/** AC-28: how to use the key that was just issued, for its purpose. */
export function usageText(purpose: MachinePurpose): { label: Label; snippet: string } {
  return purpose === 'mcp'
    ? {
        label: {
          ja: 'MCP サーバーの環境変数に設定します（メールアドレスとパスワードは設定しません）。',
          en: 'Set it in the MCP server environment (do not set the email and password).',
        },
        snippet: 'DAIFUKU_API_KEY=<API key>',
      }
    : {
        label: {
          ja: '連携先から REST API を呼ぶときに Authorization ヘッダーで送ります。',
          en: 'Send it in the Authorization header when the integration calls the REST API.',
        },
        snippet: 'Authorization: Bearer <API key>',
      };
}

export const AUDIT_OP_LABEL: Record<string, Label> = {
  issue: { ja: '発行', en: 'Issued' },
  revoke: { ja: '失効', en: 'Revoked' },
  use_denied: { ja: '拒否', en: 'Refused' },
};
export const REASON_LABEL: Record<string, Label> = {
  revoked: { ja: '失効済みの鍵', en: 'Revoked key' },
  expired: { ja: '期限切れの鍵', en: 'Expired key' },
  purpose_mismatch: { ja: '用途が違う接続', en: 'Used for the other purpose' },
  issuer_inactive: { ja: '発行者が無効', en: 'Issuer is no longer an active tenant administrator' },
  company_mismatch: { ja: '別の会社を指定', en: 'Another company was requested' },
  issuer_deactivated: { ja: '発行者の無効化', en: 'Issuer deactivated' },
  issuer_demoted: { ja: '発行者のテナント管理者解除', en: 'Issuer lost tenant administration' },
};

export function auditOpLabel(op: string): Label {
  return AUDIT_OP_LABEL[op] ?? { ja: op, en: op };
}
/** A system reason is translated; a reason typed by an administrator is shown as written. */
export function reasonText(reason: string | null): Label | null {
  if (!reason) return null;
  return REASON_LABEL[reason] ?? { ja: reason, en: reason };
}

/** AC-33: the sentence added to the deactivation / demotion confirmation, or null when the user has no live keys. */
export function deactivationWarning(activeKeys: number): Label | null {
  if (activeKeys <= 0) return null;
  return {
    ja: `この利用者が発行した有効な API キー ${activeKeys} 件も失効します。`,
    en:
      activeKeys === 1
        ? '1 active API key issued by this user will be revoked.'
        : `${activeKeys} active API keys issued by this user will be revoked.`,
  };
}

/** AC-28: a failed issue whose outcome is unknown (no response, or a server error after the request was sent). */
export function outcomeUnknown(status: number | undefined): boolean {
  return status === undefined || status === 0 || status >= 500;
}
