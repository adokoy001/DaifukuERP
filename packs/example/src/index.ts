// @daifuku/pack-example public API (docs/specs/pack.md AC-6). Importing it registers the pack (ext, entity, action, labels).
export { ExamplePack } from './pack.ts';
export { ExampleTag } from './entities/example-tag.ts';
export { helloAction } from './actions/hello.ts';
export { SEED_TAGS, seedExample } from './seed.ts';
export { SAMPLE_PARTNER_CODES, sampleExample } from './sample.ts';
export { CUSTOMER_RANKS, DEFAULT_RANK, DEFAULT_RANK_KEY, defaultRankSchema, type CustomerRank } from './settings.ts';
