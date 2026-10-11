import { env } from '@/common/utils/envConfig';
import { pino } from 'pino';

import { createDeferredJobsRouter } from './deferredJobs.router';

const logger = pino({ name: 'deferred-jobs' });

export { createDeferredJobsRouter } from './deferredJobs.router';
export { submitOpenRouterBatch, getOpenRouterBatch, isTerminalBatchStatus } from './openRouterBatch';
export * from './schemas';

const authToken = env.MCP_AUTH_TOKEN;
if (!authToken) {
  logger.warn('MCP_AUTH_TOKEN is not set. /deferred-jobs routes will use the dummy test token.');
}

export const deferredJobsRouter = createDeferredJobsRouter({
  authToken: authToken || 'dummy-token',
});
