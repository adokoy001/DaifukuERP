// AC-1: environment parsing for the stdio entrypoint.
import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID, readConfig } from '../src/config.ts';

const base = {
  DATABASE_URL_OWNER: 'postgres://o@localhost/x',
  DATABASE_URL: 'postgres://a@localhost/x',
  DAIFUKU_EMAIL: 'admin@example.com',
  DAIFUKU_PASSWORD: 'password',
};

describe('readConfig (AC-1)', () => {
  it('AC-1 applies defaults: agent id mcp-agent, company from the user', () => {
    const r = readConfig(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.agentId).toBe(DEFAULT_AGENT_ID);
    expect(r.config.companyId).toBeUndefined();
    expect(r.config.email).toBe('admin@example.com');
  });

  it('AC-1 honours DAIFUKU_AGENT_ID and DAIFUKU_COMPANY_ID', () => {
    const r = readConfig({ ...base, DAIFUKU_AGENT_ID: 'claude-1', DAIFUKU_COMPANY_ID: 'c-1' });
    expect(r.ok && r.config.agentId).toBe('claude-1');
    expect(r.ok && r.config.companyId).toBe('c-1');
  });

  it('AC-1 reports every missing or blank required variable by name', () => {
    const r = readConfig({ ...base, DAIFUKU_PASSWORD: '  ', DATABASE_URL: undefined });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem.missing).toEqual(['DATABASE_URL', 'DAIFUKU_PASSWORD']);
  });
});

describe('readConfig with DAIFUKU_API_KEY (machine-credentials AC-24, AC-25)', () => {
  const keyEnv = {
    DATABASE_URL_OWNER: base.DATABASE_URL_OWNER,
    DATABASE_URL: base.DATABASE_URL,
    DAIFUKU_API_KEY: `dfk_${'a'.repeat(43)}`,
  };
  it('AC-24 accepts an API key without email or password and keeps DAIFUKU_COMPANY_ID', () => {
    const r = readConfig({ ...keyEnv, DAIFUKU_COMPANY_ID: 'c-1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.apiKey).toBe(keyEnv.DAIFUKU_API_KEY);
    expect(r.config.companyId).toBe('c-1');
    expect(r.config.email).toBe('');
  });
  it.each(['DAIFUKU_EMAIL', 'DAIFUKU_PASSWORD', 'DAIFUKU_MFA_CODE', 'DAIFUKU_TENANT_ID'])(
    'AC-25 refuses DAIFUKU_API_KEY together with %s',
    (name) => {
      const r = readConfig({ ...keyEnv, [name]: 'set' });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.problem.conflicting).toEqual([name]);
    },
  );
  it('AC-25 still requires both database URLs with an API key', () => {
    const r = readConfig({ ...keyEnv, DATABASE_URL: ' ' });
    expect(!r.ok && r.problem).toEqual({ missing: ['DATABASE_URL'], conflicting: [] });
  });
});
