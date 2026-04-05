import { z } from 'zod';

export const WolframAlphaRequestBodySchema = z.object({
  input: z.string().min(1, 'Query input is required'),
  maxchars: z.number().optional().default(6800),
  wolframAppId: z.string().min(1, 'Wolfram AppID is required'),
});

export const WolframAlphaResponseSchema = z.object({
  result: z.string(),
});
