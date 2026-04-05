import { z } from 'zod';

export const HashParamSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/, 'Must be a 64-char hex SHA-256 hash'),
});

export const SaveBodySchema = z.object({
  data: z.unknown(),
});

export const PruneQuerySchema = z.object({
  days: z.coerce.number().int().min(0).default(180),
});

export interface CacheRow {
  data: Buffer;
  compressed: number;
}
