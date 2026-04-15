import express, { NextFunction, Request, Response, Router } from 'express';
import { google } from 'googleapis';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import {
  buildGoogleAuthUrl,
  createOAuthClient,
  ensureValidOAuthClientForConnection,
  getConnectionPublicView,
  GoogleAppType,
  revokeGoogleConnection,
  storeGoogleConnection,
  verifyAndParseState,
} from '@/common/utils/googleConnectionVault';
import { GoogleDriveSyncStorageService } from '@/routes/gdriveSyncAuth/gdriveSyncStorage.service';

// Module-level path-ID cache per authenticated device token.
// Shared across requests so each upload doesn't re-fetch Drive folder IDs.
const sharedPathCaches = new Map<string, Map<string, string>>();

export const gdriveSyncAuthRouter: Router = express.Router();

const authStartSchema = z.object({
  query: z.object({
    app: z.enum(['sync', 'workspace']),
    mode: z.enum(['popup', 'manual']).optional(),
    origin: z.string().optional(),
  }),
});

const authStatusSchema = z.object({
  query: z.object({
    app: z.enum(['sync', 'workspace']),
  }),
});

const objectKeySchema = z.object({
  query: z.object({
    key: z.string().min(1),
    metadata: z
      .string()
      .transform((value) => value === 'true')
      .optional(),
  }),
});

const listSchema = z.object({
  query: z.object({
    prefix: z.string().optional(),
  }),
});

const folderSchema = z.object({
  query: z.object({
    path: z.string().min(1),
  }),
});

const ensurePathSchema = z.object({
  body: z.object({
    path: z.string().min(1),
  }),
});

const copySchema = z.object({
  body: z.object({
    sourceKey: z.string().min(1),
    destinationKey: z.string().min(1),
  }),
});

function getRequestProtocol(req: Request): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string' && forwardedProto.length > 0) {
    return forwardedProto.split(',')[0].trim();
  }
  return req.protocol;
}

function getRequestHost(req: Request): string {
  const host = req.get('host');
  if (!host) {
    throw new Error('Missing request host');
  }
  return host;
}

function readBearerToken(req: Request): string | null {
  // Accept from custom header (avoids plugin-sandbox Authorization stripping) or Bearer fallback.
  const xToken = (req.headers['x-connection-token'] as string | undefined)?.trim() || '';
  if (xToken) return xToken;
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim() || null;
}

async function syncConnectionMiddleware(req: Request, res: Response, next: NextFunction) {
  const deviceToken = readBearerToken(req);
  if (!deviceToken) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: 'Sync connection token missing.' });
  }

  try {
    const { oauth2Client } = await ensureValidOAuthClientForConnection({
      deviceToken,
      reqProtocol: getRequestProtocol(req),
      reqHost: getRequestHost(req),
      expectedAppType: 'sync',
    });
    if (!sharedPathCaches.has(deviceToken)) {
      sharedPathCaches.set(deviceToken, new Map<string, string>());
    }
    (req as any).syncOauth2Client = oauth2Client;
    (req as any).syncDeviceToken = deviceToken;
    (req as any).syncPathCache = sharedPathCaches.get(deviceToken)!;
    next();
  } catch (error: any) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: error.message || 'Invalid sync connection token.' });
  }
}

