import { newId } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import { parsePackArgs } from '../src/db/pack-options.ts';

describe('pack CLI explicit company input', () => {
  it('rejects missing, invalid, or repeated company arguments without falling back to demo', () => {
    for (const argv of [
      ['retail', '--company'],
      ['retail', '--company', '--sample'],
      ['retail', '--company', ''],
      ['retail', '--company', newId(), '--company', newId()],
    ]) {
      expect(() => parsePackArgs(argv)).toThrow('--company requires');
    }
  });

  it('preserves a valid explicit target and application options', () => {
    const companyId = newId();
    expect(parsePackArgs(['--', 'retail', '--company', companyId, '--sample', '--force'])).toEqual({
      name: 'retail',
      companyId,
      opts: { sample: true, force: true },
    });
  });
});
