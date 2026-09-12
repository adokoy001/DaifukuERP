import { describe, expect, it, vi } from 'vitest';
import { macAccountGroups, numericMacGroups, sameMacGroups } from '../src/macos-membership.ts';
import type { DirectoryRunner } from '../src/macos-membership.ts';
const guid = '11111111-2222-4333-8444-555555555555';
function fixture(options: { groups?: string; explicit?: string; invalidGuid?: string; errorAt?: string; thrown?: boolean } = {}) {
  return vi.fn<DirectoryRunner>(async (file, args) => {
    if (options.errorAt && args.includes(options.errorAt)) {
      if (options.thrown) throw new Error('synthetic directory outage');
      return { code: 70, stdout: '', stderr: 'synthetic directory outage' };
    }
    if (file === '/usr/bin/id') return { code: 0, stdout: options.groups ?? '-2 12 61 701 100\n', stderr: '' };
    if (args[1] === '-read') return { code: 0, stdout: options.invalidGuid ?? 'GeneratedUID: ' + guid + '\n', stderr: '' };
    if (args[1] === '-search') return { code: 0, stdout: args[3] === options.explicit ? 'synthetic_group\t\t' + args[3] + ' = explicit value\n' : '', stderr: '' };
    throw new Error('Unexpected fixture command');
  });
}
describe('macOS directory membership policy', () => {
  it('accepts ordinary computed groups with no direct name/UUID or nested user-UUID assignment', async () => {
    const run = fixture();
    await expect(macAccountGroups(run)).resolves.toEqual([12, 61, 100, 701, 4294967294]);
    expect(run.mock.calls).toContainEqual(['/usr/bin/dscl', ['/Search', '-search', '/Groups', 'GroupMembership', '_daifukuedge']]);
    expect(run.mock.calls).toContainEqual(['/usr/bin/dscl', ['/Search', '-search', '/Groups', 'GroupMembers', guid]]);
    expect(run.mock.calls).toContainEqual(['/usr/bin/dscl', ['/Search', '-search', '/Groups', 'NestedGroups', guid]]);
  });
  it.each(['GroupMembership', 'GroupMembers', 'NestedGroups'])('rejects any explicit %s assignment, including an ordinary group', async (explicit) => {
    await expect(macAccountGroups(fixture({ explicit }))).rejects.toThrow('mac_account_explicit_group_membership');
  });
  it.each([0, 80, 98, 204])('rejects effective privileged group %s even without a direct assignment', async (group) => {
    await expect(macAccountGroups(fixture({ groups: '-2 12 61 100 ' + group }))).rejects.toThrow('mac_account_privileged_group_membership');
  });
  it.each(['GeneratedUID', 'GroupMembership', 'GroupMembers', 'NestedGroups', '-G'])('never treats a failed %s lookup as no membership', async (errorAt) => {
    await expect(macAccountGroups(fixture({ errorAt }))).rejects.toThrow('mac_account_membership_lookup_failed');
  });
  it('fails closed on a thrown transport error or invalid/multiple UUIDs', async () => {
    await expect(macAccountGroups(fixture({ errorAt: 'GroupMembers', thrown: true }))).rejects.toThrow();
    for (const invalidGuid of ['', 'GeneratedUID: invalid', 'GeneratedUID: ' + guid + '\nGeneratedUID: ' + guid]) await expect(macAccountGroups(fixture({ invalidGuid }))).rejects.toThrow('mac_account_guid_invalid');
  });
  it('normalizes signed nobody, ordering and duplicates but never accepts malformed group text', () => {
    expect(numericMacGroups('-2 12 12\n61')).toEqual([12, 61, 4294967294]);
    expect(sameMacGroups([12, 61, 100], [100, 61, 12, 12])).toBe(true); expect(sameMacGroups([12, 61], [12, 61, 100])).toBe(false);
    for (const value of ['', '-1', 'nobody 12', '4294967296', '1.5']) expect(() => numericMacGroups(value)).toThrow('mac_account_group_list_invalid');
  });
});
