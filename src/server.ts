import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
extendZodWithOpenApi(z); // Initialize zod-to-openapi extensions

import bodyParser from 'body-parser';
import cors from 'cors';
import express, { Express } from 'express';
import helmet from 'helmet';
import { pino } from 'pino';

// Import the function to create the OpenAPI router
import { createOpenAPIRouter } from '@/api-docs/openAPIRouter';
import errorHandler from '@/common/middleware/errorHandler';
import requestLogger from '@/common/middleware/requestLogger';
import { env } from '@/common/utils/envConfig';
import { mcpRouter } from '@/mcp/mcp.router';
import { reasoningCacheRouter } from '@/routes/reasoningCache';
import { healthCheckRegistry, healthCheckRouter } from '@/routes/healthCheck/healthCheckRouter';
import { paperDiscoveryRegistry, paperDiscoveryRouter } from '@/routes/paperDiscovery/paperDiscoveryRouter';
import { tavilyCrawlRegistry, tavilyCrawlRouter } from '@/routes/tavilyCrawl';
import { tavilyExtractRegistry, tavilyExtractRouter } from '@/routes/tavilyExtract';
import { tavilyMapRegistry, tavilyMapRouter } from '@/routes/tavilyMap';
import { perplexitySearchRegistry, perplexitySearchRouter } from '@/routes/perplexitySearch';

import { excelGeneratorRouter } from './routes/excelGenerator/excelGeneratorRouter';
import { googlePlacesRouter } from './routes/googlePlaces/googlePlacesRouter';
import { googleWorkspaceRouter } from './routes/googleWorkspace/googleWorkspace.router';
import { gdriveSyncAuthRouter } from './routes/gdriveSyncAuth/gdriveSyncAuth.router';
import { notionDatabaseRouter } from './routes/notionDatabase/notionDatabaseRouter';
import { powerpointGeneratorRouter } from './routes/powerpointGenerator/powerpointGeneratorRouter';
import { webPageReaderRouter } from './routes/webPageReader/webPageReaderRouter';
import { wordGeneratorRouter } from './routes/wordGenerator/wordGeneratorRouter';
import { youtubeTranscriptRouter } from './routes/youtubeTranscript/youtubeTranscriptRouter';
import { wolframAlphaRouter } from './routes/wolframAlpha';

const logger = pino({ name: 'server start' });
const app: Express = express();

// Set the application to trust the reverse proxy
app.set('trust proxy', true);

app.use(
  '/paper-discovery',
  (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  },
  paperDiscoveryRouter
);

// Middlewares
const corsOriginValue = env.CORS_ORIGIN || '*'; // Default to * if undefined
const allowedOriginsFromEnv = corsOriginValue.split(',').map((s) => s.trim());
const isWildcardOriginConfig = allowedOriginsFromEnv.includes('*');
const trustedTypingMindOriginRegexes = [
  /^https:\/\/([a-z0-9-]+\.)?typingmind\.com$/i,
  /^https:\/\/cloud\d+\.typingmind\.com$/i,
  /^app:\/\/typingmind$/i,
  /^capacitor:\/\/localhost$/i,
];

const wildcardPatternToRegex = (pattern: string) => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
};

const allowedOriginRegexes = allowedOriginsFromEnv
  .filter((pattern) => pattern.length > 0 && pattern !== '*')
  .map((pattern) => wildcardPatternToRegex(pattern));

const isTrustedTypingMindOrigin = (requestOrigin: string) =>
  trustedTypingMindOriginRegexes.some((regex) => regex.test(requestOrigin));

app.use(
  cors({
    origin: (requestOrigin, callback) => {
      // If no origin header is present (e.g., server-to-server, curl), allow it.
      if (!requestOrigin) {
        return callback(null, true);
      }

      // If CORS_ORIGIN is configured as '*' in the environment.
      if (isWildcardOriginConfig) {
        // When credentials:true, cors middleware will reflect requestOrigin rather than literal '*'
        return callback(null, true);
      }

      // If CORS_ORIGIN is configured with specific domain(s).
      // Allow if:
      // - requestOrigin matches one of the specified domains exactly
      // - requestOrigin matches one of the configured wildcard origin patterns
      // - requestOrigin is 'null' (sandboxed iframes)
      // - requestOrigin is a trusted TypingMind origin
      const matchesConfiguredOrigin = allowedOriginsFromEnv.includes(requestOrigin);
      const matchesConfiguredPattern = allowedOriginRegexes.some((regex) => regex.test(requestOrigin));
      if (matchesConfiguredOrigin || matchesConfiguredPattern || requestOrigin === 'null' || isTrustedTypingMindOrigin(requestOrigin)) {
        return callback(null, true);
      }

      // Otherwise, disallow the origin.
      return callback(new Error(`Origin ${requestOrigin} not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(helmet());
app.use(bodyParser.json({ limit: "50mb" }));

app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  next();
});
// Request logging
app.use(requestLogger());

// Routes
app.use('/workspace', googleWorkspaceRouter);
app.use('/gdrive-sync', gdriveSyncAuthRouter);
app.use('/health-check', healthCheckRouter);
app.use('/images', express.static('public/images'));
app.use('/clients', express.static('clients', { etag: false, lastModified: false, setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate'); res.setHeader('Pragma', 'no-cache'); res.setHeader('Expires', '0'); } }));
app.use('/youtube-transcript', youtubeTranscriptRouter);
app.use('/web-page-reader', webPageReaderRouter);
app.use('/powerpoint-generator', powerpointGeneratorRouter);
app.use('/word-generator', wordGeneratorRouter);
app.use('/excel-generator', excelGeneratorRouter);
app.use('/notion-database', notionDatabaseRouter);
app.use('/google-places', googlePlacesRouter);
app.use('/api/tavily/extract', tavilyExtractRouter);
app.use('/api/tavily/crawl', tavilyCrawlRouter);
app.use('/api/tavily/map', tavilyMapRouter);
app.use('/api/perplexity/search', perplexitySearchRouter);
app.use('/reasoning-cache', reasoningCacheRouter);
app.use('/wolfram-alpha', wolframAlphaRouter);
app.use(mcpRouter);

// List of all registries for OpenAPI documentation
const allRegistries = [
  healthCheckRegistry,
  tavilyCrawlRegistry,
  tavilyExtractRegistry,
  tavilyMapRegistry,
  perplexitySearchRegistry,
  paperDiscoveryRegistry,
  // Ensure other registries like excelGeneratorRegistry etc., are included here
  // if they were present in the original hardcoded list in openAPIDocumentGenerator.ts
];

// Create the OpenAPI router with all registries
const openAPIDocsRouter = createOpenAPIRouter(allRegistries);

// Swagger UI
app.use(openAPIDocsRouter); // Use the generated router

// Error handlers
app.use(errorHandler());

export { app, logger };
