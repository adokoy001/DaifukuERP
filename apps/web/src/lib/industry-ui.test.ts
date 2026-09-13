import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getCompanyId, getToken, getUser, request, setActiveCompany, setSession } from '../api/client.ts';
import type { EntityMeta, LoginUser } from '../api/types.ts';
import { refResolverFrom, schemaFields } from './schema.ts';
import { templateOrder, templateStory } from './templates.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const user: LoginUser = {
  id: 'user-a',
  tenantId: 'tenant-a',
  defaultCompanyId: 'default-a',
  name: 'A',
  email: 'a@example.com',
  roles: ['admin'],
};
afterEach(() => vi.unstubAllGlobals());

describe('industry template UI contracts', () => {
  it('keeps company selection in the current tab without changing the saved default and clears it on login/logout', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    const tabA = new MemoryStorage();
    vi.stubGlobal('sessionStorage', tabA);
    setSession('token', user);
    expect(getCompanyId()).toBe('default-a');
    setActiveCompany('farm');
    expect(getCompanyId()).toBe('farm');
    expect(getUser()?.defaultCompanyId).toBe('default-a');
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    expect(getCompanyId()).toBeNull();
    vi.stubGlobal('sessionStorage', tabA);
    expect(getCompanyId()).toBe('farm');
    setSession('token-b', { ...user, id: 'user-b', tenantId: 'tenant-b', defaultCompanyId: 'default-b' });
    expect(getCompanyId()).toBe('default-b');
    setSession('token', user);
    expect(getCompanyId()).toBe('default-a');
    setActiveCompany('farm');
    clearSession();
    expect(getCompanyId()).toBeNull();
  });
  it('keeps tab A credentials and request company when tab B logs into a different tenant', async () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    const tabA = new MemoryStorage();
    const tabB = new MemoryStorage();
    vi.stubGlobal('sessionStorage', tabA);
    setSession('token-a', user);
    setActiveCompany('company-a-selected');
    const unsavedInput = { name: 'Customer entered for company A' };
    vi.stubGlobal('sessionStorage', tabB);
    setSession('token-b', { ...user, id: 'user-b', tenantId: 'tenant-b', defaultCompanyId: 'company-b' });
    setActiveCompany('company-b-selected');
    expect(getToken()).toBe('token-b');
    vi.stubGlobal('sessionStorage', tabA);
    expect(getUser()?.id).toBe('user-a');
    expect(getToken()).toBe('token-a');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await request('/api/partner', { method: 'POST', body: unsavedInput });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/partner'),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer token-a', 'x-company-id': 'company-a-selected' }),
        body: JSON.stringify(unsavedInput),
      }),
    );
    vi.stubGlobal('sessionStorage', tabB);
    expect(getCompanyId()).toBe('company-b-selected');
  });
  it('does not restore legacy shared localStorage credentials', () => {
    const legacy = new MemoryStorage();
    legacy.setItem('daifuku.token', 'legacy-token');
    legacy.setItem('daifuku.user', JSON.stringify(user));
    vi.stubGlobal('localStorage', legacy);
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    expect(getToken()).toBeNull();
    expect(getUser()).toBeNull();
    expect(getCompanyId()).toBeNull();
  });
  it('resolves industry references only within the visible module while retaining core references', () => {
    const entities = [
      { name: 'farm_season', displayField: 'name' },
      { name: 'appliance_store_service', displayField: 'number' },
      { name: 'partner', displayField: 'name' },
    ] as EntityMeta[];
    const input = {
      type: 'object',
      properties: {
        seasonId: { type: 'string', format: 'uuid' },
        partnerId: { type: 'string', format: 'uuid' },
        serviceId: { type: 'string', format: 'uuid' },
      },
    };
    const fields = schemaFields(input, refResolverFrom(entities, 'farm'));
    expect(fields[0]).toMatchObject({ kind: 'ref', ref: 'farm_season' });
    expect(fields[1]).toMatchObject({ kind: 'ref', ref: 'partner' });
    expect(fields[2]).toMatchObject({ kind: 'text' });
    expect(schemaFields(input, refResolverFrom([], 'farm'))[0]?.kind).toBe('text');
  });
  it('provides distinct narratives for all requested industries', () => {
    expect(templateOrder.slice(0, 3)).toEqual(['appliance_store', 'farm', 'restaurant_chain']);
    expect(templateOrder.slice(0, 3).map((name) => templateStory(name).icon)).toEqual(['appliance', 'leaf', 'dining']);
    expect(templateStory('future').steps).toEqual([]);
  });
});
