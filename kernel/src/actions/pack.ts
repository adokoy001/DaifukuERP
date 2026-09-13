// Generic pack actions (ADR-0015): `pack.apply` and `pack.list`, exposed through REST/MCP like every action.
// Apps call registerPackActions() after importing their packs (apps/api/src/packs.ts, apps/mcp/src/modules.ts).
import { z } from 'zod';
import { defineAction } from '../dsl/action.ts';
import { label } from '../i18n.ts';
import { appliedPackSchema, applyPack, ensurePackSettings, readAppliedPacks } from '../pack.ts';
import { registry } from '../registry.ts';

const labelSchema = z.object({ ja: z.string(), en: z.string() });

const applyInput = z.object({
  name: z.string().min(1).max(100),
  sample: z.boolean().optional(),
  force: z.boolean().optional(),
});

const applyOutput = z.object({
  name: z.string(),
  version: z.string(),
  alreadyApplied: z.boolean(),
  settings: z.object({ written: z.array(z.string()), kept: z.array(z.string()) }),
  seeded: z.boolean(),
  sampled: z.boolean(),
  record: appliedPackSchema,
});

const packItem = z.object({
  name: z.string(),
  label: labelSchema,
  version: z.string(),
  depends: z.array(z.string()),
  hasSample: z.boolean(),
  applied: z.boolean(),
  appliedAt: z.string().nullable(),
  appliedVersion: z.string().nullable(),
  sampledAt: z.string().nullable(),
});

/** Registers pack.apply / pack.list once (idempotent) and declares the `packs.applied` setting. */
export function registerPackActions(): void {
  ensurePackSettings();
  if (registry.hasAction('pack.apply')) return;
  defineAction({
    name: 'pack.apply',
    description: label(
      'パックを現在の会社に適用します（未設定の設定の既定値・seed・sample=true でサンプルデータ）。適用済みなら force=true のときだけ再実行します。',
      'Apply a pack to the current company: setting defaults for unset keys, seed, and sample data when sample=true. Already applied: runs again only with force=true.',
    ),
    input: applyInput,
    output: applyOutput,
    permission: { roles: ['admin'] },
    mutates: true,
    handler: async (ctx, input) => {
      const opts = {
        ...(input.sample !== undefined ? { sample: input.sample } : {}),
        ...(input.force !== undefined ? { force: input.force } : {}),
      };
      return applyPack(ctx, input.name, opts);
    },
  });
  defineAction({
    name: 'pack.list',
    description: label(
      '読み込まれているパックと、現在の会社への適用状況を一覧します。',
      'List loaded packs with their applied status for the current company.',
    ),
    input: z.object({}),
    output: z.object({ items: z.array(packItem) }),
    permission: 'authenticated',
    siteAccess: true,
    storeAccess: true,
    tx: 'none',
    mutates: false,
    handler: async (ctx) => {
      const applied = await readAppliedPacks(ctx);
      const items = registry.packs().map((p) => {
        const rec = applied[p.name];
        return {
          name: p.name,
          label: p.label,
          version: p.version,
          depends: [...p.depends],
          hasSample: p.sample !== undefined,
          applied: rec !== undefined,
          appliedAt: rec?.at ?? null,
          appliedVersion: rec?.version ?? null,
          sampledAt: rec?.sampledAt ?? null,
        };
      });
      return { items };
    },
  });
}
