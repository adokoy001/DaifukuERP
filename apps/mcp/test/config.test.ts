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
