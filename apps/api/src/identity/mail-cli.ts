// Explicit worker invocation; no email is sent merely by starting the API.
import { connect, deliverIdentityMail, safeErrorDiagnostics } from '@daifuku/kernel';
import { apiConfig } from '../config.ts';
import { readIdentityConfig, readSmtpConfig } from './config.ts';
import { smtpTransport } from './smtp.ts';
async function main(): Promise<void> {
  const config = apiConfig(), identity = readIdentityConfig(process.env), smtp = readSmtpConfig(process.env);
  if (!identity || !smtp) { console.error('Identity mail is not configured; no messages were sent.'); process.exitCode = 2; return; }
  const owner = connect(config.databaseUrlOwner, { max: 2 });
  try { console.warn(JSON.stringify(await deliverIdentityMail(owner, identity.encryptionKey, smtpTransport(smtp)))); }
  finally { await owner.close(); }
}
main().catch((error: unknown) => { console.error(JSON.stringify({ message: 'Identity mail worker failed.', ...safeErrorDiagnostics(error) })); process.exitCode = 1; });
