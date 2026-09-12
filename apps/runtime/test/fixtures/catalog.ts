import { registry } from '@daifuku/kernel';
import { loadRuntime } from '../../src/index.ts';

const runtime = await loadRuntime({ schema: process.argv.includes('--schema') });
process.stdout.write(JSON.stringify({ packs: runtime.packs.map((pack) => pack.name), entities: registry.allEntities().map((entity) => entity.name) }));
