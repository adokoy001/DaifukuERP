/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** navigation-assist AC-6: base of the "help for this screen" links; defaults to the public docs/manual/. */
  readonly VITE_MANUAL_URL?: string;
}
