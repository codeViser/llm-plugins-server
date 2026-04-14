import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
extendZodWithOpenApi(z);

export const PerplexitySearchServerRequestBodySchema = z.object({
  perplexityAPIKey: z.string().openapi({
    description: 'The Perplexity API Key provided by the client.',
  }),
  keyword: z.string().openapi({
    description: 'The search keyword or query.',
  }),
  model: z.string().optional().default('sonar-pro').openapi({
    description: 'The Perplexity model to use. Default: sonar-pro.',
  }),
  systemMessage: z.string().optional().default('Be precise and concise.').openapi({
    description: 'System message to guide the response.',
  }),
});
export type PerplexitySearchServerRequestBody = z.infer<typeof PerplexitySearchServerRequestBodySchema>;

export const PerplexitySearchServerResponseSchema = z.object({
  content: z.string(),
  citations: z.array(z.string()).optional(),
});
export type PerplexitySearchServerResponse = z.infer<typeof PerplexitySearchServerResponseSchema>;
