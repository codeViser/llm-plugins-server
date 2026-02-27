import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const SemanticScholarPaperSchema = z.object({
  paperId: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  abstract: z.string().nullable().optional(),
  year: z.number().nullable().optional(),
  publicationDate: z.string().nullable().optional(),
  authors: z.array(z.object({ name: z.string().optional() })).optional(),
  venue: z.string().nullable().optional(),
  publicationVenue: z
    .object({
      id: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      type: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  externalIds: z.record(z.string(), z.string()).nullable().optional(),
  isOpenAccess: z.boolean().nullable().optional(),
  openAccessPdf: z
    .object({
      url: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  citationCount: z.number().nullable().optional(),
});

export const AcademicPaperHarvesterRequestBodySchema = z.object({
  query: z.string().min(1).openapi({
    description: 'Research topic, keywords, title, or author names',
  }),
  max_results: z.number().int().min(1).max(100).optional().default(5).openapi({
    description: 'Maximum number of papers to return',
  }),
  offset: z.number().int().min(0).optional().default(0).openapi({
    description: 'Pagination offset',
  }),
  fields: z.string().optional().openapi({
    description: 'Comma-separated Semantic Scholar fields override',
  }),
  apiKey: z.string().optional().openapi({
    description: 'Semantic Scholar API key (optional)',
  }),
  request_timeout_ms: z.number().int().min(3000).max(60000).optional().default(20000).openapi({
    description: 'Upstream Semantic Scholar timeout in milliseconds',
  }),
  retry_count: z.number().int().min(0).max(3).optional().default(2).openapi({
    description: 'Retry count for upstream 429/5xx/network failures',
  }),
});

export const AcademicPaperHarvesterResponseSchema = z.object({
  total: z.number().int(),
  offset: z.number().int(),
  next: z.number().int().nullable().optional(),
  data: z.array(SemanticScholarPaperSchema),
  source: z.literal('Semantic Scholar'),
});

export type AcademicPaperHarvesterRequestBody = z.infer<typeof AcademicPaperHarvesterRequestBodySchema>;
