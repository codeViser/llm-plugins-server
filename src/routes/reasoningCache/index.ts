import express, { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';

import { authMiddleware } from '@/mcp/mcp.auth';
import { ResponseStatus, ServiceResponse } from '@/common/models/serviceResponse';
import { handleServiceResponse } from '@/common/utils/httpHandlers';
import { env } from '@/common/utils/envConfig';

import { getEntry, getStats, pruneEntries, setEntry } from './reasoningCache.controller';
import { HashParamSchema, PruneQuerySchema, SaveBodySchema } from './reasoningCacheModel';

const auth = authMiddleware(env.MCP_AUTH_TOKEN || 'dummy-token');

export const reasoningCacheRouter: Router = (() => {
  const router = express.Router();

  // GET /reasoning-cache/stats
  router.get('/stats', auth, (_req: Request, res: Response) => {
    const sr = new ServiceResponse(ResponseStatus.Success, 'OK', getStats(), StatusCodes.OK);
    handleServiceResponse(sr, res);
  });

  // DELETE /reasoning-cache/prune?days=N
  router.delete('/prune', auth, (req: Request, res: Response) => {
    const parsed = PruneQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const sr = new ServiceResponse(ResponseStatus.Failed, 'Invalid query params', null, StatusCodes.BAD_REQUEST);
      handleServiceResponse(sr, res);
      return;
    }
    const result = pruneEntries(parsed.data.days);
    const sr = new ServiceResponse(ResponseStatus.Success, 'Pruned', result, StatusCodes.OK);
    handleServiceResponse(sr, res);
  });

  // GET /reasoning-cache/:hash
  router.get('/:hash', auth, async (req: Request, res: Response) => {
    const parsedHash = HashParamSchema.safeParse(req.params);
    if (!parsedHash.success) {
      const sr = new ServiceResponse(ResponseStatus.Failed, 'Invalid hash', null, StatusCodes.BAD_REQUEST);
      handleServiceResponse(sr, res);
      return;
    }
    const entry = await getEntry(parsedHash.data.hash);
    if (!entry) {
      const sr = new ServiceResponse(ResponseStatus.Failed, 'Not found', null, StatusCodes.NOT_FOUND);
      handleServiceResponse(sr, res);
      return;
    }
    const sr = new ServiceResponse(ResponseStatus.Success, 'Found', entry, StatusCodes.OK);
    handleServiceResponse(sr, res);
  });

  // POST /reasoning-cache/:hash
  router.post('/:hash', auth, async (req: Request, res: Response) => {
    const parsedHash = HashParamSchema.safeParse(req.params);
    if (!parsedHash.success) {
      const sr = new ServiceResponse(ResponseStatus.Failed, 'Invalid hash', null, StatusCodes.BAD_REQUEST);
      handleServiceResponse(sr, res);
      return;
    }
    const parsedBody = SaveBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      const sr = new ServiceResponse(ResponseStatus.Failed, 'Missing data field', null, StatusCodes.BAD_REQUEST);
      handleServiceResponse(sr, res);
      return;
    }
    const result = await setEntry(parsedHash.data.hash, parsedBody.data.data);
    const sr = new ServiceResponse(ResponseStatus.Success, 'Saved', { ok: true, ...result }, StatusCodes.OK);
    handleServiceResponse(sr, res);
  });

  return router;
})();
