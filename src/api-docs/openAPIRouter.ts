import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { Request, Response, Router } from 'express';
import swaggerUi from 'swagger-ui-express';

import { generateOpenAPIDocument } from '@/api-docs/openAPIDocumentGenerator';

export function createOpenAPIRouter(registries: OpenAPIRegistry[]): Router {
  const router = express.Router();
  const openAPIDocument = generateOpenAPIDocument(registries);

  router.get('/swagger.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(openAPIDocument);
  });

  router.use('/', swaggerUi.serve, swaggerUi.setup(openAPIDocument));

  return router;
}
