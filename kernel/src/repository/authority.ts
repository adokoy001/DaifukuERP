// Package-private token. Not exported from @daifuku/kernel; untrusted action input cannot obtain it.
export const DOCUMENT_WRITE = Symbol('document lifecycle write');
