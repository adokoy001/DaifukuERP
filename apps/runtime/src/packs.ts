import { ValidationError, type PackDef } from '@daifuku/kernel';

const AVAILABLE: Readonly<Record<string, () => Promise<PackDef>>> = {
  example: async () => (await import('@daifuku/pack-example')).ExamplePack,
  retail: async () => (await import('@daifuku/pack-retail')).RetailPack,
  real_estate: async () => (await import('@daifuku/pack-real-estate')).RealEstatePack,
  appliance_store: async () => (await import('@daifuku/pack-appliance-store')).ApplianceStorePack,
  farm: async () => (await import('@daifuku/pack-farm')).FarmPack,
  restaurant_chain: async () => (await import('@daifuku/pack-restaurant-chain')).RestaurantChainPack,
  wholesale: async () => (await import('@daifuku/pack-industry-catalog')).loadIndustryPack('wholesale'),
  manufacturing: async () => (await import('@daifuku/pack-industry-catalog')).loadIndustryPack('manufacturing'),
  construction: async () => (await import('@daifuku/pack-industry-catalog')).loadIndustryPack('construction'),
  logistics: async () => (await import('@daifuku/pack-industry-catalog')).loadIndustryPack('logistics'),
  hospitality: async () => (await import('@daifuku/pack-industry-catalog')).loadIndustryPack('hospitality'),
  clinic: async () => (await import('@daifuku/pack-industry-catalog')).loadIndustryPack('clinic'),
  care_service: async () => (await import('@daifuku/pack-industry-catalog')).loadIndustryPack('care_service'),
  education: async () => (await import('@daifuku/pack-industry-catalog')).loadIndustryPack('education'),
  professional_service: async () =>
    (await import('@daifuku/pack-industry-catalog')).loadIndustryPack('professional_service'),
  beauty_salon: async () => (await import('@daifuku/pack-industry-catalog')).loadIndustryPack('beauty_salon'),
};

export function selectedPackNames(env: string | undefined = process.env.DAIFUKU_PACKS): string[] {
  const raw = (env ?? 'all').trim();
  if (raw === '' || raw === 'all') return Object.keys(AVAILABLE);
  if (raw === 'none') return [];
  const names = [
    ...new Set(
      raw
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
  const unknown = names.filter((name) => !Object.hasOwn(AVAILABLE, name));
  if (unknown.length)
    throw new ValidationError(`Unknown packs: ${unknown.join(', ')}`, [
      { path: 'DAIFUKU_PACKS', message: 'unknown pack' },
    ]);
  return names;
}

export async function loadPacks(names: readonly string[]): Promise<PackDef[]> {
  const loaded: PackDef[] = [];
  for (const name of names) {
    if (!Object.hasOwn(AVAILABLE, name))
      throw new ValidationError(`Unknown packs: ${name}`, [{ path: 'DAIFUKU_PACKS', message: 'unknown pack' }]);
    const load = AVAILABLE[name];
    if (load) loaded.push(await load());
  }
  return loaded;
}
