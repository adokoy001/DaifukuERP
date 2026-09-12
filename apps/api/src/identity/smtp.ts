import type { IdentityMailTransport } from '@daifuku/kernel';
import nodemailer from 'nodemailer';
import type { SmtpOptions } from './config.ts';
export function smtpTransport(config: SmtpOptions): IdentityMailTransport {
  const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, requireTLS: !config.secure, auth: { user: config.user, pass: config.password }, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, ...(config.tlsCa ? { ca: config.tlsCa } : {}) }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true });
  return { async send(message) {
    const response = await transport.sendMail({ ...message, from: config.from });
    if (response.rejected.length || response.accepted.length !== 1) throw new Error('Mail recipient was not accepted');
  } };
}
