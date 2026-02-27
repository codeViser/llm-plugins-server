import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const SourceStrategySchema = z.enum(['openalex_only', 'openalex_then_semantic', 'semantic_only']);

export const PaperDiscoverySearchQuerySchema = z.object({
  query: z.string().min(1).openapi({
    description: 'Research topic, title keywords, or author names',
  }),
  max_results: z.coerce.number().int().min(1).max(20).optional().default(5).openapi({
    description: 'Maximum number of results to return (1-20)',
  }),
  source_strategy: SourceStrategySchema.optional().default('openalex_then_semantic').openapi({
    description: 'Source strategy: OpenAlex only, Semantic only, or OpenAlex then Semantic',
  }),
  semantic_api_key: z.string().optional().openapi({
    description: 'Optional Semantic Scholar API key (recommended when semantic source is used)',
  }),
  request_timeout_ms: z.coerce.number().int().min(3000).max(60000).optional().default(20000).openapi({
    description: 'Upstream request timeout in milliseconds',
  }),
});

export type PaperDiscoverySearchQuery = z.infer<typeof PaperDiscoverySearchQuerySchema>;

export const PaperDiscoveryResultSchema = z.object({
  source: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().nullable(),
  abstract: z.string().nullable(),
  paperUrl: z.string().nullable(),
  pdfUrl: z.string().nullable(),
  doi: z.string().nullable(),
  arxivId: z.string().nullable(),
  citationCount: z.number().nullable(),
  venue: z.string().nullable(),
});

export const PaperDiscoveryResponseSchema = z.object({
  query: z.string(),
  strategy: SourceStrategySchema,
  totalReturned: z.number().int(),
  papers: z.array(PaperDiscoveryResultSchema),
});

export type PaperDiscoveryResult = z.infer<typeof PaperDiscoveryResultSchema>;
