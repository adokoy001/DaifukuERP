import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const REQUIRED_FIELDS = ['条件', '前提', '仕様', '実装', '試験', '根拠', '失効条件', '限界'];

export function parseLedger(source) {
  const entries = [];
  let entry;
  let fence;
  for (const line of source.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker && !fence) {
      fence = marker[1];
      continue;
    }
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim())
        fence = undefined;
      continue;
    }
    const heading = /^## ([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*$/.exec(line);
    if (heading) {
      entry = { id: heading[1], fields: {} };
      entries.push(entry);
    } else if (line.startsWith('## ')) throw new Error('Level-two headings must contain a valid invariant ID');
    else if (entry) {
      const field = /^- ([^:]+):\s*(.*)$/.exec(line);
      if (field) {
        if (Object.hasOwn(entry.fields, field[1])) throw new Error(`${entry.id}: duplicate field ${field[1]}`);
        entry.fields[field[1]] = field[2].trim();
      }
    }
  }
  if (fence) throw new Error('Unclosed code fence in assurance ledger');
  return entries;
}

function links(text) {
  return [...text.matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)].map((match) => match[1]);
}

function localTarget(root, document, link) {
  const [path, anchor] = link.split('#');
  if (!path || isAbsolute(path) || /^[a-z][a-z0-9+.-]*:/i.test(path))
    throw new Error('reference must be a relative file');
  const target = realpathSync(resolve(dirname(document), decodeURIComponent(path)));
  const scoped = relative(realpathSync(root), target);
  if (
    scoped === '..' ||
    scoped.startsWith('../') ||
    scoped.startsWith('..\\') ||
    isAbsolute(scoped) ||
    !statSync(target).isFile()
  )
    throw new Error('reference escapes the repository or is not a file');
  if (anchor !== undefined) {
    const line = /^L([1-9][0-9]*)$/.exec(anchor);
    if (!line || Number(line[1]) > readFileSync(target, 'utf8').split(/\r?\n/).length)
      throw new Error('reference requires an existing #L<number> source line');
  }
  return target;
}

export function validateLedger(source, { root, document, minimum = 8 }) {
  const entries = parseLedger(source),
    ids = new Set(),
    failures = [];
  if (entries.length < minimum) failures.push(`At least ${minimum} invariant entries are required`);
  for (const entry of entries) {
    if (ids.has(entry.id)) failures.push(`${entry.id}: duplicate invariant ID`);
    ids.add(entry.id);
    for (const field of REQUIRED_FIELDS) if (!entry.fields[field]) failures.push(`${entry.id}: missing ${field}`);
    for (const field of ['仕様', '実装', '試験']) {
      const references = links(entry.fields[field] ?? '');
      if (!references.length) failures.push(`${entry.id}: ${field} requires a local reference`);
      for (const link of references) {
        try {
          const target = localTarget(root, document, link);
          if (field === '試験' && !/\.(test|spec)\.(ts|mts|js|mjs)$/.test(target))
            throw new Error('test reference must name an executable test');
        } catch (error) {
          failures.push(`${entry.id}: invalid ${field} reference ${link}: ${error.message}`);
        }
      }
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  return entries;
}

export function affectedEntries(entries, changed, { root, document }) {
  const paths = new Set(changed.map((path) => path.replaceAll('\\', '/')));
  return entries
    .filter((entry) =>
      ['仕様', '実装', '試験'].some((field) =>
        links(entry.fields[field]).some((link) => {
          const target = localTarget(root, document, link);
          return paths.has(relative(root, target).replaceAll('\\', '/'));
        }),
      ),
    )
    .map((entry) => entry.id);
}
