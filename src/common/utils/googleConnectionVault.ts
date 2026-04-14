import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

import { env } from '@/common/utils/envConfig';
import { decryptToken, encryptToken } from '@/routes/gdriveSyncAuth/gdriveSyncAuth.crypto';

export type GoogleAppType = 'sync' | 'workspace';
export type AuthMode = 'popup' | 'manual';

export interface GoogleConnectionRow {
  device_token: string;
  app_type: GoogleAppType;
  user_email: string;
  encrypted_access_token: Buffer;
  encrypted_refresh_token: Buffer;
  access_expiry: number;
  scopes: string;
  created_at: number;
  updated_at: number;
  last_used_at: number;
  revoked: number;
}

export interface GoogleConnectionPublicView {
  appType: GoogleAppType;
  userEmail: string;
  scopes: string[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'google_connections.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS google_connections (
    device_token TEXT PRIMARY KEY,
    app_type TEXT NOT NULL,
    user_email TEXT NOT NULL,
    encrypted_access_token BLOB NOT NULL,
    encrypted_refresh_token BLOB NOT NULL,
    access_expiry INTEGER NOT NULL,
    scopes TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_google_connections_app_type ON google_connections(app_type);
  CREATE INDEX IF NOT EXISTS idx_google_connections_user_email ON google_connections(user_email);
`);

const insertStmt = db.prepare(`
  INSERT INTO google_connections (
    device_token,
    app_type,
    user_email,
    encrypted_access_token,
    encrypted_refresh_token,
    access_expiry,
    scopes,
    created_at,
    updated_at,
    last_used_at,
    revoked
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
`);

const getByDeviceTokenStmt = db.prepare(
  'SELECT * FROM google_connections WHERE device_token = ? AND revoked = 0'
);

const updateTokensStmt = db.prepare(`
  UPDATE google_connections
  SET encrypted_access_token = ?, encrypted_refresh_token = ?, access_expiry = ?, updated_at = ?, last_used_at = ?
  WHERE device_token = ?
`);

const touchStmt = db.prepare(`
  UPDATE google_connections
  SET last_used_at = ?, updated_at = ?
  WHERE device_token = ?
`);

const revokeStmt = db.prepare(`
  UPDATE google_connections
  SET revoked = 1, updated_at = ?, last_used_at = ?
  WHERE device_token = ?
`);

const allowedPopupOriginRegexes = [
  /^https:\/\/([a-z0-9-]+\.)?typingmind\.com$/i,
  /^https:\/\/cloud\d+\.typingmind\.com$/i,
  /^app:\/\/typingmind$/i,
  /^capacitor:\/\/localhost$/i,
];

function sanitizePopupOrigin(origin?: string): string {
  if (!origin) return '';
  const trimmed = origin.trim();
  return allowedPopupOriginRegexes.some((regex) => regex.test(trimmed)) ? trimmed : '';
}

export const GOOGLE_SCOPES: Record<GoogleAppType, string[]> = {
  sync: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'],
  workspace: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/presentations',
  ],
};

function parseScopes(scopes: string): string[] {
  return scopes
    .split(' ')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function getRedirectUri(reqProtocol: string, reqHost: string): string {
  return `${reqProtocol}://${reqHost}/gdrive-sync/auth/callback`;
}

export function createOAuthClient(reqProtocol: string, reqHost: string) {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, getRedirectUri(reqProtocol, reqHost));
}

export function generateDeviceToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function signState(payload: Record<string, string>): string {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', env.GDRIVE_SYNC_TOKEN_KEY).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyAndParseState<T extends Record<string, string>>(state: string): T {
  const [body, sig] = state.split('.');
  if (!body || !sig) {
    throw new Error('Invalid OAuth state format');
  }
  const expected = crypto.createHmac('sha256', env.GDRIVE_SYNC_TOKEN_KEY).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Invalid OAuth state signature');
  }
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
}

