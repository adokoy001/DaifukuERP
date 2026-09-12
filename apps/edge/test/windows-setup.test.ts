import { describe, expect, it } from 'vitest';
import { createWindowsAdapter } from '../setup/platform-windows.ts';
import { windowsPath, windowsServiceXml, validateWindowsContext } from '../setup/windows/config.ts';
import { encodedWindowsSetup, type WindowsRunner } from '../setup/windows/runner.ts';
import type { ServiceContext } from '../setup/types.ts';

const context: ServiceContext = {
  platform: 'win32', installationId: 'ae79484c-7253-449b-970a-7715043529e8',
  installRoot: 'C:\\Program Files\\DaifukuEdge', statePath: 'C:\\ProgramData\\DaifukuEdge',
  releaseDir: 'C:\\Program Files\\DaifukuEdge\\releases\\release-1',
  nodePath: 'C:\\Program Files\\DaifukuEdge\\releases\\release-1\\runtime\\node.exe',
  appPath: 'C:\\Program Files\\DaifukuEdge\\releases\\release-1\\app\\edge.mjs',
  configPath: 'C:\\ProgramData\\DaifukuEdge\\config.json', logPath: 'C:\\ProgramData\\DaifukuEdge\\logs',
  servicePath: 'C:\\Program Files\\DaifukuEdge\\service',
};
describe('Windows service installer boundary', () => {
  it('runs a real SCM wrapper as LocalService with only fixed agent arguments', () => {
    const xml = windowsServiceXml(context);
    expect(xml).toContain('<domain>NT AUTHORITY</domain><user>LocalService</user>');
    expect(xml).toContain('&quot;C:\\Program Files\\DaifukuEdge\\releases\\release-1\\app\\edge.mjs&quot; service --config');
    expect(xml).toContain('<onfailure action="restart" delay="10 sec"/>');
    expect(xml).toContain('<sizeThreshold>1024</sizeThreshold><keepFiles>4</keepFiles>');
    expect(xml).toContain('<env name="NODE_OPTIONS" value=""/>');
    expect(xml).not.toMatch(/password|download|allowservicelogon|NODE_EXTRA_CA_CERTS/);
  });
  it('escapes XML paths, preserving Unicode and literal shell metacharacters', () => {
    const value = { ...context, statePath: 'C:\\ProgramData\\お店 & $cash', configPath: 'C:\\ProgramData\\お店 & $cash\\config.json', logPath: 'C:\\ProgramData\\お店 & $cash\\logs', caPath: 'C:\\ProgramData\\お店 & $cash\\ca.pem' };
    expect(windowsServiceXml(value)).toContain('お店 &amp; $cash');
    expect(windowsServiceXml(value)).toContain('name="NODE_EXTRA_CA_CERTS" value="C:\\ProgramData\\お店 &amp; $cash\\ca.pem"');
  });
  it.each(['\\\\server\\share', '\\\\?\\C:\\edge', 'C:edge', 'C:\\edge%PATH%', 'C:\\edge" injected', 'C:\\edge\nchild', 'C:\\edge\\NUL.json', 'C:\\edge\\child.', 'C:\\edge:file', 'C:\\edge\\file?'])('rejects unsafe Windows path %j before any process is launched', (path) => {
    expect(() => windowsPath(path)).toThrow('windows_local_path_required');
  });
  it('rejects runtime/state overlap, release escape, and a private config outside state', () => {
    for (const changed of [{ statePath: context.installRoot }, { releaseDir: 'C:\\temp\\other' }, { nodePath: 'C:\\Windows\\cmd.exe' }, { configPath: 'C:\\Users\\Public\\config.json' }, { caPath: 'C:\\Users\\Public\\ca.pem' }]) {
      expect(() => validateWindowsContext({ ...context, ...changed })).toThrow('windows_service_path_mismatch');
    }
  });
  it('inspection delegates only a read-only command and preserves ownership conflicts', async () => {
    const calls: string[] = [];
    const run: WindowsRunner = async (operation) => { calls.push(operation); return { serviceExists: true, serviceRunning: true, serviceOwned: false, conflicts: ['windows_service_not_owned'] }; };
    const result = await createWindowsAdapter(run).inspect(context);
    expect(calls).toEqual(['inspect']);
    expect(result).toMatchObject({ serviceOwned: false, conflicts: ['windows_service_not_owned'], account: { sid: 'S-1-5-19' } });
  });
  it('rejects malformed status and validates context before mutation', async () => {
    const operations: string[] = [];
    const run: WindowsRunner = async (operation) => { operations.push(operation); return { serviceExists: 'yes' }; };
    const adapter = createWindowsAdapter(run);
    await expect(adapter.inspect(context)).rejects.toThrow('windows_service_output_invalid');
    await expect(adapter.uninstall({ ...context, servicePath: 'C:\\another-service' })).rejects.toThrow('windows_service_path_mismatch');
    expect(operations).toEqual(['inspect']);
  });
  it('only exposes a valid observed agent PID, never a coerced service PID', async () => {
    const result = { serviceExists: true, serviceRunning: true, serviceOwned: true, conflicts: [], processId: 314 };
    expect((await createWindowsAdapter(async () => result).inspect(context)).processId).toBe(314);
    for (const processId of ['314', 0, -1, 2.5]) await expect(createWindowsAdapter(async () => ({ ...result, processId })).inspect(context)).rejects.toThrow('windows_service_output_invalid');
  });
  it('keeps every fixed helper below the Windows process command-line limit', () => {
    for (const operation of ['inspect', 'administrator', 'prepareRoot', 'prepare', 'protect', 'register', 'start', 'stop', 'uninstall', 'durableReplace', 'durablePublish'] as const) expect(encodedWindowsSetup(operation).length).toBeLessThan(30000);
  });
});
