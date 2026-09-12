import { describe, expect, it } from 'vitest';
import { ApiConfigError, readApiConfig, startupErrorMessage } from '../src/config.ts';

const LOCAL = { DATABASE_URL: 'postgres://app:fixture@localhost/example', DATABASE_URL_OWNER: 'postgres://owner:fixture@localhost/example', JWT_SECRET: 'dev-secret-change-me' };
const STRONG = '4e1f506b83ac47d19208e6d573a29bf0e6c5827134a98b65';

describe('public-release AC-7 startup configuration', () => {
  it('defaults to loopback development and allows the explicit local demo secret only there', () => {
    expect(readApiConfig(LOCAL)).toMatchObject({ host: '127.0.0.1', port: 3000, jwtSecret: LOCAL.JWT_SECRET });
    for (const HOST of ['localhost', '127.0.0.1', '::1']) expect(readApiConfig({ ...LOCAL, HOST }).host).toBe(HOST);
  });

  it.each(['', '0', '65536', '-1', '3.5', 'NaN', 'Infinity', '1e3', ' 3000', '3000x'])('rejects malformed PORT %j before listening', (PORT) => {
    expect(() => readApiConfig({ ...LOCAL, PORT })).toThrow('PORT must');
  });

  it('accepts valid port bounds and rejects ambiguous environment or host settings', () => {
    for (const PORT of ['1', '65535']) expect(readApiConfig({ ...LOCAL, PORT }).port).toBe(Number(PORT));
    expect(() => readApiConfig({ ...LOCAL, NODE_ENV: 'prod' })).toThrow('NODE_ENV');
    for (const HOST of ['', ' localhost', 'http://localhost', 'localhost\n']) expect(() => readApiConfig({ ...LOCAL, HOST })).toThrow('HOST');
  });

  it('requires strong secrets for production and every non-loopback bind, including development', () => {
    const modes = [{ NODE_ENV: 'production' }, { HOST: '0.0.0.0' }, { HOST: '::' }, { HOST: 'erp.example.test' }];
    for (const mode of modes) {
      for (const JWT_SECRET of [LOCAL.JWT_SECRET, 'short', 'a'.repeat(48), 'dev-secret-change-me-0123456789abcdef']) {
        expect(() => readApiConfig({ ...LOCAL, ...mode, JWT_SECRET })).toThrow('JWT_SECRET');
      }
      expect(readApiConfig({ ...LOCAL, ...mode, JWT_SECRET: STRONG }).jwtSecret).toBe(STRONG);
    }
    for (const JWT_SECRET of [`${STRONG}\n`, `${STRONG}\r`, `${STRONG}\0`]) expect(() => readApiConfig({ ...LOCAL, JWT_SECRET })).toThrow('JWT_SECRET');
  });

  it('reports missing names and never emits supplied secrets or connection URLs on startup failure', () => {
    expect(() => readApiConfig({ ...LOCAL, DATABASE_URL: undefined })).toThrow('DATABASE_URL');
    expect(() => readApiConfig({ ...LOCAL, JWT_SECRET: undefined })).toThrow('JWT_SECRET');
    let error: unknown;
    try { readApiConfig({ ...LOCAL, NODE_ENV: 'production' }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ApiConfigError);
    expect(startupErrorMessage(error)).toContain('JWT_SECRET');
    expect(startupErrorMessage(error)).not.toContain(LOCAL.JWT_SECRET);
    expect(startupErrorMessage(new Error(`Invalid URL ${LOCAL.DATABASE_URL_OWNER}`))).not.toContain(LOCAL.DATABASE_URL_OWNER);
  });
});

describe('public-release AC-8 browser origin policy', () => {
  it('allows only local development origins by default and no cross-origin requests by default in production', () => {
    expect(readApiConfig(LOCAL).corsOrigins).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']);
    expect(readApiConfig({ ...LOCAL, NODE_ENV: 'production', JWT_SECRET: STRONG }).corsOrigins).toEqual([]);
    expect(readApiConfig({ ...LOCAL, CORS_ORIGINS: '' }).corsOrigins).toEqual([]);
  });

  it('normalizes and deduplicates explicitly allowed origins without adding development defaults', () => {
    expect(readApiConfig({ ...LOCAL, CORS_ORIGINS: ' https://erp.example.test/,https://erp.example.test:443,http://127.0.0.1:8080 ' }).corsOrigins).toEqual(['https://erp.example.test', 'http://127.0.0.1:8080']);
  });

  it.each(['*', 'null', 'https://*.example.test', 'ftp://example.test', 'https://user:private@example.test', 'https://@example.test', 'https://:@example.test', 'https://example.test/path', 'https://example.test/?secret', 'https://example.test/#secret', 'https://example.test,', 'https://example.test/../', 'https://example.test?', 'https://example.test#'])('rejects non-origin CORS_ORIGINS %j without echoing it', (CORS_ORIGINS) => {
    try { readApiConfig({ ...LOCAL, CORS_ORIGINS }); } catch (error) {
      expect(error).toBeInstanceOf(ApiConfigError);
      expect(startupErrorMessage(error)).toContain('CORS_ORIGINS');
      expect(startupErrorMessage(error)).not.toContain(CORS_ORIGINS);
      return;
    }
    throw new Error('Unsafe origin configuration was accepted');
  });
});
