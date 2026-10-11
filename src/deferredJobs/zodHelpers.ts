import { z } from 'zod';

/** Optional record; accepts JSON `null` from browser plugins (treat as absent). */
export const optionalRecord = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.record(z.unknown()).optional()
);
