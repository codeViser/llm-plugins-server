/** Surface provider JSON error bodies instead of bare "Response code 400". */

export function formatProviderHttpError(error: unknown, label: string): string {
  if (!error || typeof error !== 'object') {
    return `${label}: ${String(error)}`;
  }
  const err = error as {
    message?: string;
    response?: { statusCode?: number; body?: unknown };
  };
  const status = err.response?.statusCode;
  const body = err.response?.body;
  let detail = '';
  if (body && typeof body === 'object') {
    const b = body as {
      error?: { message?: string; metadata?: { raw?: string; provider_name?: string } };
      message?: string;
    };
    const meta = b.error?.metadata;
    const raw = meta?.raw ? String(meta.raw).trim() : '';
    const provider = meta?.provider_name ? String(meta.provider_name) : '';
    detail = b.error?.message || b.message || '';
    if (raw) {
      detail = detail ? `${detail} — ${raw.slice(0, 400)}` : raw.slice(0, 400);
    } else if (provider && detail === 'Provider returned error') {
      detail = `${detail} (${provider})`;
    }
  } else if (typeof body === 'string' && body.trim()) {
    detail = body.trim().slice(0, 500);
  }
  const statusPart = status ? `HTTP ${status}` : err.message || 'request failed';
  if (detail) {
    return `${label} (${statusPart}): ${detail}`;
  }
  return `${label}: ${err.message || statusPart}`;
}
