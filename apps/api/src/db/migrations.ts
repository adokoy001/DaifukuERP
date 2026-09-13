// Migration files in drizzle-kit's journal format (spec AC-9), generated from the kernel registry.
// Layout: drizzle/migrations/NNNN_<name>.sql, meta/_journal.json, meta/NNNN_snapshot.json.
// drizzle-orm's migrator (kernel runMigrations) reads exactly this layout.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registry } from '@daifuku/kernel';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle/migrations/', import.meta.url));
const ORIGIN_ID = '00000000-0000-0000-0000-000000000000';
const BREAKPOINT = '\n--> statement-breakpoint\n';

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}
export interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export type Snapshot = ReturnType<typeof generateDrizzleJson>;

const pad = (n: number) => String(n).padStart(4, '0');

export function readJournal(dir = MIGRATIONS_DIR): Journal {
  const p = join(dir, 'meta', '_journal.json');
  if (!existsSync(p)) return { version: '7', dialect: 'postgresql', entries: [] };
  return JSON.parse(readFileSync(p, 'utf8')) as Journal;
}

export function lastSnapshot(dir = MIGRATIONS_DIR): Snapshot {
  const journal = readJournal(dir);
  const last = journal.entries.at(-1);
  if (!last) return generateDrizzleJson({});
  return JSON.parse(readFileSync(join(dir, 'meta', `${pad(last.idx)}_snapshot.json`), 'utf8')) as Snapshot;
}

export function currentSnapshot(prevId: string): Snapshot {
  return generateDrizzleJson(registry.tables(), prevId);
}

export interface PendingMigration {
  prev: Snapshot;
  cur: Snapshot;
  statements: string[];
}

/** Runtime feature selection is never authorization to remove persisted data. */
export function assertNonDestructive(statements: readonly string[]): void {
  const destructive = statements.filter((statement) => /\bDROP\s+(?:TABLE|COLUMN|SCHEMA)\b/i.test(statement));
  if (destructive.length) {
    throw new Error(
      'Automatic migration would remove tables or columns. Load the complete installed schema catalog. Data removal requires a separately reviewed migration with a preservation/restore plan.',
    );
  }
}

/** Drizzle can emit a referenced UNIQUE after ADD FOREIGN KEY; preserve prerequisites before references. */
export function orderMigrationConstraints(statements: readonly string[]): string[] {
  const firstForeignKey = statements.findIndex((statement) =>
    /^ALTER TABLE[\s\S]+ADD CONSTRAINT[\s\S]+FOREIGN KEY/i.test(statement.trim()),
  );
  if (firstForeignKey < 0) return [...statements];
  const lateUnique = statements.filter(
    (statement, i) =>
      i > firstForeignKey && /^ALTER TABLE[\s\S]+ADD CONSTRAINT[\s\S]+UNIQUE\s*\(/i.test(statement.trim()),
  );
  const toMove = new Set(lateUnique);
  return [
    ...statements.slice(0, firstForeignKey),
    ...lateUnique,
    ...statements.slice(firstForeignKey).filter((statement) => !toMove.has(statement)),
  ];
}

/** SQL needed to bring the last snapshot up to the registry. Empty statements = nothing to migrate. */
export async function pendingMigration(dir = MIGRATIONS_DIR): Promise<PendingMigration> {
  const journal = readJournal(dir);
  const prev = lastSnapshot(dir);
  const cur = currentSnapshot(journal.entries.length === 0 ? ORIGIN_ID : prev.id);
  const statements = orderMigrationConstraints(await generateMigration(prev as never, cur as never));
  assertNonDestructive(statements);
  return { prev, cur, statements };
}

/** Writes the SQL, snapshot and journal entry for a pending migration. Returns the tag, or null when nothing changed. */
export async function writeMigration(name: string, dir = MIGRATIONS_DIR): Promise<string | null> {
  const pending = await pendingMigration(dir);
  if (pending.statements.length === 0) return null;
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`migration name "${name}" must be snake_case`);
  const journal = readJournal(dir);
  const idx = (journal.entries.at(-1)?.idx ?? -1) + 1;
  const tag = `${pad(idx)}_${name}`;
  mkdirSync(join(dir, 'meta'), { recursive: true });
  writeFileSync(join(dir, `${tag}.sql`), `${pending.statements.join(BREAKPOINT)}\n`);
  writeFileSync(join(dir, 'meta', `${pad(idx)}_snapshot.json`), `${JSON.stringify(pending.cur, null, 2)}\n`);
  journal.entries.push({ idx, version: '7', when: Date.now(), tag, breakpoints: true });
  writeFileSync(join(dir, 'meta', '_journal.json'), `${JSON.stringify(journal, null, 2)}\n`);
  return tag;
}
