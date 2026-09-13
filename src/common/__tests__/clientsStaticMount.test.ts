import express, { Express } from 'express';
import request from 'supertest';

describe('GET /clients vs static extension files', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(
      '/clients',
      express.static('clients', {
        redirect: false,
        index: false,
      })
    );
    app.get('/clients', (_req, res) => {
      res.status(401).json({ error: 'Authorization header is required' });
    });
  });

  it('does not 301 GET /clients to /clients/', async () => {
    const response = await request(app).get('/clients');
    expect(response.status).not.toBe(301);
    expect(response.status).not.toBe(302);
    expect(response.headers.location).toBeUndefined();
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Authorization header is required');
  });

  it('still serves extension JS under /clients/<file>', async () => {
    const response = await request(app).get('/clients/ping_server.js');
    expect(response.status).toBe(200);
    expect(String(response.headers['content-type'] || '')).toMatch(/javascript|text\/plain|octet-stream/i);
  });
});