export function buildGoogleAuthUrl(params: {
  reqProtocol: string;
  reqHost: string;
  appType: GoogleAppType;
  mode: AuthMode;
  returnOrigin?: string;
}): string {
  const oauth2Client = createOAuthClient(params.reqProtocol, params.reqHost);
  const state = signState({
    appType: params.appType,
    mode: params.mode,
    returnOrigin: sanitizePopupOrigin(params.returnOrigin),
    nonce: crypto.randomBytes(12).toString('base64url'),
  });
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES[params.appType],
    state,
    include_granted_scopes: false,
  });
}

export function storeGoogleConnection(input: {
  appType: GoogleAppType;
  userEmail: string;
  accessToken: string;
  refreshToken: string;
  accessExpiry: number;
  scopes: string[];
}): string {
  const now = Date.now();
  const deviceToken = generateDeviceToken();
  insertStmt.run(
    deviceToken,
    input.appType,
    input.userEmail,
    encryptToken(input.accessToken, env.GDRIVE_SYNC_TOKEN_KEY),
    encryptToken(input.refreshToken, env.GDRIVE_SYNC_TOKEN_KEY),
    input.accessExpiry,
    input.scopes.join(' '),
    now,
    now,
    now
  );
  return deviceToken;
}

export function getConnectionByDeviceToken(deviceToken: string): GoogleConnectionRow | null {
  const row = getByDeviceTokenStmt.get(deviceToken) as GoogleConnectionRow | undefined;
  return row || null;
}

export function getConnectionPublicView(deviceToken: string): GoogleConnectionPublicView | null {
  const row = getConnectionByDeviceToken(deviceToken);
  if (!row) {
    return null;
  }
  return {
    appType: row.app_type,
    userEmail: row.user_email,
    scopes: parseScopes(row.scopes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}

export async function ensureValidOAuthClientForConnection(params: {
  deviceToken: string;
  reqProtocol: string;
  reqHost: string;
  expectedAppType: GoogleAppType;
}) {
  const row = getConnectionByDeviceToken(params.deviceToken);
  if (!row) {
    throw new Error('Google connection not found or revoked');
  }
  if (row.app_type !== params.expectedAppType) {
    throw new Error(`Google connection is not valid for app type ${params.expectedAppType}`);
  }

  const oauth2Client = createOAuthClient(params.reqProtocol, params.reqHost);
  const refreshToken = decryptToken(row.encrypted_refresh_token, env.GDRIVE_SYNC_TOKEN_KEY);
  const accessToken = decryptToken(row.encrypted_access_token, env.GDRIVE_SYNC_TOKEN_KEY);

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    access_token: accessToken,
    expiry_date: row.access_expiry,
  });

  oauth2Client.on('tokens', (tokens) => {
    const nextAccessToken = tokens.access_token || accessToken;
    const nextRefreshToken = tokens.refresh_token || refreshToken;
    const nextExpiry = tokens.expiry_date || row.access_expiry;
    updateTokensStmt.run(
      encryptToken(nextAccessToken, env.GDRIVE_SYNC_TOKEN_KEY),
      encryptToken(nextRefreshToken, env.GDRIVE_SYNC_TOKEN_KEY),
      nextExpiry,
      Date.now(),
      Date.now(),
      params.deviceToken
    );
  });

  await oauth2Client.getAccessToken();
  touchStmt.run(Date.now(), Date.now(), params.deviceToken);
  return {
    row,
    oauth2Client,
  };
}

export async function revokeGoogleConnection(params: {
  deviceToken: string;
  reqProtocol: string;
  reqHost: string;
}) {
  const row = getConnectionByDeviceToken(params.deviceToken);
  if (!row) {
    return false;
  }
  const oauth2Client = createOAuthClient(params.reqProtocol, params.reqHost);
  const refreshToken = decryptToken(row.encrypted_refresh_token, env.GDRIVE_SYNC_TOKEN_KEY);
  try {
    await oauth2Client.revokeToken(refreshToken);
  } catch {
    // Ignore remote revoke failures; still revoke locally.
  }
  revokeStmt.run(Date.now(), Date.now(), params.deviceToken);
  return true;
}
