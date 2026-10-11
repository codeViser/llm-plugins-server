import { createHash, timingSafeEqual } from 'crypto';

/** Compare connector tokens without storing the client-provided secret in session state. */
export function connectorTokensMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
