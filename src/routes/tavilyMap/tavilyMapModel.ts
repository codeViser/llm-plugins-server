import { z } from 'zod';

// Schema for the request body received by our server
export const TavilyMapServerRequestBodySchema = z.object({
  tavilyAPIKey: z.string().openapi({ example: 'YOUR_TAVILY_API_KEY' }),
  url: z.string().openapi({ example: 'docs.tavily.com' }),
  max_depth: z.number().int().optional().openapi({ example: 1 }),
  max_breadth: z.number().int().optional().openapi({ example: 20 }),
  limit: z.number().int().optional().openapi({ example: 50 }),
  instructions: z.string().optional().openapi({ example: 'Python SDK' }),
  select_paths: z
    .array(z.string())
    .optional()
    .openapi({ example: ['/docs/.*', '/api/v1.*'] }),
  select_domains: z
    .array(z.string())
    .optional()
    .openapi({ example: ['^docs\\.example\\.com$'] }),
  exclude_paths: z
    .array(z.string())
    .optional()
    .openapi({ example: ['/private/.*', '/admin/.*'] }),
  exclude_domains: z
    .array(z.string())
    .optional()
    .openapi({ example: ['^private\\.example\\.com$'] }),
  allow_external: z.boolean().optional().default(false).openapi({ example: false }),
  categories: z
    .array(z.string())
    .optional()
    .openapi({ example: ['Documentation', 'Blog'] }),
});

export type TavilyMapServerRequestBody = z.infer<typeof TavilyMapServerRequestBodySchema>;

// Schema for the response sent by our server (mirroring Tavily's actual response for /map)
export const TavilyMapServerResponseSchema = z.object({
  base_url: z.string().openapi({ example: 'docs.tavily.com' }),
  results: z
    .array(z.string())
    .openapi({ example: ['https://docs.tavily.com/welcome', 'https://docs.tavily.com/documentation/api-credits'] }),
  response_time: z.number().openapi({ example: 1.23 }),
});

export type TavilyMapServerResponse = z.infer<typeof TavilyMapServerResponseSchema>;
