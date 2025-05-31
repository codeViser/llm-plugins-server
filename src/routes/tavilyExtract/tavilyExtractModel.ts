import { z } from 'zod';

export const TavilyExtractServerRequestBodySchema = z.object({
  urls: z.array(z.string().url()),
  include_images: z.boolean().optional().default(false),
  tavilyAPIKey: z.string(),
});

const TavilyResultSchema = z.object({
  url: z.string().url(),
  raw_content: z.string(),
  images: z.array(z.string().url()).optional(),
});

export const TavilyExtractServerResponseSchema = z.object({
  results: z.array(TavilyResultSchema),
  failed_results: z.array(z.string().url()).optional(), // Assuming failed_results are URLs
  response_time: z.number().optional(),
});

// Schema for error responses from our server, if needed for OpenAPI doc
// export const TavilyErrorResponseSchema = z.object({
//   message: z.string(),
//   details: z.any().optional()
// }); 