import express, { Express, NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import request from 'supertest';

import errorHandler from '@/common/middleware/errorHandler';

describe('Error Handler Middleware', () => {
  let app: Express;

  beforeEach(() => {
    app = express();

    app.get('/error', () => {
      throw new Error('Test error');
    });

    app.get('/next-error', (req: Request, res: Response, next: NextFunction) => {
      const error = new Error('Error passed to next()');
      next(error);
    });

    app.use(errorHandler());

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.status(StatusCodes.NOT_FOUND).send('Not Found');
    });
  });

  it('should return 404 for unknown routes', async () => {
    const response = await request(app).get('/this-route-does-not-exist');
    expect(response.status).toBe(StatusCodes.NOT_FOUND);
  });

  it('should handle thrown errors with a 500 status code', async () => {
    const response = await request(app).get('/error');
    expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
  });

  it('should handle errors passed to next() with a 500 status code', async () => {
    const response = await request(app).get('/next-error');
    expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
  });
});
