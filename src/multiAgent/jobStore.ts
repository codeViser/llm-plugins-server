import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Durable job store for long-running multi-agent councils.
 *
 * A council runs for minutes; a single long HTTP request is dropped by
 * Cloudflare/the tunnel. So the plugin STARTS a job (fast), the run happens in
 * the background, and the user/model FETCHES the result later by job_id. State
 * lives on the Pi (SQLite), so results survive `pm2 reload` and reboots and can
 * be retrieved hours later.
 *
 * Mirrors the better-sqlite3 pattern already used by reasoning-cache.
 */
export type JobStatus = 'running' | 'done' | 'error';

export interface Job {
  id: string;
  status: JobStatus;
  result?: unknown;
  error?: string;
  goal?: string;
  /** Sanitized original /run fields (no API keys) so a failed job can be replayed. */
  input?: JobInputSnapshot;
  createdAt: number;
  updatedAt: number;
}

/** Durable copy of the council request. Never include openai_api_key / mcp_auth_token. */
export type JobInputSnapshot = {
  goal?: string;
  context_packet?: unknown;
  model?: string;
  reasoning_effort?: string;
  max_agents?: number;
  requested_agents?: number;
  timeout_sec?: number;
  applied_max_agents?: number;
  job_kind?: 'council' | 'deferred_batch';
  gather_model?: string;
  think_model?: string;
  skip_batch?: boolean;
  progress?: Record<string, unknown>;
  allow_mcp_clients?: string[];
  deny_mcp_clients?: string[];
  max_gather_turns?: number;
  max_tool_calls?: number;
  max_refine_rounds?: number;
  /** Gather output persisted before batch submit so batch_polling can resume after restart. */
  evidence_packet_snapshot?: unknown;
  refine_rounds?: number;
};

export interface JobSummary {
  id: string;
  status: JobStatus;
  goal: string;
  createdAt: number;
  updatedAt: number;
  input?: JobInputSnapshot;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // keep results a week (4h runs + later fetch)
/** Short preview for /recent lists only. The `goal` column stores the full text. */
export const GOAL_LIST_SNIPPET_MAX = 160;
const GOAL_STORE_MAX = 200_000;
const INPUT_JSON_MAX = 1_000_000;

interface JobRow {
  id: string;
  status: JobStatus;
  result: string | null;
  error: string | null;
  goal: string | null;
  input_json: string | null;
  created_at: number;
  updated_at: number;
}

function defaultDbPath(): string {
  if (process.env.NODE_ENV === 'test') {
    return ':memory:';
  }
  const dataDir = process.env.MULTI_AGENT_DATA_DIR || path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, 'multiagent_jobs.db');
}

export interface JobStoreOptions {
  dbPath?: string;
  ttlMs?: number;
  now?: () => number;
}

