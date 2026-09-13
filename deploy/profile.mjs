import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { userInfo } from 'node:os';
import { parseEnv } from 'node:util';
import { owned, safePath, verifyRelease, within } from './files.mjs';
function hostName(value) {
  if (
    typeof value !== 'string' ||
    value.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) ||
    /\.(local|internal|localhost)$/.test(value) ||
    isIP(new URL(`https://${value}`).hostname)
  )
    throw new Error(
      'Use an explicit organization DNS hostname; IP, local/internal/localhost suffixes, URLs and wildcards are unsupported.',
    );
  return value;
}
function service({ release, state, config, node, user }) {
  return `[Unit]\nDescription=Daifuku ERP API\nAfter=network-online.target\nWants=network-online.target\nStartLimitIntervalSec=60\nStartLimitBurst=5\n\n[Service]\nType=exec\nUser=${user}\nWorkingDirectory=${release}/runtime/apps/api\nExecStart=${node} --env-file=${config} dist/main.js\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=30\nKillMode=control-group\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=read-only\nReadWritePaths=${state}/evidence\n\n[Install]\nWantedBy=multi-user.target\n`;
}
function proxy({ release, hostname, profile, cert, key, port }) {
  const tls = profile === 'onprem' ? `\n  tls ${cert} ${key}` : '';
  return `{\n  admin off\n}\n${hostname} {${tls}\n  encode zstd gzip\n  header X-Content-Type-Options nosniff\n  header Referrer-Policy no-referrer\n  redir /api /api/ 308\n  handle_path /api/* {\n    reverse_proxy 127.0.0.1:${port} {\n      header_up X-Forwarded-For {remote_host}\n      header_up X-Forwarded-Proto {scheme}\n      header_up X-Forwarded-Host {host}\n      stream_close_delay 5m\n    }\n  }\n  root * ${release}/web\n  handle /assets/* {\n    header Cache-Control "public, max-age=31536000, immutable"\n    file_server\n  }\n  handle {\n    header Cache-Control "no-cache"\n    try_files {path} /index.html\n    file_server\n  }\n}\n`;
}
export async function renderProfile(input) {
  const release = safePath(input.release);
  const state = safePath(input.state);
  const config = safePath(input.config);
  const output = safePath(input.output);
  const node = safePath(input.node);
  if (!['cloud', 'onprem'].includes(input.profile) || !/^[a-z_][a-z0-9_-]{0,31}$/.test(input.user ?? ''))
    throw new Error('Choose cloud/onprem and an existing dedicated service user.');
  if (!/^[a-f0-9]{64}$/.test(input.manifestHash ?? '')) throw new Error('Specify the approved manifest SHA256.');
  if (input.user !== userInfo().username)
    throw new Error('Render as the dedicated service user that owns the private state and runtime.env.');
  const verified = await verifyRelease(release, input.manifestHash);
  if ((verified.manifest.candidate && !input.allowCandidate) || verified.manifest.arch !== process.arch)
    throw new Error('Candidate or architecture mismatch: not a production release for this machine.');
  if (
    within(release, state) ||
    within(state, release) ||
    within(release, config) ||
    within(release, output) ||
    within(state, output)
  )
    throw new Error('Keep release, operations and profile output directories separate.');
  await owned(state, true);
  await owned(config);
  if (!within(state, config)) throw new Error('Use the existing private runtime.env inside this operations directory.');
  const env = parseEnv(await readFile(config, 'utf8'));
  if (
    env.NODE_ENV !== 'production' ||
    env.HOST !== '127.0.0.1' ||
    !/^\d+$/.test(env.PORT ?? '') ||
    Number(env.PORT) < 1024 ||
    Number(env.PORT) > 65535 ||
    env.DAIFUKU_STORAGE_DIR !== join(state, 'evidence') ||
    env.TRUSTED_PROXY_CIDRS !== '127.0.0.1/32'
  )
    throw new Error(
      'Configure production, loopback API, unprivileged PORT, state/evidence and TRUSTED_PROXY_CIDRS=127.0.0.1/32 explicitly in the private runtime.env.',
    );
  const hostname = hostName(input.hostname);
  const cert = input.profile === 'onprem' ? safePath(input.cert) : undefined;
  const key = input.profile === 'onprem' ? safePath(input.key) : undefined;
  if (env.PUBLIC_WEB_URL && env.PUBLIC_WEB_URL !== `https://${hostname}`)
    throw new Error('PUBLIC_WEB_URL must match the selected HTTPS origin.');
  const selected = {
    release,
    state,
    config,
    output,
    node,
    user: input.user,
    hostname,
    profile: input.profile,
    cert,
    key,
    port: Number(env.PORT),
  };
  const files = {
    'daifuku-api.service': service(selected),
    Caddyfile: proxy(selected),
    'deployment.json':
      JSON.stringify(
        {
          format: 1,
          commit: verified.manifest.commit,
          manifestHash: verified.sha256,
          origin: `https://${hostname}`,
          profile: input.profile,
          release,
          state,
        },
        null,
        2,
      ) + '\n',
  };
  try {
    await owned(join(state, 'evidence'), true);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (input.execute) {
    await mkdir(output, { mode: 0o700 });
    for (const [name, body] of Object.entries(files))
      await writeFile(join(output, name), body, { flag: 'wx', mode: 0o600 });
    try {
      await mkdir(join(state, 'evidence'), { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    await owned(join(state, 'evidence'), true);
  }
  return {
    execute: Boolean(input.execute),
    files: Object.keys(files),
    releaseCommit: verified.manifest.commit,
    candidate: verified.manifest.candidate,
    manifestHash: verified.sha256,
    origin: `https://${hostname}`,
    output,
    servicesStarted: false,
  };
}
