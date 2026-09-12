// Empty isolated database only. This fixture never drops, resets or overwrites data.
import { deliverIdentityMail } from '@daifuku/kernel';
import { buildServer } from '../src/server.ts';
import { smtpTransport } from '../src/identity/smtp.ts';
import { identityFixtureDatabase } from './identity-e2e-database.ts';
import { oidcFixture } from './identity-oidc-helper.ts';
import { smtpFixture } from './identity-smtp-helper.ts';
async function main() {
  const key = Buffer.alloc(32, 7).toString('base64'), webUrl = 'http://localhost:5189';
  const db = await identityFixtureDatabase(), smtp = await smtpFixture(), transport = smtpTransport(smtp.options);
  const oidc = await oidcFixture({ port: 3110, webUrl, inbox: () => smtp.messages });
  const api = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'synthetic-enterprise-identity-test-secret', corsOrigins: [webUrl], identity: { encryptionKey: key, webUrl, allowLoopbackForTests: true, mailTransport: transport, providers: [{ id: 'fixture', label: '合成組織SSO', tenantId: db.tenantId, issuer: oidc.issuer, clientId: 'fixture-client', clientSecret: 'fixture-secret', authorizationEndpoint: `${oidc.issuer}/authorize`, tokenEndpoint: `${oidc.issuer}/token`, jwksUri: `${oidc.issuer}/jwks` }] } });
  let delivering = false;
  const timer = setInterval(() => { if (delivering) return; delivering = true; void deliverIdentityMail(db.owner, key, transport).catch(() => process.stderr.write('Synthetic mail drain failed.\n')).finally(() => { delivering = false; }); }, 500);
  await api.listen({ port: 3109, host: '127.0.0.1' });
  process.stdout.write('Synthetic identity API/OIDC/SMTP ready on API3109 and IdP3110. No external recipients are accepted.\n');
  async function close() { clearInterval(timer); await api.close(); await oidc.close(); await smtp.close(); await db.close(); }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void close().finally(() => process.exit(0)));
}
void main().catch(() => { process.stderr.write('Identity fixture failed. Use new empty dedicated databases, safe roles and unused loopback ports.\n'); process.exit(1); });
