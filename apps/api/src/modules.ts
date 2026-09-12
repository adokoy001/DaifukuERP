import { loadRuntime } from '@daifuku/runtime';

const runtime = await loadRuntime();
export const modules = runtime.modules;
export const packs = runtime.packs;
export const packWarnings = runtime.warnings;
