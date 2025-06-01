import bodyParser from 'body-parser';
import cors from 'cors';
import express, { Express } from 'express';
import helmet from 'helmet';
import { pino } from 'pino';

import { openAPIRouter } from '@/api-docs/openAPIRouter';
import errorHandler from '@/common/middleware/errorHandler';
import rateLimiter from '@/common/middleware/rateLimiter';
import requestLogger from '@/common/middleware/requestLogger';
import { env } from '@/common/utils/envConfig';
import { healthCheckRouter } from '@/routes/healthCheck/healthCheckRouter';

import { excelGeneratorRouter } from './routes/excelGenerator/excelGeneratorRouter';
import { googlePlacesRouter } from './routes/googlePlaces/googlePlacesRouter';
import { googleWorkspaceRouter } from './routes/googleWorkspace/googleWorkspace.router';
import { notionDatabaseRouter } from './routes/notionDatabase/notionDatabaseRouter';
import { powerpointGeneratorRouter } from './routes/powerpointGenerator/powerpointGeneratorRouter';
import { tavilyCrawlRouter } from './routes/tavilyCrawl';
import { tavilyExtractRouter } from './routes/tavilyExtract';
import { webPageReaderRouter } from './routes/webPageReader/webPageReaderRouter';
import { wordGeneratorRouter } from './routes/wordGenerator/wordGeneratorRouter';
import { youtubeTranscriptRouter } from './routes/youtubeTranscript/youtubeTranscriptRouter';
const logger = pino({ name: 'server start' });
const app: Express = express();

// Set the application to trust the reverse proxy
app.set('trust proxy', true);
// Middlewares
const corsOriginValue = env.CORS_ORIGIN || '*'; // Default to * if undefined
const allowedOriginsFromEnv = corsOriginValue.split(',').map((s) => s.trim());
const isWildcardOriginConfig = allowedOriginsFromEnv.includes('*');

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
      // Allow if the requestOrigin matches one of the specified domains OR if the requestOrigin is 'null' (for sandboxed iframes).
      if (allowedOriginsFromEnv.includes(requestOrigin) || requestOrigin === 'null') {
        return callback(null, true);
      }

      // Otherwise, disallow the origin.
      return callback(new Error(`Origin ${requestOrigin} not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(helmet());
app.use(rateLimiter);
app.use(bodyParser.json());

app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  next();
});
// Request logging
app.use(requestLogger());

// Routes
app.use('/workspace', googleWorkspaceRouter);
app.use('/health-check', healthCheckRouter);
app.use('/images', express.static('public/images'));
app.use('/youtube-transcript', youtubeTranscriptRouter);
app.use('/web-page-reader', webPageReaderRouter);
app.use('/powerpoint-generator', powerpointGeneratorRouter);
app.use('/word-generator', wordGeneratorRouter);
app.use('/excel-generator', excelGeneratorRouter);
app.use('/notion-database', notionDatabaseRouter);
app.use('/google-places', googlePlacesRouter);
app.use('/api/tavily/extract', tavilyExtractRouter);
app.use('/api/tavily/crawl', tavilyCrawlRouter);

// Swagger UI
app.use(openAPIRouter);

// Error handlers
app.use(errorHandler());

export { app, logger };
