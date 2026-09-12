import { registry } from '@daifuku/kernel';
import { loadRuntime } from '@daifuku/runtime';

await loadRuntime();

export function loadModules(): { modules: string[]; entities: number; actions: number } {
  return { modules: registry.allModules().map((module) => module.name), entities: registry.allEntities().length, actions: registry.actions().length };
}
