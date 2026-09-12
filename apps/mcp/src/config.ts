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
}

export interface ConfigProblem {
  missing: string[];
}

function present(v: string | undefined): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

export function readConfig(env: Record<string, string | undefined>): { ok: true; config: McpConfig } | { ok: false; problem: ConfigProblem } {
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
    },
  };
}
