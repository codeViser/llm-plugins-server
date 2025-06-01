import dotenv from 'dotenv';
import { cleanEnv, host, num, port, str } from 'envalid';

dotenv.config();

export const env = cleanEnv(process.env, {
  NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'production' }),
  HOST: host({ default: 'localhost' }),
  PORT: port({ default: 3000 }),
  CORS_ORIGIN: str({ default: '*' }),
  COMMON_RATE_LIMIT_MAX_REQUESTS: num({ default: 100 }),
  COMMON_RATE_LIMIT_WINDOW_MS: num({ default: 60000 }),
  // GOOGLE_PLACES_API_KEY: str({ default: '' }), // Removed as client now provides it
  GOOGLE_CLIENT_ID: str({ default: '' }),
  GOOGLE_CLIENT_SECRET: str({ default: '' }),
  GOOGLE_CALLBACK_URL: str({ default: 'http://localhost:3000/auth/google/callback' }),
  SESSION_SECRET: str({ default: 'a_very_secret_key_for_session_management' }),
});
