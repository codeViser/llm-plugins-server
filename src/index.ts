import { createServer } from 'http';

import { env } from '@/common/utils/envConfig';
import { resumeInterruptedDeferredJobs } from '@/deferredJobs/deferredJobWorker';
import { attachToolRelayWebSocket } from '@/executionSurface/relayWsServer';
import { JobStore } from '@/multiAgent/jobStore';
import { app, logger } from '@/server';

const port = env.PORT;
const deferredJobStore = new JobStore();

const httpServer = createServer(app);
attachToolRelayWebSocket(httpServer);

const server = httpServer.listen(port, () => {
  const { NODE_ENV, HOST } = env;
  logger.info(`Server (${NODE_ENV}) running on port http://${HOST}:${port}`);
  if (NODE_ENV !== 'test') {
    resumeInterruptedDeferredJobs(deferredJobStore);
  }
});

const onCloseSignal = () => {
  logger.info('sigint received, shutting down');
  server.close(() => {
    logger.info('server closed');
    process.exit();
  });
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGINT', onCloseSignal);
process.on('SIGTERM', onCloseSignal);
