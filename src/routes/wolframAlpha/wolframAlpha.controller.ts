import { Request, Response } from 'express';
import got from 'got';
import { StatusCodes } from 'http-status-codes';

import { ResponseStatus, ServiceResponse } from '@/common/models/serviceResponse';
import { handleServiceResponse } from '@/common/utils/httpHandlers';
import { logger } from '@/server';

interface WolframAlphaRequestBody {
  input: string;
  maxchars?: number;
  wolframAppId: string;
}

export const handleWolframAlphaQuery = async (req: Request, res: Response) => {
  const { input, maxchars, wolframAppId } = req.body as WolframAlphaRequestBody;

  if (!wolframAppId) {
    const serviceResponse = new ServiceResponse(
      ResponseStatus.Failed,
      'Wolfram AppID is missing in request body',
      null,
      StatusCodes.BAD_REQUEST
    );
    return handleServiceResponse(serviceResponse, res);
  }

  if (!input || input.trim() === '') {
    const serviceResponse = new ServiceResponse(
      ResponseStatus.Failed,
      'Query input is missing or empty',
      null,
      StatusCodes.BAD_REQUEST
    );
    return handleServiceResponse(serviceResponse, res);
  }

  const searchParams: Record<string, string | number> = {
    input: input.trim(),
    appid: wolframAppId,
  };

  if (maxchars && maxchars > 0) {
    searchParams.maxchars = maxchars;
  }

  try {
    const wolframResponse = await got.get('https://www.wolframalpha.com/api/v1/llm-api', {
      searchParams,
      responseType: 'text',
      throwHttpErrors: false,
    });

    if (wolframResponse.statusCode !== StatusCodes.OK) {
      logger.error(
        { body: wolframResponse.body, statusCode: wolframResponse.statusCode },
        'Wolfram Alpha API request failed'
      );
      const serviceResponse = new ServiceResponse(
        ResponseStatus.Failed,
        `Wolfram Alpha API error: ${wolframResponse.body}`,
        null,
        wolframResponse.statusCode as StatusCodes
      );
      return handleServiceResponse(serviceResponse, res);
    }

    res.status(StatusCodes.OK).json({ result: wolframResponse.body });
  } catch (error: any) {
    logger.error(error, 'Error during Wolfram Alpha API call');
    const message = error.message || 'An unexpected error occurred';
    const serviceResponse = new ServiceResponse(
      ResponseStatus.Failed,
      message,
      null,
      StatusCodes.INTERNAL_SERVER_ERROR
    );
    handleServiceResponse(serviceResponse, res);
  }
};
