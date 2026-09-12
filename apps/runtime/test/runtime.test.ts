import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { selectedPackNames } from '../src/index.ts';
import { loadPacks } from '../src/packs.ts';

const fixture = fileURLToPath(new URL('./fixtures/catalog.ts', import.meta.url));

function catalog(setting: string, schema = false, shell?: string) {
  const cwd = mkdtempSync(join(tmpdir(), 'daifuku-runtime-'));
  writeFileSync(join(cwd, '.env'), `DAIFUKU_PACKS=${setting}\n`);
  const env = { ...process.env };
  delete env.DAIFUKU_PACKS;
  if (shell !== undefined) env.DAIFUKU_PACKS = shell;
  const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), fixture, ...(schema ? ['--schema'] : [])], { cwd, env, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  return JSON.parse(result.stdout) as { packs: string[]; entities: string[] };
}

describe('foundation-refresh runtime catalog', () => {
  it('AC-2 loads .env before pack registration, with shell environment taking precedence', () => {
    expect(catalog('none').packs).toEqual([]);
    expect(catalog('retail').packs).toEqual(['retail']);
    expect(catalog('real_estate', false, 'none').packs).toEqual([]);
  }, 60000);

  it('AC-3 retains every installed schema when runtime capabilities are disabled', () => {
    const schema = catalog('none', true);
    expect(schema.packs).toEqual(['example', 'retail', 'real_estate', 'appliance_store', 'farm', 'restaurant_chain', 'wholesale', 'manufacturing', 'construction', 'logistics', 'hospitality', 'clinic', 'care_service', 'education', 'professional_service', 'beauty_salon']);
    expect(schema.entities).toEqual(expect.arrayContaining(['real_estate_deposit', 'retail_month_close', 'appliance_store_service', 'farm_harvest', 'restaurant_chain_closing', 'workforce_employee', 'workforce_receipt', 'wholesale_job', 'beauty_salon_job']));
    expect(catalog('none').entities).not.toContain('real_estate_deposit');
    expect(catalog('none').entities).not.toContain('farm_harvest');
    expect(catalog('none').entities).not.toContain('wholesale_job');
    expect(catalog('wholesale').packs).toEqual(['wholesale']);
    expect(catalog('wholesale').entities).not.toContain('beauty_salon_job');
  }, 60000);

  it('AC-2 rejects unknown and inherited names and deduplicates valid selection', async () => {
    for (const name of ['missing', 'constructor', 'toString', '__proto__']) {
      expect(() => selectedPackNames(name)).toThrow('Unknown packs');
      await expect(loadPacks([name])).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    expect(selectedPackNames('retail, retail')).toEqual(['retail']);
  });
});