function renderManualSuccessPage(params: { appType: GoogleAppType; deviceToken: string; userEmail: string }) {
  const title = params.appType === 'sync' ? 'TypingMind Sync Extension' : 'Google Workspace Plugin';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} Auth Complete</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#18181b; color:#fafafa; margin:0; padding:24px; }
    .card { max-width:800px; margin:0 auto; background:#27272a; border:1px solid #3f3f46; border-radius:16px; padding:24px; }
    code, textarea { width:100%; box-sizing:border-box; background:#09090b; color:#fafafa; border:1px solid #3f3f46; border-radius:12px; padding:12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .ok { color:#4ade80; font-weight:700; }
    .warn { color:#facc15; }
    button { margin-top:12px; padding:10px 14px; border:none; border-radius:10px; background:#2563eb; color:#fff; cursor:pointer; }
    ol { line-height:1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}: authentication successful</h1>
    <p class="ok">Google account connected: ${params.userEmail}</p>
    <p>Copy this connection token into the corresponding TypingMind ${params.appType === 'sync' ? 'extension' : 'plugin'} settings.</p>
    <textarea id="token" rows="3" readonly>${params.deviceToken}</textarea>
    <button onclick="navigator.clipboard.writeText(document.getElementById('token').value)">Copy token</button>
    <p class="warn"><strong>Important:</strong> this token is a private server credential. Treat it like a password. Google access/refresh tokens remain only on your private server.</p>
    <ol>
      <li>Copy the token above.</li>
      <li>Open TypingMind ${params.appType === 'sync' ? 'extension' : 'plugin'} settings.</li>
      <li>Paste it into the ${params.appType === 'sync' ? 'Google Connection Token' : 'Google Workspace Connection Token'} field.</li>
      <li>Save settings and test.</li>
    </ol>
  </div>
</body>
</html>`;
}

function renderPopupSuccessPage(params: { deviceToken: string; userEmail: string; appType: GoogleAppType; origin: string }) {
  const label = params.appType === 'sync' ? 'Google Connection Token' : 'Google Workspace Connection Token';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Auth Complete</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;background:#18181b;color:#fafafa;margin:0;padding:24px}
    .card{max-width:560px;margin:0 auto;background:#27272a;border:1px solid #3f3f46;border-radius:14px;padding:24px}
    h2{color:#4ade80;margin-top:0}
    .token-label{font-size:12px;color:#a1a1aa;margin-bottom:4px}
    .token-box{background:#09090b;border:1px solid #52525b;border-radius:8px;padding:12px;font-family:ui-monospace,monospace;font-size:13px;word-break:break-all;margin:8px 0 12px}
    .row{display:flex;gap:8px;flex-wrap:wrap}
    button{padding:9px 16px;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600}
    .btn-copy{background:#2563eb;color:#fff}
    .btn-close{background:#3f3f46;color:#d4d4d8}
    .hint{font-size:12px;color:#71717a;margin-top:16px;line-height:1.5}
    .auto-msg{font-size:13px;color:#a1a1aa;margin-bottom:12px}
  </style>
</head>
<body>
  <div class="card">
    <h2>&#x2705; Authentication Successful</h2>
    <p class="auto-msg">Signed in as <strong>${params.userEmail}</strong>.<br>
    The extension should auto-fill your token. If not, copy it below.</p>
    <div class="token-label">${label}</div>
    <div class="token-box" id="tok">${params.deviceToken}</div>
    <div class="row">
      <button class="btn-copy" onclick="doCopy()">&#x1F4CB; Copy Token</button>
      <button class="btn-close" onclick="window.close()">Close Window</button>
    </div>
    <p class="hint">This window will close in <span id="secs">10</span>&#160;seconds.</p>
  </div>
  <script>
    (function () {
      var payload = {
        type: 'TM_PRIVATE_GOOGLE_AUTH_RESULT',
        ok: true,
        appType: ${JSON.stringify(params.appType)},
        deviceToken: ${JSON.stringify(params.deviceToken)},
        userEmail: ${JSON.stringify(params.userEmail)}
      };
      try {
        if (window.opener && ${JSON.stringify(params.origin || '')}) {
          window.opener.postMessage(payload, ${JSON.stringify(params.origin || '')});
        }
      } catch (e) { console.error('postMessage error:', e); }

      var s = 10;
      var el = document.getElementById('secs');
      var t = setInterval(function () {
        s -= 1;
        if (el) el.textContent = s;
        if (s <= 0) { clearInterval(t); window.close(); }
      }, 1000);
    })();

    function doCopy() {
      var txt = document.getElementById('tok').textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(txt).then(function () {
          document.querySelector('.btn-copy').textContent = '\u2705 Copied!';
        });
      } else {
        var r = document.createRange();
        r.selectNodeContents(document.getElementById('tok'));
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        document.execCommand('copy');
        document.querySelector('.btn-copy').textContent = '\u2705 Copied!';
      }
    }
  </script>
</body>
</html>`;
}

gdriveSyncAuthRouter.get('/auth/start', (req: Request, res: Response) => {
  try {
    const parsed = authStartSchema.parse(req);
    const authUrl = buildGoogleAuthUrl({
      reqProtocol: getRequestProtocol(req),
      reqHost: getRequestHost(req),
      appType: parsed.query.app,
      mode: parsed.query.mode || (parsed.query.app === 'sync' ? 'popup' : 'manual'),
      returnOrigin: parsed.query.origin,
    });
    res.redirect(authUrl);
  } catch (error: any) {
    res.status(StatusCodes.BAD_REQUEST).send(error.message || 'Invalid auth request');
  }
});

gdriveSyncAuthRouter.get('/auth/callback', async (req: Request, res: Response) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state) {
      return res.status(StatusCodes.BAD_REQUEST).send('Missing OAuth code or state');
    }

    const parsedState = verifyAndParseState<{ appType: GoogleAppType; mode: 'popup' | 'manual'; returnOrigin: string }>(state);
    const oauth2Client = createOAuthClient(getRequestProtocol(req), getRequestHost(req));
    const tokenResponse = await oauth2Client.getToken(code);
    const tokens = tokenResponse.tokens;

    if (!tokens.access_token || !tokens.refresh_token) {
      return res.status(StatusCodes.BAD_REQUEST).send('Google did not return both access and refresh tokens. Re-run auth and consent again.');
    }

    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const me = await oauth2.userinfo.get();
    const userEmail = me.data.email || 'unknown@gmail.com';
    const deviceToken = storeGoogleConnection({
      appType: parsedState.appType,
      userEmail,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessExpiry: tokens.expiry_date || Date.now() + 55 * 60 * 1000,
      scopes: tokens.scope ? tokens.scope.split(' ').filter(Boolean) : [],
    });

    const safePopupOrigin = /^https:\/\/([a-z0-9-]+\.)?typingmind\.com$/i.test(parsedState.returnOrigin || '')
      || /^https:\/\/cloud\d+\.typingmind\.com$/i.test(parsedState.returnOrigin || '')
      || /^app:\/\/typingmind$/i.test(parsedState.returnOrigin || '')
      || /^capacitor:\/\/localhost$/i.test(parsedState.returnOrigin || '');

    if (parsedState.mode === 'popup' && safePopupOrigin) {
      return res.status(StatusCodes.OK).send(
        renderPopupSuccessPage({
          deviceToken,
          userEmail,
          appType: parsedState.appType,
          origin: parsedState.returnOrigin,
        })
      );
    }

    return res.status(StatusCodes.OK).send(renderManualSuccessPage({ appType: parsedState.appType, deviceToken, userEmail }));
  } catch (error: any) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).send(error.message || 'OAuth callback failed');
  }
});

