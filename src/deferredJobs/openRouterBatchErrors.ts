import { formatProviderHttpError } from './providerHttpError';

export function isOpenRouterBatchUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/OpenRouter batch (submit|poll).*HTTP (400|404)/i.test(message)) {
    return true;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const status = (error as { response?: { statusCode?: number } }).response?.statusCode;
  if (status === 404 || status === 400) {
    return true;
  }
  return /\b(404|400)\b/.test(message) && /not found|batch|provider/i.test(message);
}

export function openRouterBatchHttpError(error: unknown, phase: 'submit' | 'poll'): Error {
  return new Error(formatProviderHttpError(error, `OpenRouter batch ${phase}`));
}
