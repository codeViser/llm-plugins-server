import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { excelGeneratorRegistry } from '@/routes/excelGenerator/excelGeneratorRouter';
import { healthCheckRegistry } from '@/routes/healthCheck/healthCheckRouter';
import { notionDatabaseRegistry } from '@/routes/notionDatabase/notionDatabaseRouter';
import { powerpointGeneratorRegistry } from '@/routes/powerpointGenerator/powerpointGeneratorRouter';
import { articleReaderRegistry } from '@/routes/webPageReader/webPageReaderRouter';
import { wordGeneratorRegistry } from '@/routes/wordGenerator/wordGeneratorRouter';
import { youtubeTranscriptRegistry } from '@/routes/youtubeTranscript/youtubeTranscriptRouter';
import { googlePlacesRegistry } from '@/routes/googlePlaces/googlePlacesRouter';
import { tavilyExtractRegistry } from '@/routes/tavilyExtract';
import { tavilyCrawlRegistry } from '@/routes/tavilyCrawl';

export function generateOpenAPIDocument() {
  const registry = new OpenAPIRegistry([
    healthCheckRegistry,
    youtubeTranscriptRegistry,
    articleReaderRegistry,
    powerpointGeneratorRegistry,
    wordGeneratorRegistry,
    excelGeneratorRegistry,
    notionDatabaseRegistry,
    googlePlacesRegistry,
    tavilyExtractRegistry,
    tavilyCrawlRegistry,
  ]);
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Swagger API',
    },
    externalDocs: {
      description: 'View the raw OpenAPI Specification in JSON format',
      url: '/swagger.json',
    },
  });
}
