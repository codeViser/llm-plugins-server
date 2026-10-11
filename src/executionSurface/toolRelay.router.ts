import { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';

import { connectorAuthMiddleware } from '@/multiAgent/connectorAuth';

import { deliverRelayResult, listPendingInvocations } from './relaySession';
import { ToolRelayResultSchema } from './toolCatalog.schema';

export type ToolRelayRouterDeps = {
  authToken: string;
};

export function createToolRelayRouter(deps: ToolRelayRouterDeps): Router {
  const router = Router();
  const auth = connectorAuthMiddleware(deps.authToken || 'dummy-token');

  router.post('/relay-result', auth, (req: Request, res: Response) => {
    const parsed = ToolRelayResultSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid relay result' });
    }
    const body = parsed.data;
    deliverRelayResult({
      jobId: body.job_id,
      callId: body.call_id,
      content: body.content,
      isError: body.is_error,
    });
    return res.status(StatusCodes.OK).json({ ok: true });
  });

  router.post('/pending', auth, (req: Request, res: Response) => {
    const jobId = String(req.body?.job_id ?? '').trim();
    if (!jobId) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'job_id required' });
    }
    return res.status(StatusCodes.OK).json({ pending_invocations: listPendingInvocations(jobId) });
  });

  return router;
}
