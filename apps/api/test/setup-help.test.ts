import { describe, expect, it, vi } from 'vitest';
import { main } from '../src/setup/cli.ts';

describe('setup CLI help', () => {
  it.each([['--help'], ['-h'], ['install', '--execute', '--env', '/nonexistent/private-input', '--state-dir', '/nonexistent/setup-state', '--help']])('prints usage without reading configuration or executing for %j', async (...args) => {
    const output: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { output.push(String(chunk)); return true; });
    try {
      await expect(main(args)).resolves.toBeUndefined();
      expect(output.join('')).toContain('pnpm run setup install|upgrade');
      expect(output.join('')).toContain('default: read-only plan');
      expect(output.join('')).not.toContain('/nonexistent/private-input');
    } finally { write.mockRestore(); }
  });
});
