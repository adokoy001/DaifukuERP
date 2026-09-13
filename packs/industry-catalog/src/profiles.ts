import { construction, logistics, manufacturing, wholesale } from './profiles-goods.ts';
import { beautySalon, careService, clinic, education, hospitality, professionalService } from './profiles-service.ts';
export const INDUSTRY_PROFILES = [
  wholesale,
  manufacturing,
  construction,
  logistics,
  hospitality,
  clinic,
  careService,
  education,
  professionalService,
  beautySalon,
] as const;
export const INDUSTRY_PACK_NAMES = INDUSTRY_PROFILES.map((profile) => profile.job.name);