export class JobStore {
  private readonly db: Database.Database;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: JobStoreOptions = {}) {
    const dbPath = options.dbPath ?? defaultDbPath();
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;

    this.db = new Database(dbPath);
    if (dbPath !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS multiagent_jobs (
        id         TEXT PRIMARY KEY,
        status     TEXT NOT NULL,
        result     TEXT,
        error      TEXT,
        goal       TEXT,
        input_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ma_jobs_updated ON multiagent_jobs(updated_at);
    `);
    this.ensureInputJsonColumn();
  }

  private ensureInputJsonColumn(): void {
    const cols = this.db.pragma('table_info(multiagent_jobs)') as Array<{ name: string }>;
    if (cols.some((col) => col.name === 'input_json')) {
      return;
    }
    this.db.exec('ALTER TABLE multiagent_jobs ADD COLUMN input_json TEXT');
  }

  create(goal?: string, input?: JobInputSnapshot): Job {
    this.sweep();
    const t = this.now();
    const id = randomUUID();
    const storedGoal = (goal ?? '').slice(0, GOAL_STORE_MAX);
    const inputJson = serializeInput(input, storedGoal);
    this.db
      .prepare(
        'INSERT INTO multiagent_jobs (id, status, goal, input_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(id, 'running', storedGoal, inputJson, t, t);
    return {
      id,
      status: 'running',
      goal: storedGoal,
      input: inputJson ? (safeParse(inputJson) as JobInputSnapshot) : undefined,
      createdAt: t,
      updatedAt: t,
    };
  }

  complete(id: string, result: unknown): void {
    this.db
      .prepare('UPDATE multiagent_jobs SET status = ?, result = ?, updated_at = ? WHERE id = ?')
      .run('done', JSON.stringify(result ?? null), this.now(), id);
  }

  fail(id: string, error: string): void {
    this.db
      .prepare('UPDATE multiagent_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?')
      .run('error', error, this.now(), id);
  }

  updateProgress(id: string, progress: Record<string, unknown>, extra?: Partial<JobInputSnapshot>): void {
    const job = this.get(id);
    if (!job) {
      return;
    }
    const input: JobInputSnapshot = {
      ...(job.input ?? {}),
      ...extra,
      progress,
    };
    const inputJson = serializeInput(input, job.goal ?? '');
    this.db
      .prepare('UPDATE multiagent_jobs SET input_json = ?, updated_at = ? WHERE id = ?')
      .run(inputJson, this.now(), id);
  }

  get(id: string): Job | undefined {
    this.sweep();
    const row = this.db.prepare('SELECT * FROM multiagent_jobs WHERE id = ?').get(id) as JobRow | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      status: row.status,
      result: row.result ? safeParse(row.result) : undefined,
      error: row.error ?? undefined,
      goal: row.goal ?? undefined,
      input: row.input_json ? (safeParse(row.input_json) as JobInputSnapshot) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  recent(limit = 10): JobSummary[] {
    this.sweep();
    const rows = this.db
      .prepare('SELECT id, status, goal, input_json, created_at, updated_at FROM multiagent_jobs ORDER BY updated_at DESC LIMIT ?')
      .all(Math.max(1, Math.min(50, Math.floor(limit)))) as JobRow[];
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      goal: (row.goal ?? '').slice(0, GOAL_LIST_SNIPPET_MAX),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      input: row.input_json ? (safeParse(row.input_json) as JobInputSnapshot) : undefined,
    }));
  }

  private sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    this.db
      .prepare('DELETE FROM multiagent_jobs WHERE updated_at < ? AND status != ?')
      .run(cutoff, 'running');
  }

  get size(): number {
    const row = this.db.prepare('SELECT COUNT(*) as n FROM multiagent_jobs').get() as { n: number };
    return row.n;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function serializeInput(input: JobInputSnapshot | undefined, storedGoal: string): string | null {
  const snapshot: JobInputSnapshot = {
    goal: input?.goal ?? storedGoal,
    context_packet: input?.context_packet,
    model: input?.model,
    reasoning_effort: input?.reasoning_effort,
    max_agents: input?.max_agents,
    requested_agents: input?.requested_agents,
    timeout_sec: input?.timeout_sec,
    applied_max_agents: input?.applied_max_agents,
    job_kind: input?.job_kind,
    gather_model: input?.gather_model,
    think_model: input?.think_model,
    skip_batch: input?.skip_batch,
    progress: input?.progress,
    allow_mcp_clients: input?.allow_mcp_clients,
    deny_mcp_clients: input?.deny_mcp_clients,
    max_gather_turns: input?.max_gather_turns,
    max_tool_calls: input?.max_tool_calls,
    max_refine_rounds: input?.max_refine_rounds,
    evidence_packet_snapshot: input?.evidence_packet_snapshot,
    refine_rounds: input?.refine_rounds,
  };
  const encoded = JSON.stringify(snapshot);
  if (!encoded || encoded === '{}') {
    return null;
  }
  return encoded.length > INPUT_JSON_MAX ? encoded.slice(0, INPUT_JSON_MAX) : encoded;
}
