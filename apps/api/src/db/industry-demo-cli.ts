import { connect } from '@daifuku/kernel';
import { requireEnv } from '../config.ts';
import { seedIndustryDemos } from './industry-demos.ts';

async function main() {
  const owner = connect(requireEnv('DATABASE_URL_OWNER'), { max: 2 });
  try {
    process.stdout.write(`${JSON.stringify(await seedIndustryDemos(owner), null, 2)}\n`);
  } finally {
    await owner.close();
  }
}
main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
