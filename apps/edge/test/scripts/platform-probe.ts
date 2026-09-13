import { acquireWriter } from '../../src/lock.ts';
import { privateDirectory, readPrivateJson, syncJson } from '../../src/files.ts';
import { join } from 'node:path';
const directory = process.argv[3];
if (!directory) throw new Error('Synthetic private directory required');
if (process.argv[2] === 'hold') {
  const release = await acquireWriter(directory, () => process.exit(73));
  process.stdout.write('locked\n');
  process.stdin.resume();
  process.stdin.on('end', () => {
    void release().then(() => process.exit(0));
  });
} else if (process.argv[2] === 'check') {
  await privateDirectory(directory);
  const path = join(directory, 'private.json');
  await syncJson(path, { text: '日本語の合成データ', attempt: 1 });
  await syncJson(path, { text: '日本語の合成データ', attempt: 2 });
  if (JSON.stringify(await readPrivateJson(path)) !== JSON.stringify({ text: '日本語の合成データ', attempt: 2 }))
    throw new Error('Synthetic persistence mismatch');
  const release = await acquireWriter(directory, () => process.exit(73));
  let blocked = false;
  try {
    await acquireWriter(directory, () => process.exit(73));
  } catch (error) {
    blocked = error instanceof Error && error.message === 'another_agent_is_running';
  }
  await release();
  if (!blocked) throw new Error('Duplicate writer was not rejected');
  const again = await acquireWriter(directory, () => process.exit(73));
  await again();
  process.stdout.write('private_io_and_lock_passed\n');
} else throw new Error('Unknown synthetic probe');
