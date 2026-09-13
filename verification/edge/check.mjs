import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const tool = JSON.parse(await readFile(join(here, 'tool.json'), 'utf8'));
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  const name = args[i];
  if (!['--jar', '--java', '--only'].includes(name) || !args[i + 1]) throw new Error('Use --jar PATH, --java PATH, or --only base|mutations|witnesses|traces');
  options[name.slice(2)] = args[i + 1];
}
if (options.only && !['base', 'mutations', 'witnesses', 'traces'].includes(options.only)) throw new Error('Unknown check selection');
const runRoot = join(root, 'coverage/edge-model', randomUUID());
await mkdir(runRoot, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function verifiedJar() {
  const path = options.jar ? resolve(options.jar) : join(root, '.cache/tla', `tla2tools-${tool.version}.jar`);
  let bytes;
  try { bytes = await readFile(path); } catch (error) {
    if (error.code !== 'ENOENT' || options.jar) throw error;
    const response = await globalThis.fetch(tool.url, { signal: globalThis.AbortSignal.timeout(30000) });
    if (!response.ok || new URL(response.url).protocol !== 'https:') throw new Error('Official TLC download failed');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > tool.bytes) throw new Error('TLC asset size mismatch'); chunks.push(chunk); }
    bytes = Buffer.concat(chunks);
    if (bytes.length !== tool.bytes || hash(bytes) !== tool.sha256) throw new Error('TLC asset hash mismatch');
    await mkdir(dirname(path), { recursive: true });
    const temporary = path + '.' + randomUUID(); await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, path);
  }
  if (bytes.length !== tool.bytes || hash(bytes) !== tool.sha256) throw new Error('TLC asset hash mismatch');
  return path;
}
const jar = await verifiedJar(), java = options.java ?? 'java', results = [];
const baseConfig = await readFile(join(here, 'Edge.cfg'), 'utf8');
async function check(name, config, expected, module = 'Edge', content) {
  const directory = join(runRoot, name); await mkdir(directory);
  for (const file of ['Edge.tla', 'EdgeTrace.tla']) await copyFile(join(here, file), join(directory, file));
  if (content) await writeFile(join(directory, module + '.tla'), content);
  await writeFile(join(directory, module + '.cfg'), config);
  const start = performance.now(); let stdout = '', stderr = '', code = 0;
  try {
    ({ stdout, stderr } = await promisify(execFile)(java, ['-XX:+UseParallelGC', '-Xmx768m', '-cp', jar, 'tlc2.TLC', '-workers', '1', '-seed', '1', '-fp', '0', '-metadir', join(directory, 'states'), '-config', module + '.cfg', module + '.tla'], { cwd: directory, timeout: 240000, maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; code = error.code; }
  await writeFile(join(directory, 'tlc.log'), stdout + stderr);
  const violation = stdout.match(/Invariant (\w+) is violated/); const invariant = violation?.[1];
  const witnessStates = [...stdout.matchAll(/^State \d+:/gm)].length;
  const passed = expected
    ? code === 12 && invariant === expected && witnessStates > 0 && /The behavior up to this point is:/.test(stdout)
    : code === 0 && /Model checking completed\. No error has been found\./.test(stdout) && /0 states left on queue\./.test(stdout);
  const counts = stdout.match(/(\d+) states generated, (\d+) distinct states found, (\d+) states left on queue/);
  const result = { name, passed, expected: expected ?? 'complete finite exploration', invariant: invariant ?? null, exitCode: code, elapsedMs: Math.round(performance.now() - start), generated: counts ? Number(counts[1]) : null, distinct: counts ? Number(counts[2]) : null, witnessStates };
  results.push(result); console.log(JSON.stringify(result));
  await writeFile(join(runRoot, 'result.json'), JSON.stringify({ tool, limits: { jobs: 2, workers: 2, attempts: 2, claimPerWorker: 1, crashesPerWorker: 1 }, results }, null, 2) + '\n');
  if (!passed) throw new Error(`TLC check failed: ${name}; inspect ${join(directory, 'tlc.log')}`);
}
const selected = (name) => !options.only || options.only === name;
const invariantConfig = (invariant, mutation = 'none') => baseConfig.replace('Mutation = "none"', `Mutation = "${mutation}"`).replace(/INVARIANTS[\s\S]*/, `INVARIANTS TypeOK ${invariant}\n`);
if (selected('base')) await check('safety', baseConfig);
if (selected('mutations')) {
  for (const [mutation, invariant] of [['start', 'StartUnique'], ['requeue', 'NoStartedRequeue'], ['fence', 'FencingSafe'], ['resolve', 'ResolvedSafe'], ['claim', 'ClaimSafe']]) await check('mutation-' + mutation, invariantConfig(invariant, mutation), invariant);
}
if (selected('witnesses')) {
  for (const invariant of ['NotLostStart', 'NotLostComplete', 'NotObsolete', 'NotResolved', 'NotPhysicalSend']) await check('witness-' + invariant, invariantConfig(invariant), invariant);
}
// These are deliberately authored, reviewable traces, not an inferred TS proof.
const tla = (value) => Array.isArray(value) ? `<<${value.map(tla).join(', ')}>>` : JSON.stringify(value);
if (selected('traces')) {
  const traces = JSON.parse(await readFile(join(here, 'traces.json'), 'utf8'));
  for (const trace of traces) {
    const inputs = { TraceEvents: trace.steps.map((s) => s.event), TraceStates: trace.steps.map((s) => s.states), TraceAttempts: trace.steps.map((s) => s.attempts), TraceGrants: trace.steps.map((s) => s.grants), TraceJournals: trace.steps.map((s) => s.journals), TraceSends: trace.steps.map((s) => s.sends) };
    const extra = Object.keys(inputs).map((key) => `  ${key} <- Input${key}`).join('\n');
    const module = '---- MODULE TraceCase ----\nEXTENDS EdgeTrace\n' + Object.entries(inputs).map(([key, value]) => `Input${key} == ${tla(value)}`).join('\n') + '\n====\n';
    const config = baseConfig.replace('CONSTANTS', 'CONSTANTS\n' + extra).replace('KeepEvent = FALSE', 'KeepEvent = TRUE').replace('SPECIFICATION Spec', 'SPECIFICATION TraceSpec');
    await check('trace-' + trace.id, config + ' ProjectionMatches TraceUnfinished\n', 'TraceUnfinished', 'TraceCase', module);
  }
}
console.log(`Edge model evidence: ${runRoot}`);
