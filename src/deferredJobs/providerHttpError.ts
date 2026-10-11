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
    const b = body as { error?: { message?: string }; message?: string };
    detail = b.error?.message || b.message || '';
  } else if (typeof body === 'string' && body.trim()) {
    detail = body.trim().slice(0, 500);
  }
  const statusPart = status ? `HTTP ${status}` : err.message || 'request failed';
  if (detail) {
    return `${label} (${statusPart}): ${detail}`;
  }
  return `${label}: ${err.message || statusPart}`;
}
