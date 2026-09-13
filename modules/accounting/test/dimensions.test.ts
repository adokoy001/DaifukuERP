import { defineEntity, f, label, registry } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import { postingDimensions } from '../src/dimensions.ts';

const source = defineEntity({
  name: 'dimension_source',
  label: label('元', 'Source'),
  fields: { name: f.text() },
  permissions: { roles: { viewer: ['read'] } },
});
const target = defineEntity({
  name: 'dimension_target',
  label: label('先', 'Target'),
  fields: { name: f.text() },
  permissions: { roles: { viewer: ['read'] } },
});
registry.registerExt(source.name, { department: f.text(), sourceNote: f.text() }, { source: 'test:dimensions' });
registry.registerExt(target.name, { department: f.text(), postingNote: f.text() }, { source: 'test:dimensions' });

describe('explicit posting dimensions', () => {
  it('copies only keys registered on both sides and preserves null values', () => {
    expect(
      postingDimensions(source.name, target.name, { department: 'Operations', sourceNote: 'private', unknown: 'x' }),
    ).toEqual({ department: 'Operations' });
    expect(postingDimensions(source.name, target.name, { department: null })).toEqual({ department: null });
    expect(postingDimensions(source.name, target.name, undefined)).toEqual({});
  });
});
