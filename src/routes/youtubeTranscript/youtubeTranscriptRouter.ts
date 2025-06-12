import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { YoutubeTranscript } from 'youtube-transcript';
import { z } from 'zod';

import { createApiResponse } from '@/api-docs/openAPIResponseBuilders';
import { ResponseStatus, ServiceResponse } from '@/common/models/serviceResponse';
import { handleServiceResponse } from '@/common/utils/httpHandlers';

import { YoutubeTranscriptRequestParamSchema, YoutubeTranscriptResponseSchema } from './youtubeTranscriptModel';

export const youtubeTranscriptRegistry = new OpenAPIRegistry();
youtubeTranscriptRegistry.register('YoutubeTranscript', YoutubeTranscriptResponseSchema);

export const youtubeTranscriptRouter: Router = (() => {
  const router = express.Router();

  youtubeTranscriptRegistry.registerPath({
    method: 'get',
    path: '/youtube-transcript/get-transcript',
    tags: ['Youtube Transcript'],
    request: {
      query: YoutubeTranscriptRequestParamSchema,
    },
    responses: createApiResponse(YoutubeTranscriptResponseSchema, 'Success'),
  });

  router.get('/get-transcript', async (_req: Request, res: Response) => {
    try {
      const { videoId } = YoutubeTranscriptRequestParamSchema.parse(_req.query);

      const transcript = await YoutubeTranscript.fetchTranscript(videoId);
      const textOnly = transcript.map((entry) => entry.text).join(' ');
      const serviceResponse = new ServiceResponse(
        ResponseStatus.Success,
        'Transcript fetched successfully',
        { textOnly },
        StatusCodes.OK
      );

      handleServiceResponse(serviceResponse, res);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        const serviceResponse = new ServiceResponse(
          ResponseStatus.Failed,
          'Invalid input',
          { errors: error.errors },
          StatusCodes.BAD_REQUEST
        );
        return handleServiceResponse(serviceResponse, res);
      }

      const errorMessage = `Error fetching transcript: ${(error as Error).message}`;
      const serviceResponse = new ServiceResponse(
        ResponseStatus.Failed,
        errorMessage,
        null,
        StatusCodes.INTERNAL_SERVER_ERROR
      );
      handleServiceResponse(serviceResponse, res);
    }
  });
  return router;
})();
