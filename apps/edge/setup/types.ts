export type EdgePlatform = 'win32' | 'linux' | 'darwin';
export type SetupOperation = 'install' | 'update' | 'uninstall' | 'start' | 'stop' | 'status' | 'pair';
export interface ServiceContext {
  platform: EdgePlatform;
  installationId: string;
  installRoot: string;
  statePath: string;
  releaseDir: string;
  nodePath: string;
  appPath: string;
  configPath: string;
  logPath: string;
  servicePath: string;
  /** Optional private PEM used only as NODE_EXTRA_CA_CERTS in this service. */
  caPath?: string | undefined;
}
export interface ServiceInspection {
  serviceExists: boolean;
  serviceRunning: boolean;
  serviceOwned: boolean;
  conflicts: string[];
  processId?: number;
  account?: { name: string; group?: string; uid?: number; gid?: number; sid?: string };
}
export interface ServiceAdapter {
  platform: EdgePlatform;
  serviceId: string;
  defaults(): { installRoot: string; statePath: string };
  /** Read-only: check real registration/account against installationId and configured paths. */
  inspect(context: ServiceContext): Promise<ServiceInspection>;
  assertAdministrator(): Promise<void>;
  /** Secure the installation root before the durable intent; no service/account creation. */
  prepareRoot?(context: ServiceContext): Promise<void>;
  /** Create our account/directories only; resume must identify its own earlier partial work. */
  prepare(context: ServiceContext): Promise<void>;
  /** Protect code as administrator/root-only writable; state/config as private service data. */
  protect(context: ServiceContext): Promise<void>;
  /** Register or update our stopped service. Called only after inspect ownership checks. */
  register(context: ServiceContext): Promise<void>;
  start(context: ServiceContext): Promise<void>;
  stop(context: ServiceContext): Promise<void>;
  /** Remove our registration only, preserving data, release files and the account. */
  uninstall(context: ServiceContext): Promise<void>;
}
