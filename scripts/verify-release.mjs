import { parseArgs } from 'node:util';
import { safePath, verifyRelease } from '../deploy/files.mjs';
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    'Usage: node scripts/verify-release.mjs --release /absolute/bundle --manifest-sha256 <approved64hex>\nRead-only content, file-mode and internal-link verification.\n',
  );
  process.exit(0);
}
try {
  const { values } = parseArgs({ options: { release: { type: 'string' }, 'manifest-sha256': { type: 'string' } } });
  if (!values.release || !/^[a-f0-9]{64}$/.test(values['manifest-sha256'] ?? ''))
    throw new Error('Supply --release /absolute/bundle --manifest-sha256 <trusted release digest>.');
  const result = await verifyRelease(safePath(values.release), values['manifest-sha256']);
  process.stdout.write(
    JSON.stringify({
      verified: true,
      commit: result.manifest.commit,
      candidate: result.manifest.candidate,
      manifestSha256: result.sha256,
    }) + '\n',
  );
} catch {
  process.stderr.write('Release verification failed; no service or data was changed.\n');
  process.exitCode = 1;
}
