import { lookup } from 'dns/promises';
import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { createApiResponse } from '@/api-docs/openAPIResponseBuilders';
import { ResponseStatus, ServiceResponse } from '@/common/models/serviceResponse';
import { handleServiceResponse } from '@/common/utils/httpHandlers';

export const healthCheckRegistry = new OpenAPIRegistry();

export const healthCheckRouter: Router = (() => {
  const router = express.Router();

  healthCheckRegistry.registerPath({
    method: 'get',
    path: '/health-check',
    tags: ['Health Check'],
    responses: createApiResponse(z.null(), 'Success'),
  });

  router.get('/', async (_req: Request, res: Response) => {
    let placesDns: { ok: boolean; address?: string; error?: string } = { ok: false };
    try {
      const result = await lookup('places.googleapis.com');
      const address =
        typeof result === 'string' ? result : (result as { address: string }).address;
      placesDns = { ok: true, address };
    } catch (err) {
      placesDns = { ok: false, error: (err as Error).message };
    }

    const payload = {
      placesGoogleDns: placesDns,
    };

    const serviceResponse = new ServiceResponse(
      ResponseStatus.Success,
      placesDns.ok ? 'Service is healthy' : 'Service is up; Places DNS lookup failed',
      payload,
      StatusCodes.OK
    );
    handleServiceResponse(serviceResponse, res);
  });

  return router;
})();
