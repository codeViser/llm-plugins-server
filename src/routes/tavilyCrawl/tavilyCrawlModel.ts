import { z } from 'zod';

// Schema for the request body our server will expect for the crawl proxy
export const TavilyCrawlServerRequestBodySchema = z.object({
  tavilyAPIKey: z.string().openapi({
    description: 'The Tavily API Key provided by the client.',
  }),
  url: z.string().openapi({
    description: 'The base URL to start crawling from.',
  }),
  instructions: z.string().optional().openapi({
    description: 'Instructions or keywords to guide the crawl.',
  }),
  max_depth: z.number().int().optional().openapi({
    description: 'Maximum depth to crawl from the base URL.',
  }),
  max_breadth: z.number().int().optional().openapi({
    description: 'Maximum number of links to follow at each level of depth.',
  }),
  limit: z.number().int().optional().openapi({
    description: 'Maximum number of pages to crawl in total.',
  }),
  allow_external: z.boolean().optional().default(false).openapi({
    description: 'Whether to allow crawling external domains linked from the base URL.',
  }),
  include_images: z.boolean().optional().default(false).openapi({
    description: 'Whether to include images from the crawled pages.',
  }),
  extract_depth: z.enum(['basic', 'advanced']).optional().default('basic').openapi({
    description: 'The depth of content extraction for each crawled page.',
  }),
  select_paths: z.array(z.string()).optional().openapi({
    description: 'Specific paths to prioritize or include.',
  }),
  select_domains: z.array(z.string()).optional().openapi({
    description: 'Specific domains to prioritize or include.',
  }),
  exclude_paths: z.array(z.string()).optional().openapi({
    description: 'Specific paths to exclude.',
  }),
  exclude_domains: z.array(z.string()).optional().openapi({
    description: 'Specific domains to exclude.',
  }),
  categories: z.array(z.string()).optional().openapi({
    description: 'Categories to filter or classify content.',
  }),
});
export type TavilyCrawlServerRequestBody = z.infer<typeof TavilyCrawlServerRequestBodySchema>;

// Schema for the response structure from Tavily's Crawl API (and our proxy)
const CrawlResultSchema = z.object({
  url: z.string(),
  raw_content: z.string(),
  images: z.array(z.string().url()).optional(), // Assuming images might be part of the result
});

export const TavilyCrawlServerResponseSchema = z.object({
  base_url: z.string(),
  results: z.array(CrawlResultSchema),
  response_time: z.number().optional(),
});
export type TavilyCrawlServerResponse = z.infer<typeof TavilyCrawlServerResponseSchema>;
