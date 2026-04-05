import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { promisify } from 'util';
import zlib from 'zlib';

const gzip   = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const logger = pino({ name: 'reasoning-cache' });

// Resolve db path relative to the project root (one level above dist/)
const DATA_DIR = path.resolve(__dirname, '../data');
const DB_PATH  = path.join(DATA_DIR, 'reasoning_cache.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  logger.info({ DATA_DIR }, 'Created data directory');
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS reasoning_cache (
    hash        TEXT    PRIMARY KEY,
    data        BLOB    NOT NULL,
    compressed  INTEGER DEFAULT 0,
    created_at  INTEGER NOT NULL,
    accessed_at INTEGER NOT NULL,
    size_bytes  INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_created  ON reasoning_cache(created_at);
  CREATE INDEX IF NOT EXISTS idx_accessed ON reasoning_cache(accessed_at);
`);

const stmtGet    = db.prepare('SELECT data, compressed FROM reasoning_cache WHERE hash = ?');
const stmtTouch  = db.prepare('UPDATE reasoning_cache SET accessed_at = ? WHERE hash = ?');
const stmtUpsert = db.prepare(`
  INSERT INTO reasoning_cache (hash, data, compressed, created_at, accessed_at, size_bytes)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(hash) DO UPDATE SET
    data        = excluded.data,
    compressed  = excluded.compressed,
    accessed_at = excluded.accessed_at,
    size_bytes  = excluded.size_bytes
`);
const stmtPrune = db.prepare('DELETE FROM reasoning_cache WHERE created_at < ?');
const stmtStats = db.prepare(`
  SELECT
    COUNT(*) as entries,
    COALESCE(SUM(size_bytes), 0) as total_bytes,
    MIN(created_at) as oldest,
    MAX(created_at) as newest
  FROM reasoning_cache
`);

logger.info({ DB_PATH }, 'Reasoning cache DB ready');

// ── Public API ──────────────────────────────────────────────────────────────

export async function getEntry(hash: string): Promise<{ data: unknown } | null> {
  const row = stmtGet.get(hash) as { data: Buffer; compressed: number } | undefined;
  if (!row) return null;

  stmtTouch.run(Date.now(), hash);

  let buf: Buffer = row.data;
  if (row.compressed) {
    buf = (await gunzip(buf)) as Buffer;
  }

  return { data: JSON.parse(buf.toString('utf8')) };
}

export async function setEntry(
  hash: string,
  data: unknown,
): Promise<{ size_bytes: number; compressed: boolean }> {
  const raw  = Buffer.from(JSON.stringify(data), 'utf8');
  const now  = Date.now();
  let   save: Buffer;
  let   compressed: number;

  if (raw.length > 1024) {
    try {
      save       = (await gzip(raw)) as Buffer;
      compressed = 1;
    } catch {
      save       = raw;
      compressed = 0;
    }
  } else {
    save       = raw;
    compressed = 0;
  }

  stmtUpsert.run(hash, save, compressed, now, now, save.length);
  return { size_bytes: save.length, compressed: !!compressed };
}

export function pruneEntries(days: number): { deleted: number } {
  const cutoff = Date.now() - days * 86_400_000;
  const result = stmtPrune.run(cutoff);
  return { deleted: result.changes };
}

export function getStats() {
  const s = stmtStats.get() as {
    entries: number;
    total_bytes: number;
    oldest: number | null;
    newest: number | null;
  };
  return {
    entries:  s.entries,
    total_mb: (s.total_bytes / 1_048_576).toFixed(2),
    oldest:   s.oldest ? new Date(s.oldest).toISOString() : null,
    newest:   s.newest ? new Date(s.newest).toISOString() : null,
  };
}
