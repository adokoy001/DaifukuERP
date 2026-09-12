// Thin fetch wrapper: tab-local credentials and company, error body -> ApiError, 401 -> session cleared.
import type { ErrorBody, ErrorCode, LoginUser, ValidationIssue } from './types.ts';

const TOKEN_KEY = 'daifuku.token';
const USER_KEY = 'daifuku.user';

function readEnv(): string {
  const raw: unknown = import.meta.env.VITE_API_URL;
  return typeof raw === 'string' && raw.length > 0 ? raw.replace(/\/+$/, '') : 'http://localhost:3000';
}

export const API_URL = readEnv();

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly hint: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.hint = body.hint;
    this.details = body.details;
  }

  /** VALIDATION errors carry `details.issues[]`; anything else yields an empty list. */
  issues(): ValidationIssue[] {
    const raw = this.details?.issues;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((i: unknown) => {
      if (typeof i !== 'object' || i === null) return [];
      const rec = i as Record<string, unknown>;
      return [{ path: String(rec.path ?? ''), message: String(rec.message ?? '') }];
    });
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

// ---- session ------------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return storage()?.getItem(TOKEN_KEY) ?? null;
}

export function getUser(): LoginUser | null {
  const raw = storage()?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LoginUser;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: LoginUser): void {
  clearCompanySelection();
  storage()?.setItem(TOKEN_KEY, token);
  storage()?.setItem(USER_KEY, JSON.stringify(user));
  clearCompanySelection();
}

export function clearSession(): void {
  clearCompanySelection();
  storage()?.removeItem(TOKEN_KEY);
  storage()?.removeItem(USER_KEY);
}

function companySelectionKey(): string | undefined {
  const user = getUser();
  return user ? `daifuku.company.${user.tenantId}.${user.id}` : undefined;
}

/** Company selection is per tab and user; another tab must never change the target of an open form. */
export function getCompanyId(): string | null {
  const key = companySelectionKey();
  try { return (key ? globalThis.sessionStorage?.getItem(key) : null) ?? getUser()?.defaultCompanyId ?? null; }
  catch { return getUser()?.defaultCompanyId ?? null; }
}

export function setActiveCompany(id: string): void {
  const key = companySelectionKey();
  if (!key) throw new Error('Sign in before selecting a company.');
  globalThis.sessionStorage.setItem(key, id);
}

function clearCompanySelection(): void {
  const key = companySelectionKey();
  try { if (key) globalThis.sessionStorage?.removeItem(key); } catch { /* Storage can be unavailable in private sessions. */ }
}

let unauthorizedHandler: (() => void) | null = null;

/** Registered by main.tsx: navigates to /login when a request comes back 401. */
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

// ---- requests -----------------------------------------------------------------------------

function parseErrorBody(status: number, raw: unknown): ErrorBody {
  const err = typeof raw === 'object' && raw !== null ? (raw as { error?: unknown }).error : undefined;
  if (typeof err === 'object' && err !== null) {
    const e = err as Partial<ErrorBody>;
    const body: ErrorBody = { code: e.code ?? 'INTERNAL', message: e.message ?? `HTTP ${status}`, hint: e.hint ?? 'Retry, or check the server logs.' };
    if (e.details) body.details = e.details;
    return body;
  }
  return { code: status === 401 ? 'PERMISSION_DENIED' : 'INTERNAL', message: `HTTP ${status}`, hint: status === 401 ? 'Log in again.' : 'The server returned a non-JSON error; check its logs.' };
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header (login). */
  anonymous?: boolean;
  /** Abort reads when their company/page is left. Sensitive portals use no-store. */
  signal?: AbortSignal;
  cache?: RequestCache;
}

function authHeaders(anonymous: boolean | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (anonymous) return headers;
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const company = getCompanyId();
  if (company) headers['x-company-id'] = company;
  return headers;
}

async function send(path: string, init: RequestInit, anonymous: boolean | undefined): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new ApiError(0, { code: 'INTERNAL', message: e instanceof Error ? e.message : 'network error', hint: `Cannot reach the API at ${API_URL}. Is it running?` });
  }
  if (res.ok) return res;
  const text = await res.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  // A delayed response from an older login must not erase the new session.
  const sentAuthorization = new Headers(init.headers).get('authorization');
  if (res.status === 401 && !anonymous && sentAuthorization === `Bearer ${getToken()}`) {
    clearSession();
    unauthorizedHandler?.();
  }
  throw new ApiError(res.status, parseErrorBody(res.status, json));
}

async function jsonOf<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (text.length === 0) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null as T;
  }
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...authHeaders(opts.anonymous) };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const init: RequestInit = { method: opts.method ?? 'GET', headers, ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.cache ? { cache: opts.cache } : {}) };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  return jsonOf<T>(await send(path, init, opts.anonymous));
}

/** Multipart upload (web-phase1 AC-4): the browser sets the content-type boundary itself. */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...authHeaders(false) };
  return jsonOf<T>(await send(path, { method: 'POST', headers, body: form, cache: 'no-store' }, false));
}

export interface Downloaded {
  blob: Blob;
  contentDisposition: string | null;
  contentType: string | null;
}

/** Authenticated binary GET (attachment download). */
export async function download(path: string): Promise<Downloaded> {
  const res = await send(path, { method: 'GET', headers: authHeaders(false), cache: 'no-store' }, false);
  return { blob: await res.blob(), contentDisposition: res.headers.get('content-disposition'), contentType: res.headers.get('content-type') };
}
