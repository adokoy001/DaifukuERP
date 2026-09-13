import { describe, expect, it } from 'vitest';
import { identityFixtureUrls } from './identity-e2e-database.ts';
const valid = {
  E2E_IDENTITY_PREPARE: '1',
  TEST_DATABASE_URL_OWNER: 'postgres://owner:synthetic@127.0.0.1:5432/daifuku_ci_enterprise_e2e',
  TEST_DATABASE_URL: 'postgres://daifuku_app:synthetic@127.0.0.1:5432/daifuku_ci_enterprise_e2e',
};
describe('identity fixture target boundary', () => {
  it('allows only explicit loopback enterprise fixtures with matching databases and distinct app role', () => {
    expect(identityFixtureUrls(valid).owner).toContain('/daifuku_ci_enterprise_e2e');
    for (const candidate of [
      { ...valid, NODE_ENV: 'production' },
      { ...valid, E2E_IDENTITY_PREPARE: '0' },
      { ...valid, TEST_DATABASE_URL_OWNER: valid.TEST_DATABASE_URL },
      { ...valid, TEST_DATABASE_URL_OWNER: valid.TEST_DATABASE_URL_OWNER.replace('127.0.0.1', 'db.example.com') },
      {
        ...valid,
        TEST_DATABASE_URL_OWNER: valid.TEST_DATABASE_URL_OWNER.replace('daifuku_ci_enterprise_e2e', 'production'),
      },
      { ...valid, TEST_DATABASE_URL_OWNER: valid.TEST_DATABASE_URL_OWNER + '?host=production.example.com' },
      { ...valid, TEST_DATABASE_URL: valid.TEST_DATABASE_URL.replace('5432', '5433') },
    ])
      expect(() => identityFixtureUrls(candidate)).toThrow();
  });
});
