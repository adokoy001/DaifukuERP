import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readIdentityConfig,
  readSmtpConfig,
  safeIdentityUrl,
  validateIdentityOptions,
} from '../src/identity/config.ts';
const mocked = vi.hoisted(() => ({ sendMail: vi.fn(), createTransport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: mocked.createTransport } }));
import { smtpTransport } from '../src/identity/smtp.ts';
const key = Buffer.alloc(32, 7).toString('base64');
beforeEach(() => {
  vi.clearAllMocks();
  mocked.createTransport.mockReturnValue({ sendMail: mocked.sendMail });
});
describe('identity adapter configuration', () => {
  it('fails closed on insecure URLs or incomplete secrets and permits loopback only in explicit tests', () => {
    expect(readIdentityConfig({})).toBeUndefined();
    expect(() =>
      readIdentityConfig({ IDENTITY_ENCRYPTION_KEY: 'bad', PUBLIC_WEB_URL: 'https://erp.example.com' }),
    ).toThrow('configuration is invalid');
    for (const url of [
      'http://idp.example.com',
      'https://127.0.0.1',
      'https://idp.example.com/#secret',
      'https://user:pass@idp.example.com',
      'https://metadata.internal',
    ])
      expect(() => safeIdentityUrl(url)).toThrow();
    expect(() =>
      validateIdentityOptions({ encryptionKey: key, webUrl: 'https://erp.example.com/path', providers: [] }),
    ).toThrow();
    expect(
      readIdentityConfig({ NODE_ENV: 'test', IDENTITY_ENCRYPTION_KEY: key, PUBLIC_WEB_URL: 'http://localhost:5189' }),
    ).toHaveProperty('allowLoopbackForTests', true);
  });
  it('does not treat missing SMTP as a configured delivery service', () => {
    expect(readSmtpConfig({})).toBeUndefined();
    expect(() => readSmtpConfig({ SMTP_HOST: 'smtp.example.com' })).toThrow('SMTP configuration');
    expect(() =>
      readSmtpConfig({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '1.5',
        SMTP_USER: 'user',
        SMTP_PASSWORD: 'password',
        SMTP_FROM: 'mail@example.com',
      }),
    ).toThrow();
  });
  it('requires verified TLS, bounds SMTP timeouts and rejects partial recipient acceptance', async () => {
    const transport = smtpTransport({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'synthetic-user',
      password: 'synthetic-password',
      from: 'mail@example.com',
    });
    expect(mocked.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        requireTLS: true,
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        socketTimeout: 30000,
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
    mocked.sendMail.mockResolvedValueOnce({ accepted: ['test@example.com'], rejected: [] });
    const message = {
      to: 'test@example.com',
      subject: 'Synthetic test',
      text: 'Test body',
      messageId: '<fixed@daifuku.identity>',
    };
    await expect(transport.send(message)).resolves.toBeUndefined();
    expect(mocked.sendMail).toHaveBeenCalledWith({ ...message, from: 'mail@example.com' });
    mocked.sendMail.mockResolvedValueOnce({ accepted: [], rejected: ['test@example.com'] });
    await expect(transport.send(message)).rejects.toThrow('not accepted');
  });
});