gdriveSyncAuthRouter.get('/auth/status', (req: Request, res: Response) => {
  try {
    const parsed = authStatusSchema.parse(req);
    const deviceToken = readBearerToken(req);
    if (!deviceToken) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: 'Missing connection bearer token.' });
    }
    const view = getConnectionPublicView(deviceToken);
    if (!view || view.appType !== parsed.query.app) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: 'Google connection not found.' });
    }
    return res.status(StatusCodes.OK).json({ ok: true, connection: view });
  } catch (error: any) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: error.message || 'Invalid status request.' });
  }
});

gdriveSyncAuthRouter.delete('/auth/revoke', async (req: Request, res: Response) => {
  try {
    const deviceToken = readBearerToken(req);
    if (!deviceToken) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: 'Missing connection bearer token.' });
    }
    const revoked = await revokeGoogleConnection({
      deviceToken,
      reqProtocol: getRequestProtocol(req),
      reqHost: getRequestHost(req),
    });
    return res.status(StatusCodes.OK).json({ ok: true, revoked });
    sharedPathCaches.delete(deviceToken);
  } catch (error: any) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to revoke connection.' });
  }
});

gdriveSyncAuthRouter.get('/storage/list', syncConnectionMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = listSchema.parse(req);
    const storage = new GoogleDriveSyncStorageService((req as any).syncOauth2Client, (req as any).syncPathCache);
    const results = await storage.list(parsed.query.prefix || '');
    res.status(StatusCodes.OK).json({ items: results });
  } catch (error: any) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to list storage objects.' });
  }
});

