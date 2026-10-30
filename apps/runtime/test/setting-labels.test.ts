// docs/specs/settings-console.md AC-13: every setting registered by this repository (all modules and every installed
// pack, like the schema catalog) labels each object property in ja and en, and names every enum value.
import { ensurePackSettings, registry, settingShape, type SettingDef } from '@daifuku/kernel';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRuntime } from '../src/index.ts';

let settings: SettingDef[] = [];

beforeAll(async () => {
  await loadRuntime({ schema: true });
  ensurePackSettings();
  settings = registry.allSettings();
}, 60_000);

const filled = (text: unknown) => typeof text === 'string' && text.trim() !== '';

describe('settings-console AC-13: labels of registered settings', () => {
  it('AC-13: the scan sees the module, pack and kernel settings', () => {
    const keys = settings.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'sales.accounts',
        'sales.issuer',
        'tax.rounding',
        'payment.accounts',
        'purchase.accounts',
        'inventory.default_warehouse',
        'contract.default_proration',
        'retail.closing_accounts',
        'real_estate.accounts',
        'example.default_customer_rank',
        'wholesale.due_days',
        'packs.applied',
      ]),
    );
  });

  it('AC-13: every property of every object setting has ja and en labels in fields', () => {
    const missing: string[] = [];
    for (const def of settings) {
      const shape = settingShape(def.schema);
      if (shape.kind !== 'object') continue;
      for (const name of Object.keys(shape.properties)) {
        const field = def.fields?.[name];
        if (!field || !filled(field.label.ja) || !filled(field.label.en)) missing.push(`${def.key}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('AC-13: every enum value (object property or single value) has ja and en value labels', () => {
    const missing: string[] = [];
    for (const def of settings) {
      const shape = settingShape(def.schema);
      const enums =
        shape.kind === 'object'
          ? Object.entries(shape.properties).map(
              ([name, info]) => [name, info.enum, def.fields?.[name]?.valueLabels] as const,
            )
          : shape.kind === 'scalar'
            ? [['value', shape.enum, def.valueLabels] as const]
            : [];
      for (const [name, values, labels] of enums)
        for (const value of values ?? [])
          if (!labels?.[value] || !filled(labels[value].ja) || !filled(labels[value].en))
            missing.push(`${def.key}.${name}=${value}`);
    }
    expect(missing).toEqual([]);
  });

  it('AC-13: every setting has a ja/en label (and description, when given)', () => {
    for (const def of settings) {
      expect(filled(def.label.ja) && filled(def.label.en), def.key).toBe(true);
      if (def.description) expect(filled(def.description.ja) && filled(def.description.en), def.key).toBe(true);
    }
  });
});
