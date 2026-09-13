import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digest, inventory, restrictedSource, verifyRelease } from '../files.mjs';
import { copyRuntime } from '../runtime.mjs';
import { writeWebNotices } from '../web-notices.mjs';
import { renderProfile } from '../profile.mjs';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'daifuku-deploy-test-')),
    release = join(root, 'release'),
    state = join(root, 'state');
  await mkdir(release);
  await mkdir(state, { mode: 0o700 });
  await mkdir(join(release, 'web'));
  await writeFile(join(release, 'web/index.html'), 'synthetic SPA');
  const manifest = {
    format: 1,
    node: process.version,
    commit: 'a'.repeat(40),
    candidate: true,
    platform: 'linux',
    arch: process.arch,
    apiBase: '/api',
    files: await inventory(release),
  };
  const body = JSON.stringify(manifest);
  await writeFile(join(release, 'manifest.json'), body);
  const config = join(state, 'runtime.env');
  await writeFile(
    config,
    `NODE_ENV=production\nHOST=127.0.0.1\nPORT=3000\nTRUSTED_PROXY_CIDRS=127.0.0.1/32\nDAIFUKU_STORAGE_DIR=${state}/evidence\nSECRET=synthetic-never-in-profile\n`,
    { mode: 0o600 },
  );
  return {
    root,
    release,
    state,
    config,
    manifestHash: digest(body),
    output: join(root, 'profile'),
    node: process.execPath,
    user: userInfo().username,
    hostname: 'erp.example.test',
    profile: 'cloud',
    allowCandidate: true,
  };
}
test('verifies exact files, modes, internal links and approved manifest, rejecting tampering', async () => {
  const f = await fixture();
  try {
    await verifyRelease(f.release, f.manifestHash);
    await assert.rejects(verifyRelease(f.release, 'b'.repeat(64)));
    await chmod(join(f.release, 'web/index.html'), 0o600);
    await assert.rejects(verifyRelease(f.release, f.manifestHash));
    await symlink(f.config, join(f.release, 'escape'));
    await assert.rejects(inventory(f.release));
    for (const path of ['.env', 'apps/api/.env.local', '.data/files', 'backups/db.dump', 'secret.key', '.npmrc'])
      assert.equal(restrictedSource(path), true);
    assert.equal(restrictedSource('.env.example'), false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
test('plan makes no files; explicit rendering creates only its new profile and private evidence, never services or secrets', async () => {
  const f = await fixture();
  try {
    const before = await readFile(f.config, 'utf8');
    const plan = await renderProfile(f);
    assert.equal(plan.servicesStarted, false);
    await assert.rejects(lstat(f.output));
    await assert.rejects(lstat(join(f.state, 'evidence')));
    await renderProfile({ ...f, execute: true });
    const unit = await readFile(join(f.output, 'daifuku-api.service'), 'utf8');
    assert.match(unit, /--env-file=/);
    assert.doesNotMatch(unit, /EnvironmentFile|synthetic-never/);
    assert.match(await readFile(join(f.output, 'Caddyfile'), 'utf8'), /handle_path \/api\/\*/);
    assert.equal(await readFile(f.config, 'utf8'), before);
    assert.equal((await lstat(join(f.state, 'evidence'))).mode & 0o777, 0o700);
    await assert.rejects(renderProfile({ ...f, execute: true }));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
test('both profiles share byte-identical release; candidate, secret permissions, path injection and crossing operations are refused', async () => {
  const f = await fixture();
  try {
    const cloud = await renderProfile(f);
    const local = await renderProfile({
      ...f,
      profile: 'onprem',
      cert: '/etc/ssl/erp.crt',
      key: '/etc/ssl/erp.key',
      hostname: 'erp.office.example',
    });
    assert.equal(cloud.manifestHash, local.manifestHash);
    await assert.rejects(renderProfile({ ...f, allowCandidate: false }));
    await assert.rejects(renderProfile({ ...f, user: 'different-service-user' }));
    for (const hostname of [
      'example.test { malicious }',
      '192.0.2.1',
      'erp.local',
      'erp.internal',
      'erp.localhost',
      'erp.-invalid.test',
      '0x7f.0.0.1',
    ])
      await assert.rejects(renderProfile({ ...f, hostname }));
    await assert.rejects(renderProfile({ ...f, output: join(f.state, 'overwrite') }));
    await chmod(f.config, 0o644);
    await assert.rejects(renderProfile(f));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('runtime copies the installed production graph exactly, preserves portable links and omits unrelated dev packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'daifuku-runtime-test-')),
    stage = join(root, 'stage'),
    output = join(root, 'runtime');
  try {
    const api = join(stage, 'apps/api'),
      dep = join(stage, 'node_modules/.pnpm/dep@1.2.3/node_modules/dep');
    await mkdir(join(api, 'node_modules'), { recursive: true });
    await mkdir(dep, { recursive: true });
    for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json'])
      await writeFile(join(stage, name), '{}');
    await writeFile(
      join(api, 'package.json'),
      JSON.stringify({ name: 'api', version: '1', dependencies: { dep: '^1.0.0' }, devDependencies: { unused: '*' } }),
    );
    await writeFile(
      join(dep, 'package.json'),
      JSON.stringify({ name: 'dep', version: '1.2.3', peerDependencies: { optionalPeer: '*' } }),
    );
    await symlink('../../../node_modules/.pnpm/dep@1.2.3/node_modules/dep', join(api, 'node_modules/dep'));
    await mkdir(join(stage, 'node_modules/.pnpm/node_modules'));
    await symlink('../dep@1.2.3/node_modules/dep', join(stage, 'node_modules/.pnpm/node_modules/dep'));
    const packages = await copyRuntime(stage, output);
    assert.deepEqual(
      packages.map((p) => [p.name, p.version]),
      [
        ['api', '1'],
        ['dep', '1.2.3'],
      ],
    );
    assert.equal(JSON.parse(await readFile(join(output, 'apps/api/node_modules/dep/package.json'))).version, '1.2.3');
    await inventory(output);
    assert.equal(
      JSON.parse(await readFile(join(output, 'node_modules/.pnpm/node_modules/dep/package.json'))).version,
      '1.2.3',
    );
    await rm(stage, { recursive: true, force: true });
    assert.equal(JSON.parse(await readFile(join(output, 'apps/api/node_modules/dep/package.json'))).version, '1.2.3');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('all release command help paths exit successfully without reading a release, configuration or database', () => {
  for (const name of ['build-release', 'verify-release', 'deploy-plan']) {
    const script = fileURLToPath(new URL(`../../scripts/${name}.mjs`, import.meta.url));
    assert.match(execFileSync(process.execPath, [script, '--help'], { encoding: 'utf8', env: {} }), /Usage:/);
  }
});

test('real main/worker Web build includes React/TanStack full licenses and fixed versions, without backend dependencies', async () => {
  const stage = fileURLToPath(new URL('../../', import.meta.url)),
    root = await mkdtemp(join(tmpdir(), 'daifuku-web-notices-')),
    output = join(root, 'web');
  try {
    const env = { NODE_ENV: 'production', VITE_API_URL: '/api' };
    for (const key of ['PATH', 'HOME', 'USER', 'PNPM_HOME']) if (process.env[key]) env[key] = process.env[key];
    execFileSync('pnpm', ['--filter', '@daifuku/web', 'exec', 'vite', 'build', '--outDir', output], {
      cwd: stage,
      env,
      stdio: 'pipe',
      maxBuffer: 8 * 1024 * 1024,
    });
    const evidence = await readdir(join(output, '.license-inputs'));
    assert.ok(evidence.length >= 2, 'both main and recommendation worker builds must report contributing inputs');
    for (const file of evidence) {
      const ids = JSON.parse(await readFile(join(output, '.license-inputs', file), 'utf8'));
      assert.ok(ids.every((id) => !id.startsWith('/') && !id.includes(stage)));
    }
    const packages = await writeWebNotices(stage, output);
    const text = await readFile(join(output, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    for (const name of [
      'react',
      'react-dom',
      '@tanstack/react-query',
      '@tanstack/react-router',
      '@tanstack/react-table',
      'tailwindcss',
    ]) {
      const installed = join(stage, 'apps/web/node_modules', name);
      const metadata = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
      const license = await readFile(join(installed, 'LICENSE'), 'utf8');
      assert.ok(packages.some((pkg) => pkg.name === name && pkg.version === metadata.version));
      assert.ok(text.includes(name + '@' + metadata.version));
      assert.ok(text.includes(license), 'must retain full upstream copyright and license: ' + name);
      assert.match(license, /Permission is hereby granted/);
    }
    assert.ok(!packages.some((pkg) => ['drizzle-orm', 'drizzle-kit', 'postgres', 'esbuild'].includes(pkg.name)));
    assert.ok(text.includes(await readFile(join(stage, 'vendor/feather/LICENSE'), 'utf8')));
    assert.ok(packages.some((pkg) => pkg.name === 'feather-icons' && pkg.version === '4.29.2'));
    assert.equal(await readFile(join(output, 'LICENSE'), 'utf8'), await readFile(join(stage, 'LICENSE'), 'utf8'));
    await assert.rejects(lstat(join(output, '.license-inputs')));
    const files = await inventory(output);
    for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.txt', 'web-packages.json'])
      assert.ok(files.some((file) => file.path === name && file.bytes > 0 && file.sha256));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Web notices retain all contributing package NOTICEs and reject missing/empty licenses before emission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'daifuku-web-license-test-')),
    stage = join(root, 'stage'),
    output = join(root, 'output');
  try {
    const web = join(stage, 'apps/web'),
      dep = join(web, 'node_modules/frozen'),
      child = join(dep, 'node_modules/child');
    await mkdir(child, { recursive: true });
    await mkdir(join(output, '.license-inputs'), { recursive: true });
    await writeFile(join(stage, 'LICENSE'), 'synthetic project license');
    await mkdir(join(stage, 'vendor/feather'), { recursive: true });
    await writeFile(join(stage, 'vendor/feather/LICENSE'), 'synthetic icon license');
    const css = join(web, 'node_modules/tailwindcss');
    await mkdir(css, { recursive: true });
    await writeFile(
      join(css, 'package.json'),
      JSON.stringify({ name: 'tailwindcss', version: '4.0.0', license: 'MIT' }),
    );
    await writeFile(join(css, 'index.css'), 'synthetic CSS');
    await writeFile(join(css, 'LICENSE'), 'synthetic CSS license');
    await writeFile(join(dep, 'package.json'), JSON.stringify({ name: 'frozen', version: '1.2.3' }));
    await writeFile(join(dep, 'index.js'), 'export const value = 1;');
    await writeFile(join(dep, 'LICENSE'), 'synthetic license A');
    await writeFile(join(dep, 'NOTICE'), 'synthetic attribution must survive minification');
    await writeFile(join(child, 'package.json'), JSON.stringify({ name: 'child', version: '2.3.4' }));
    await writeFile(join(child, 'index.js'), 'export const value = 2;');
    await writeFile(
      join(output, '.license-inputs', 'a'.repeat(64) + '.json'),
      JSON.stringify([
        'apps/web/node_modules/frozen/index.js',
        'apps/web/node_modules/frozen/node_modules/child/index.js',
      ]),
    );
    await assert.rejects(writeWebNotices(stage, output), /license is missing: child@2.3.4/);
    await assert.rejects(lstat(join(output, 'LICENSE')));
    await writeFile(join(child, 'LICENSE.txt'), '   ');
    await assert.rejects(writeWebNotices(stage, output), /notice is empty/);
    await assert.rejects(lstat(join(output, 'THIRD_PARTY_NOTICES.txt')));
    await writeFile(join(child, 'LICENSE.txt'), 'synthetic license B');
    const packages = await writeWebNotices(stage, output);
    assert.deepEqual(packages.map((pkg) => pkg.name).sort(), ['child', 'feather-icons', 'frozen', 'tailwindcss']);
    const text = await readFile(join(output, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    for (const required of [
      'synthetic attribution must survive minification',
      'synthetic license A',
      'synthetic license B',
    ])
      assert.ok(text.includes(required));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Web release refuses absent build evidence or an input outside its frozen source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'daifuku-web-evidence-test-')),
    stage = join(root, 'stage'),
    output = join(root, 'web');
  try {
    await mkdir(stage);
    await mkdir(output);
    await assert.rejects(writeWebNotices(stage, output));
    await mkdir(join(output, '.license-inputs'));
    await writeFile(join(output, '.license-inputs', 'b'.repeat(64) + '.json'), JSON.stringify(['../private.js']));
    await assert.rejects(writeWebNotices(stage, output), /Invalid Web license input/);
    await assert.rejects(lstat(join(output, 'THIRD_PARTY_NOTICES.txt')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
