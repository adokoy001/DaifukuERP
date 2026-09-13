import { describe, expect, it } from 'vitest';
import { windowsPowerShellEnvironment } from '../src/windows-environment.ts';

describe('Windows PowerShell environment boundary', () => {
  it('removes every case-insensitive spelling before selecting the OS modules', () => {
    const source = {
      PSMODULEPATH: 'C:\\PowerShell7\\Modules',
      PSModulePath: 'C:\\other',
      psmodulepath: 'C:\\third',
      SYSTEMROOT: 'D:\\Windows',
      PATH: 'synthetic-path',
    };
    const result = windowsPowerShellEnvironment(source);
    expect(Object.keys(result).filter((name) => name.toLowerCase() === 'psmodulepath')).toEqual(['PSModulePath']);
    expect(result.PSModulePath).toBe('D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
    expect(result.PATH).toBe('synthetic-path');
    expect(source.PSMODULEPATH).toBe('C:\\PowerShell7\\Modules');
  });
  it('uses the Windows system default when no SystemRoot spelling is supplied', () => {
    expect(windowsPowerShellEnvironment({ PsModulePath: 'C:\\untrusted' }).PSModulePath).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',
    );
  });
});
