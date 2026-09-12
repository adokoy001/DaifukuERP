// The smallest pack that exercises every definePack feature (docs/specs/pack.md AC-6; docs/conventions/packs.md).
// Importing @daifuku/mod-partner first registers the partner module, which `depends` and the ext/labels on partner require.
import { definePack, f, label, registry } from '@daifuku/kernel';
import { PartnerModule } from '@daifuku/mod-partner';
import { helloAction } from './actions/hello.ts';
import { ExampleTag } from './entities/example-tag.ts';
import { sampleExample } from './sample.ts';
import { seedExample } from './seed.ts';
import { CUSTOMER_RANKS, DEFAULT_RANK, DEFAULT_RANK_KEY, DEFAULT_RANK_SETTING } from './settings.ts';

export const ExamplePack = definePack({
  name: 'example',
  label: label('サンプルパック', 'Example pack'),
  version: '0.1.0',
  depends: [PartnerModule.name],
  ext: {
    partner: {
      customerRank: f.enum(CUSTOMER_RANKS, {
        label: label('顧客ランク', 'Customer rank'),
        labels: { A: label('A（重点）', 'A (key)'), B: label('B', 'B'), C: label('C', 'C') },
      }),
      note2: f.text({ label: label('備考2', 'Note 2'), searchable: true, maxLength: 200 }),
    },
  },
  entities: [ExampleTag],
  actions: [helloAction],
  hooks: () => {
    registry.registerSetting(DEFAULT_RANK_SETTING);
  },
  settings: { [DEFAULT_RANK_KEY]: DEFAULT_RANK },
  labels: { partner: { entity: label('得意先/仕入先', 'Customer/Supplier') } },
  menus: [{ label: label('タグ', 'Tags'), entity: ExampleTag.name, order: 90 }],
  seed: seedExample,
  sample: sampleExample,
});
