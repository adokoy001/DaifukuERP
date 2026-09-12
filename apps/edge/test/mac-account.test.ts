import { describe, expect, it, vi } from 'vitest';
import { dsRecord, inspectMacAccount, prepareMacAccount, validateMacAccountAttributes } from '../setup/posix/account-mac.ts';
import { ownershipTag } from '../setup/posix/render.ts';
import { PosixFixture } from './posix-fixture.ts';
const valid = { UniqueID: '401', PrimaryGroupID: '-2', UserShell: '/usr/bin/false', NFSHomeDirectory: '/var/empty', Password: '*', IsHidden: '1', AuthenticationAuthority: ';DisabledUser;' };
describe('mac directory-service attribute validation', () => {
  it('parses native IsHidden and multiline standard names without treating other native values as ownership', () => {
    const parsed = dsRecord('dsAttrTypeNative:IsHidden: 1\ndsAttrTypeNative:RealName: foreign\nRealName:\n Daifuku edge installer synthetic\nPassword: *\nAuthenticationAuthority: ;DisabledUser;\n');
    expect(parsed.IsHidden).toBe('1'); expect(parsed.RealName).toBe('Daifuku edge installer synthetic'); expect(parsed.Password).toBe('*');
    expect(dsRecord('dsAttrTypeNative:RealName: foreign').RealName).toBeUndefined();
    expect(() => dsRecord('IsHidden: 0\ndsAttrTypeNative:IsHidden: 1')).toThrow('mac_account_duplicate_attribute');
  });
  it.each([
    ['UniqueID', '0', 'uid_invalid'], ['UniqueID', '501', 'uid_invalid'], ['PrimaryGroupID', '0', 'primary_group_changed'],
    ['UserShell', '/bin/zsh', 'shell_changed'], ['NFSHomeDirectory', '/Users/other', 'home_changed'],
    ['Password', 'synthetic-secret', 'password_changed'], ['Password', '********', 'password_changed'],
    ['IsHidden', '0', 'hidden_changed'], ['AuthenticationAuthority', ';ShadowHash;', 'authentication_changed'],
  ])('rejects changed %s with a fixed safe code', (key, value, code) => {
    expect(() => validateMacAccountAttributes({ ...valid, [key]: value }, 4294967294)).toThrow('mac_account_' + code);
  });
  it('accepts the same nobody group numeric encoding but never an unrelated negative group', () => {
    expect(() => validateMacAccountAttributes(valid, 4294967294)).not.toThrow();
    expect(() => validateMacAccountAttributes({ ...valid, PrimaryGroupID: '4294967294' }, 4294967294)).not.toThrow();
    expect(() => validateMacAccountAttributes(valid, 65534)).toThrow('mac_account_primary_group_changed');
  });
  it('creates and verifies its tagged account with the native hidden field serialization', async () => {
    const f = new PosixFixture('darwin'); f.groupId = 4294967294;
    expect(await prepareMacAccount(f, f.context)).toEqual({ name: '_daifukuedge', group: 'nobody', uid: 401, gid: 4294967294 });
    expect(await inspectMacAccount(f, f.context)).toMatchObject({ uid: 401 });
    const before = [...f.changes]; const record = f.user; if (!record) throw new Error('Missing synthetic account'); record.RealName = 'foreign';
    await expect(prepareMacAccount(f, f.context)).rejects.toThrow('not owned'); expect(f.changes).toEqual(before);
    record.RealName = ownershipTag(f.context); record.UserShell = '/bin/zsh';
    await expect(prepareMacAccount(f, f.context)).rejects.toThrow('mac_account_shell_changed'); expect(f.changes).toEqual(before);
  });
});

it('verifies the owned non-login account without mistaking directory nested groups for process credentials', async () => {
  const f = new PosixFixture('darwin'); f.groupId = 4294967294;
  f.user = { ...valid, RealName: ownershipTag(f.context) };
  const run = f.run;
  vi.spyOn(f, 'run').mockImplementation((executable, args) => executable === '/usr/bin/id' && args[0] === '-G'
    ? Promise.resolve({ code: 0, stdout: '4294967294 12 61 701 100', stderr: '' }) : run(executable, args));
  await expect(inspectMacAccount(f, f.context)).resolves.toMatchObject({ uid: 401, gid: 4294967294 });
  expect(f.commands.some((args) => args[0] === '/usr/bin/id' && args[1] === '-G')).toBe(false);
  expect(f.changes).toEqual([]);
});
