import type { VendorCredentialMap } from '@/executionSurface/connectorHttpBackend';

export type DeferredRunSecrets = {
  openai?: string;
  openrouter?: string;
  vendor?: VendorCredentialMap;
};

const runSecrets = new Map<string, DeferredRunSecrets>();

export function stashDeferredRunSecrets(jobId: string, secrets: DeferredRunSecrets): void {
  const prev = runSecrets.get(jobId) ?? {};
  runSecrets.set(jobId, { ...prev, ...secrets });
}

export function getDeferredRunSecrets(jobId: string): DeferredRunSecrets | undefined {
  return runSecrets.get(jobId);
}

export function clearDeferredRunSecrets(jobId: string): void {
  runSecrets.delete(jobId);
}
