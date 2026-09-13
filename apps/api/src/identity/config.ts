import { encryptionKey, type IdentityMailTransport } from '@daifuku/kernel';
import { z } from 'zod';
import { ApiConfigError } from '../config.ts';
export interface OidcProvider {
  id: string;
  label: string;
  tenantId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}
export interface IdentityOptions {
  encryptionKey: string;
  webUrl: string;
  providers: OidcProvider[];
  mailTransport?: IdentityMailTransport;
  allowLoopbackForTests?: boolean;
}
export interface SmtpOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  secure: boolean;
  tlsCa?: string;
}
const provider = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    label: z.string().min(1).max(80),
    tenantId: z.uuid(),
    issuer: z.url(),
    clientId: z.string().min(1).max(500),
    clientSecret: z.string().min(1).max(2000),
    authorizationEndpoint: z.url(),
    tokenEndpoint: z.url(),
    jwksUri: z.url(),
  })
  .strict();
export function safeIdentityUrl(value: string, loopback = false, originOnly = false): URL {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(loopback && local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.hash ||
    (originOnly && (url.pathname !== '/' || url.search)) ||
    (!loopback &&
      (local ||
        /^\d+(\.\d+){3}$/.test(url.hostname) ||
        url.hostname.includes(':') ||
        !url.hostname.includes('.') ||
        /\.(local|internal|localhost)$/i.test(url.hostname)))
  )
    throw new ApiConfigError('Identity URLs require static HTTPS endpoints without credentials or fragments.');
  return url;
}
export function validateIdentityOptions(options: IdentityOptions): IdentityOptions {
  encryptionKey(options.encryptionKey);
  safeIdentityUrl(options.webUrl, options.allowLoopbackForTests, true);
  const parsed = z.array(provider).max(10).parse(options.providers);
  if (new Set(parsed.map((p) => p.id)).size !== parsed.length)
    throw new ApiConfigError('OIDC provider ids must be unique.');
  for (const p of parsed)
    for (const value of [p.issuer, p.authorizationEndpoint, p.tokenEndpoint, p.jwksUri])
      safeIdentityUrl(value, options.allowLoopbackForTests);
  return options;
}
export function readIdentityConfig(
  env: Readonly<Record<string, string | undefined>>,
): Omit<IdentityOptions, 'mailTransport'> | undefined {
  if (!env.IDENTITY_ENCRYPTION_KEY && !env.PUBLIC_WEB_URL && !env.OIDC_PROVIDERS_JSON) return undefined;
  try {
    const encryptionKey = env.IDENTITY_ENCRYPTION_KEY ?? '';
    const webUrl = env.PUBLIC_WEB_URL ?? '';
    const providers = z
      .array(provider)
      .max(10)
      .parse(JSON.parse(env.OIDC_PROVIDERS_JSON ?? '[]'));
    return validateIdentityOptions({
      encryptionKey,
      webUrl,
      providers,
      ...(env.NODE_ENV === 'test' ? { allowLoopbackForTests: true } : {}),
    });
  } catch {
    throw new ApiConfigError(
      'Identity configuration is invalid. Check IDENTITY_ENCRYPTION_KEY, PUBLIC_WEB_URL and OIDC_PROVIDERS_JSON.',
    );
  }
}
export function readSmtpConfig(env: Readonly<Record<string, string | undefined>>): SmtpOptions | undefined {
  if (!env.SMTP_HOST && !env.SMTP_USER && !env.SMTP_PASSWORD && !env.SMTP_FROM) return undefined;
  const secure = env.SMTP_SECURE === 'true';
  const port = Number(env.SMTP_PORT ?? (secure ? 465 : 587));
  if (
    !env.SMTP_HOST ||
    /[\s/\\]/.test(env.SMTP_HOST) ||
    !env.SMTP_USER ||
    !env.SMTP_PASSWORD ||
    !z.email().safeParse(env.SMTP_FROM).success ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (env.SMTP_SECURE !== undefined && !['true', 'false'].includes(env.SMTP_SECURE))
  )
    throw new ApiConfigError(
      'SMTP configuration requires host, port, user, password and a valid from address. TLS is mandatory.',
    );
  return {
    host: env.SMTP_HOST,
    port,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM ?? '',
    secure,
  };
}
