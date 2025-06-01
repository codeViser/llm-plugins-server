import dotenv from 'dotenv';
import { cleanEnv, host, num, port, str } from 'envalid';

dotenv.config();

const isTest = process.env.NODE_ENV === 'test';

export const env = cleanEnv(process.env, {
  NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'production' }),
  HOST: host({ default: 'localhost' }),
  PORT: port({ default: isTest ? 3001 : 3000 }),
  CORS_ORIGIN: str({ default: '*' }),
  COMMON_RATE_LIMIT_MAX_REQUESTS: num({ default: isTest ? 1000 : 100 }),
  COMMON_RATE_LIMIT_WINDOW_MS: num({ default: 60000 }),
  // GOOGLE_PLACES_API_KEY: str({ default: '' }), // Removed as client now provides it
  GOOGLE_CLIENT_ID: str({ default: isTest ? 'TEST_GOOGLE_CLIENT_ID' : '' }),
  GOOGLE_CLIENT_SECRET: str({ default: isTest ? 'TEST_GOOGLE_CLIENT_SECRET' : '' }),
  // GOOGLE_CALLBACK_URL: str({
  //   default: isTest ? 'http://localhost:3001/auth/google/callback' : 'http://localhost:3000/auth/google/callback'
  // }), // REMOVED - Handled by TypingMind
  // SESSION_SECRET: str({
  //   default: isTest ? 'TEST_SESSION_SECRET_SUPER_SAFE' : 'a_very_secret_key_for_session_management'
  // }), // REMOVED - Sessions not used for this auth flow
});
