import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { z } from 'zod';
import { edgeSecret } from '@daifuku/mod-edge-integration/contract';
import { EdgeAgent } from './agent.ts';
import { loadConfig } from './config.ts';
import { Credentials } from './credentials.ts';
import { EdgeError, errorCode } from './errors.ts';
import { readPrivateJson } from './files.ts';
import { Journal } from './journal.ts';
import { acquireWriter } from './lock.ts';
const log = (code: string) => process.stdout.write(JSON.stringify({ time: new Date().toISOString(), code }) + '\n');
async function main(): Promise<void> {
  const args = parseArgs({ allowPositionals: true, strict: true, options: { config: { type: 'string' }, state: { type: 'string' }, 'token-file': { type: 'string' }, help: { type: 'boolean' } } });
  const command = args.positionals[0];
  if (args.values.help || !command) { process.stdout.write('Daifuku edge 0.0.1 (Linux / Node 22+)\nCommands: pair, session, rotate, run, once, inspect\nOptions: --config <private JSON> --state <private directory> [--token-file <private pairing JSON>]\n'); return; }
  if (!['pair', 'session', 'rotate', 'run', 'once', 'inspect'].includes(command) || args.positionals.length !== 1 || !args.values.config || !args.values.state) throw new EdgeError('invalid_cli_arguments');
  const config = await loadConfig(resolve(args.values.config)), state = resolve(args.values.state), abort = new AbortController();
  const release = await acquireWriter(state, () => { process.stderr.write('writer_lock_lost\n'); process.exit(73); });
  const stop = () => abort.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const credentials = await Credentials.open(state, config), journal = await Journal.open(state);
    if (command === 'pair') {
      if (!args.values['token-file']) throw new EdgeError('pairing_token_file_required');
      const parsed = z.object({ pairingToken: edgeSecret }).strict().safeParse(await readPrivateJson(resolve(args.values['token-file']), 2048)); if (!parsed.success) throw new EdgeError('invalid_pairing_file');
      const session = await credentials.pair(parsed.data.pairingToken); process.stdout.write(JSON.stringify(session) + '\n');
    } else if (command === 'session' || command === 'rotate') process.stdout.write(JSON.stringify(await (command === 'rotate' ? credentials.rotate() : credentials.session())) + '\n');
    else if (command === 'inspect') process.stdout.write(JSON.stringify(journal.records().map((row) => ({ jobId: row.jobId, attempt: row.attempt, phase: row.phase, code: row.result?.code, deviceJobId: row.deviceJobId, updatedAt: row.updatedAt })), null, 2) + '\n');
    else { const agent = new EdgeAgent(credentials, journal, log); if (command === 'once') { await credentials.session(); await agent.tick(abort.signal); } else await agent.run(abort.signal); }
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await release(); }
}
main().catch((error: unknown) => { process.stderr.write(errorCode(error) + '\n'); process.exitCode = 1; });
