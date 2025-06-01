import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

// Schema for the response from the Google Places API proxy
export const GooglePlacesApiResponseSchema = z.object({
  results: z.array(z.any()).optional(),
  status: z.string(),
  error_message: z.string().optional(),
  html_attributions: z.array(z.any()).optional(),
  next_page_token: z.string().optional(),
});
export type GooglePlacesApiResponse = z.infer<typeof GooglePlacesApiResponseSchema>;

// Schema for the request body sent to our proxy
export const GooglePlacesApiRequestBodySchema = z.object({
  apiKey: z.string().openapi({
    description: 'The Google Places API Key provided by the client.',
  }),
  query: z.string().optional().openapi({
    description:
      "The text string to search for (e.g., 'restaurants in San Francisco', 'Eiffel Tower'). For nearbysearch, this acts as a keyword or type filter.",
  }),
  searchType: z.enum(['textsearch', 'nearbysearch', 'details']).openapi({
    description:
      "Type of search to perform. 'textsearch' for general queries, 'nearbysearch' for places near a location, 'details' for specific place details.",
  }),
  location: z.string().optional().openapi({
    description: "Required for 'nearbysearch'. Latitude,longitude string (e.g., '34.0522,-118.2437').",
  }),
  radius: z.number().int().optional().openapi({
    description: "Optional. Radius in meters for 'nearbysearch'. Defaults to 1500m if not specified.",
  }),
  placeId: z.string().optional().openapi({
    description: "Required for 'details' searchType. The unique identifier of the place.",
  }),
  fields: z.string().optional().openapi({
    description:
      "Optional. Comma-separated list of fields to return (e.g., 'name,formatted_address,opening_hours/open_now,rating,types'). Helps control data size and API costs. Refer to Google Places API documentation for available fields.",
  }),
});
export type GooglePlacesApiRequestBody = z.infer<typeof GooglePlacesApiRequestBodySchema>;
