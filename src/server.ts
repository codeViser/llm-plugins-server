import bodyParser from 'body-parser';
import cors from 'cors';
import express, { Express } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import passport from 'passport';
import { pino } from 'pino';

import { openAPIRouter } from '@/api-docs/openAPIRouter';
import errorHandler from '@/common/middleware/errorHandler';
import rateLimiter from '@/common/middleware/rateLimiter';
import requestLogger from '@/common/middleware/requestLogger';
import { env } from '@/common/utils/envConfig';
import { healthCheckRouter } from '@/routes/healthCheck/healthCheckRouter';

import { excelGeneratorRouter } from './routes/excelGenerator/excelGeneratorRouter';
import { googleAuthRouter } from './routes/googleAuth/googleAuth.router';
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
const allowedOriginsFromEnv = env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map((s) => s.trim()) : [];
const isWildcard = allowedOriginsFromEnv.includes('*');

app.use(
  cors({
    origin: (requestOrigin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!requestOrigin) {
        return callback(null, true);
      }
      // If wildcard is specified in env, reflect the current origin
      if (isWildcard) {
        return callback(null, true); // True here means reflect the requestOrigin
      }
      // If specific origins are listed, check if the requestOrigin is among them
      if (allowedOriginsFromEnv.includes(requestOrigin)) {
        return callback(null, true);
      }
      // If origin is literally 'null' (often from sandboxed iframes)
      // and wildcard was intended, we can consider allowing it.
      // However, be cautious with 'null' origin + credentials.
      // For TypingMind sandboxed iframes, this might be necessary.
      if (requestOrigin === 'null' && env.CORS_ORIGIN === '*') {
        // This condition means CORS_ORIGIN was explicitly set to '*'
        // allowing null in this specific case for iframe compatibility.
        return callback(null, true);
      }
      // Otherwise, disallow the origin
      return callback(new Error(`Origin ${requestOrigin} not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(helmet());
app.use(rateLimiter);
app.use(bodyParser.json());

// Session middleware - MUST be configured before passport.session()
app.use(
  session({
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true, // Save new sessions
    cookie: {
      secure: env.isProduction, // Use secure cookies in production
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // Session expiry: 24 hours
    },
  })
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  next();
});
// Request logging
app.use(requestLogger());

// Routes
app.use('/auth', googleAuthRouter);
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
