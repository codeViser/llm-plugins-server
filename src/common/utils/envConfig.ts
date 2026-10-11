import dotenv from 'dotenv';
import { cleanEnv, host, num, port, str } from 'envalid';

dotenv.config();

const isTest = process.env.NODE_ENV === 'test';

export const env = cleanEnv(process.env, {
  NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'production' }),
  HOST: host({ default: 'localhost' }),
  PORT: port({ default: isTest ? 3001 : 3000 }),
  CORS_ORIGIN: str({ default: '*' }),
  // Rate limiting completely disabled for power users
  GOOGLE_CLIENT_ID: str({ default: isTest ? 'TEST_GOOGLE_CLIENT_ID' : '' }),
  GOOGLE_CLIENT_SECRET: str({ default: isTest ? 'TEST_GOOGLE_CLIENT_SECRET' : '' }),
  GDRIVE_SYNC_TOKEN_KEY: str({ default: isTest ? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' : '' }),
  MCP_AUTH_TOKEN: str({ default: '' }),
  // Optional fallback only. Prefer TypingMind plugin User Settings (request body).
  OPENAI_API_KEY: str({ default: '' }),
  /** Optional Pi-side fallback for deferred batch think tier (plugin body key preferred). */
  OPENROUTER_API_KEY: str({ default: '' }),
  /** Optional deferred job completion alerts (Pi .env only; never commit). */
  TELEGRAM_BOT_TOKEN: str({ default: '' }),
  TELEGRAM_CHAT_ID: str({ default: '' }),
  MULTI_AGENT_DEFAULT_MAX_AGENTS: num({ default: 4 }),
  // Official id is gpt-6-astra (Responses API). Plugin User Settings override this.
  MULTI_AGENT_DEFAULT_MODEL: str({ default: 'gpt-6-astra' }),
  /** Comma-separated DNS servers for outbound Google Places HTTP only (e.g. 1.1.1.1,8.8.8.8). Empty = system DNS. */
  GOOGLE_HTTP_DNS_SERVERS: str({ default: '' }),
  // GOOGLE_CALLBACK_URL: str({
  //   default: isTest ? 'http://localhost:3001/auth/google/callback' : 'http://localhost:3000/auth/google/callback'
  // }), // REMOVED - Handled by TypingMind
  // SESSION_SECRET: str({
  //   default: isTest ? 'TEST_SESSION_SECRET_SUPER_SAFE' : 'a_very_secret_key_for_session_management'
  // }), // REMOVED - Sessions not used for this auth flow
});
