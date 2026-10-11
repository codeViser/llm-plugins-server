import { randomUUID } from 'crypto';

import type { ToolRelayInvokeSchema } from './toolCatalog.schema';
import type { z } from 'zod';

type InvokePayload = z.infer<typeof ToolRelayInvokeSchema>;

export type RelaySessionState = {
  jobId: string;
  catalogHash: string;
  registeredAt: number;
  lastHeartbeat: number;
  sendInvoke?: (payload: InvokePayload) => void;
};

export type PendingRelayCall = {
  callId: string;
  jobId: string;
  handle: string;
  name: string;
  arguments: Record<string, unknown>;
  createdAt: number;
};

const sessions = new Map<string, RelaySessionState>();
const pendingByJob = new Map<string, PendingRelayCall[]>();
const waiters = new Map<string, { resolve: (text: string, ok: boolean) => void; timer: NodeJS.Timeout }>();

const DEFAULT_INVOKE_MS = 120_000;

export function registerRelaySession(args: {
  jobId: string;
  catalogHash: string;
  sendInvoke?: RelaySessionState['sendInvoke'];
}): void {
  const now = Date.now();
  sessions.set(args.jobId, {
    jobId: args.jobId,
    catalogHash: args.catalogHash,
    registeredAt: now,
    lastHeartbeat: now,
    sendInvoke: args.sendInvoke,
  });
}

export function touchRelayHeartbeat(jobId: string): boolean {
  const s = sessions.get(jobId);
  if (!s) return false;
  s.lastHeartbeat = Date.now();
  return true;
}

export function getRelaySession(jobId: string): RelaySessionState | undefined {
  return sessions.get(jobId);
}

export function isRelayActive(jobId: string, maxStaleMs = 90_000): boolean {
  const s = sessions.get(jobId);
  if (!s) return false;
  return Date.now() - s.lastHeartbeat < maxStaleMs;
}

export function clearRelaySession(jobId: string): void {
  sessions.delete(jobId);
  pendingByJob.delete(jobId);
}

export function stripRelayTransport(jobId: string): void {
  const s = sessions.get(jobId);
  if (s) {
    s.sendInvoke = undefined;
  }
}

export function enqueuePendingInvocation(jobId: string, call: Omit<PendingRelayCall, 'callId' | 'createdAt'>): PendingRelayCall {
  const row: PendingRelayCall = {
    ...call,
    callId: randomUUID(),
    createdAt: Date.now(),
  };
  const list = pendingByJob.get(jobId) ?? [];
  list.push(row);
  pendingByJob.set(jobId, list);
  const session = sessions.get(jobId);
  if (session?.sendInvoke) {
    session.sendInvoke({
      type: 'invoke',
      call_id: row.callId,
      job_id: jobId,
      handle: row.handle,
      name: row.name,
      arguments: row.arguments,
    });
  }
  return row;
}

export function listPendingInvocations(jobId: string): PendingRelayCall[] {
  return [...(pendingByJob.get(jobId) ?? [])];
}

export function ackPendingInvocation(jobId: string, callId: string): void {
  const list = pendingByJob.get(jobId);
  if (!list) return;
  pendingByJob.set(jobId, list.filter((c) => c.callId !== callId));
}

export function deliverRelayResult(args: {
  jobId: string;
  callId: string;
  content: string;
  isError?: boolean;
}): boolean {
  ackPendingInvocation(args.jobId, args.callId);
  const key = `${args.jobId}:${args.callId}`;
  const waiter = waiters.get(key);
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.resolve(args.content, !args.isError);
    waiters.delete(key);
    return true;
  }
  return false;
}

export function waitForRelayResult(
  jobId: string,
  callId: string,
  timeoutMs = DEFAULT_INVOKE_MS
): Promise<{ ok: boolean; text: string }> {
  return new Promise((resolve) => {
    const key = `${jobId}:${callId}`;
    const timer = setTimeout(() => {
      waiters.delete(key);
      resolve({ ok: false, text: 'Client relay timed out waiting for tool result' });
    }, timeoutMs);
    waiters.set(key, {
      resolve: (text, ok) => resolve({ ok, text }),
      timer,
    });
  });
}

export async function invokeClientTool(args: {
  jobId: string;
  catalogHash: string;
  handle: string;
  name: string;
  arguments?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ ok: boolean; text: string }> {
  const session = sessions.get(args.jobId);
  if (!session || session.catalogHash !== args.catalogHash) {
    return { ok: false, text: 'Client relay not registered for this job/catalog' };
  }
  const pending = enqueuePendingInvocation(args.jobId, {
    jobId: args.jobId,
    handle: args.handle,
    name: args.name,
    arguments: args.arguments ?? {},
  });
  if (!session.sendInvoke) {
    // Poll fallback: invocation stays in pending until relay-result endpoint.
    return waitForRelayResult(args.jobId, pending.callId, args.timeoutMs);
  }
  return waitForRelayResult(args.jobId, pending.callId, args.timeoutMs);
}
