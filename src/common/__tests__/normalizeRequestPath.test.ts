import express, { Express } from 'express';
import request from 'supertest';

import { normalizeRequestPath } from '@/common/middleware/normalizeRequestPath';

describe('normalizeRequestPath', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(normalizeRequestPath);
    app.get('/start', (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.get('/ping', (_req, res) => {
      res.status(200).json({ status: 'ok' });
    });
    app.get('/clients', (_req, res) => {
      res.status(200).json({ list: true });
    });
  });

  it('collapses //start to /start', async () => {
    const response = await request(app).get('//start');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('collapses ///ping to /ping and keeps query string', async () => {
    const response = await request(app).get('///ping?x=1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('leaves already-normal paths unchanged', async () => {
    const response = await request(app).get('/clients');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ list: true });
  });
});
