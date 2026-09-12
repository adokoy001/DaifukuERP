import { createHash } from 'node:crypto';
import { isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Build evidence only. The release collector removes this metadata after copying full licenses. */
export function licenseInputs(): Plugin {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  return {
    name: 'daifuku-license-inputs',
    apply: 'build',
    generateBundle(_options, bundle) {
      const inputs = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(output.modules)) {
          if (module.renderedLength === 0 || id.startsWith('\0') || !id.includes('/node_modules/')) continue;
          const path = relative(root, id.split('?')[0] ?? id);
          if (path.startsWith('..') || isAbsolute(path)) throw new Error('Bundled license input escapes source.');
          inputs.add(path);
        }
      }
      const body = JSON.stringify([...inputs].sort()) + '\n';
      const hash = createHash('sha256').update(body).digest('hex');
      this.emitFile({ type: 'asset', fileName: `.license-inputs/${hash}.json`, source: body });
    },
  };
}
