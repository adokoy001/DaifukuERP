// Environment for the stdio server (spec mcp-app AC-1). Pure: takes an env map so it is unit-testable.
export { loadDotEnv } from '@daifuku/runtime';

export const DEFAULT_AGENT_ID = 'mcp-agent';

export interface McpConfig {
  ownerUrl: string;
  appUrl: string;
  email: string;
  password: string;
  agentId: string;
  /** Overrides the user's default company when set. */
  companyId: string | undefined;
  tenantId: string | undefined;
  mfaCode?: string | undefined;
  identityEncryptionKey?: string | undefined;
  /** machine-credentials AC-24: an `mcp` API key replaces the email / password login. */
  apiKey?: string | undefined;
}

export interface ConfigProblem {
  missing: string[];
  /** machine-credentials AC-25: variables that must not be set together with DAIFUKU_API_KEY. */
  conflicting?: string[];
}

/** Login variables that conflict with DAIFUKU_API_KEY (AC-25): choose one way to authenticate. */
export const API_KEY_CONFLICTS = [
  'DAIFUKU_EMAIL',
  'DAIFUKU_PASSWORD',
  'DAIFUKU_MFA_CODE',
  'DAIFUKU_TENANT_ID',
] as const;

function present(v: string | undefined): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

export function readConfig(
  env: Record<string, string | undefined>,
): { ok: true; config: McpConfig } | { ok: false; problem: ConfigProblem } {
  if (present(env.DAIFUKU_API_KEY)) {
    const missing = (['DATABASE_URL_OWNER', 'DATABASE_URL'] as const).filter((k) => !present(env[k]));
    const conflicting = API_KEY_CONFLICTS.filter((k) => present(env[k]));
    if (missing.length || conflicting.length) return { ok: false, problem: { missing, conflicting } };
    return {
      ok: true,
      config: {
        ownerUrl: env.DATABASE_URL_OWNER ?? '',
        appUrl: env.DATABASE_URL ?? '',
        email: '',
        password: '',
        agentId: DEFAULT_AGENT_ID,
        companyId: present(env.DAIFUKU_COMPANY_ID) ? env.DAIFUKU_COMPANY_ID : undefined,
        tenantId: undefined,
        apiKey: env.DAIFUKU_API_KEY.trim(),
      },
    };
  }
  const required = ['DATABASE_URL_OWNER', 'DATABASE_URL', 'DAIFUKU_EMAIL', 'DAIFUKU_PASSWORD'] as const;
  const missing = required.filter((k) => !present(env[k]));
  if (missing.length > 0) return { ok: false, problem: { missing } };
  return {
    ok: true,
    config: {
      ownerUrl: env.DATABASE_URL_OWNER ?? '',
      appUrl: env.DATABASE_URL ?? '',
      email: env.DAIFUKU_EMAIL ?? '',
      password: env.DAIFUKU_PASSWORD ?? '',
      agentId: present(env.DAIFUKU_AGENT_ID) ? env.DAIFUKU_AGENT_ID : DEFAULT_AGENT_ID,
      companyId: present(env.DAIFUKU_COMPANY_ID) ? env.DAIFUKU_COMPANY_ID : undefined,
      tenantId: present(env.DAIFUKU_TENANT_ID) ? env.DAIFUKU_TENANT_ID : undefined,
      ...(present(env.DAIFUKU_MFA_CODE) ? { mfaCode: env.DAIFUKU_MFA_CODE } : {}),
      ...(present(env.IDENTITY_ENCRYPTION_KEY) ? { identityEncryptionKey: env.IDENTITY_ENCRYPTION_KEY } : {}),
    },
  };
}