gdriveSyncAuthRouter.get('/storage/object', syncConnectionMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = objectKeySchema.parse(req);
    const storage = new GoogleDriveSyncStorageService((req as any).syncOauth2Client, (req as any).syncPathCache);
    if (parsed.query.metadata) {
      const { text, file } = await storage.downloadObjectText(parsed.query.key);
      res.setHeader('ETag', file.modifiedTime || '');
      res.setHeader('X-Object-Modified-Time', file.modifiedTime || '');
      res.setHeader('Content-Type', 'application/json');
      return res.status(StatusCodes.OK).send(text);
    }

    const { buffer, file } = await storage.downloadObjectBuffer(parsed.query.key);
    res.setHeader('ETag', file.modifiedTime || '');
    res.setHeader('X-Object-Modified-Time', file.modifiedTime || '');
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    return res.status(StatusCodes.OK).send(buffer);
  } catch (error: any) {
    if (String(error.message || '').includes('not found')) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: error.message });
    }
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to download object.' });
  }
});

gdriveSyncAuthRouter.put(
  '/storage/object',
  express.raw({ type: '*/*', limit: '100mb' }),
  syncConnectionMiddleware,
  async (req: Request, res: Response) => {
    try {
      const parsed = objectKeySchema.parse(req);
      const storage = new GoogleDriveSyncStorageService((req as any).syncOauth2Client, (req as any).syncPathCache);
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
      console.log('[UPLOAD] key=' + String(parsed.query.key) + ' rawBodyLen=' + rawBody.length + ' isBuffer=' + Buffer.isBuffer(req.body));
      const result = await storage.uploadObject({
        key: parsed.query.key,
        body: rawBody,
        isMetadata: !!parsed.query.metadata,
        contentType: req.header('content-type') || undefined,
      });
      return res.status(StatusCodes.OK).json(result);
    } catch (error: any) {
      const apiErr = (error as any)?.response?.data ?? (error as any)?.errors ?? null;
      const detail = apiErr ? JSON.stringify(apiErr) : (error.message || 'Failed to upload object.');
      console.error('[UPLOAD ERROR] key=' + String(req.query?.key ?? '?'), detail);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: detail });
    }
  }
);

gdriveSyncAuthRouter.delete('/storage/object', syncConnectionMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = objectKeySchema.parse(req);
    const storage = new GoogleDriveSyncStorageService((req as any).syncOauth2Client, (req as any).syncPathCache);
    await storage.deleteObject(parsed.query.key);
    return res.status(StatusCodes.OK).json({ ok: true });
  } catch (error: any) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to delete object.' });
  }
});

gdriveSyncAuthRouter.delete('/storage/folder', syncConnectionMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = folderSchema.parse(req);
    const storage = new GoogleDriveSyncStorageService((req as any).syncOauth2Client, (req as any).syncPathCache);
    await storage.deleteFolder(parsed.query.path);
    return res.status(StatusCodes.OK).json({ ok: true });
  } catch (error: any) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to delete folder.' });
  }
});

gdriveSyncAuthRouter.post('/storage/copy', express.json(), syncConnectionMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = copySchema.parse(req);
    const storage = new GoogleDriveSyncStorageService((req as any).syncOauth2Client, (req as any).syncPathCache);
    await storage.copyObject(parsed.body.sourceKey, parsed.body.destinationKey);
    return res.status(StatusCodes.OK).json({ ok: true });
  } catch (error: any) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to copy object.' });
  }
});

gdriveSyncAuthRouter.post('/storage/ensure-path', express.json(), syncConnectionMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = ensurePathSchema.parse(req);
    const storage = new GoogleDriveSyncStorageService((req as any).syncOauth2Client, (req as any).syncPathCache);
    await storage.ensurePathExists(parsed.body.path);
    return res.status(StatusCodes.OK).json({ ok: true });
  } catch (error: any) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to ensure path.' });
  }
});
