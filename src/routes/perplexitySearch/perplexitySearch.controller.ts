import { Request, Response } from 'express';
import got from 'got';
import { StatusCodes } from 'http-status-codes';

import { ResponseStatus, ServiceResponse } from '@/common/models/serviceResponse';
import { handleServiceResponse } from '@/common/utils/httpHandlers';
import { logger } from '@/server';

import { PerplexitySearchServerRequestBody } from './perplexitySearchModel';

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/v1/sonar';

export const handlePerplexitySearchProxy = async (req: Request, res: Response) => {
  const { perplexityAPIKey, keyword, model, systemMessage } = req.body as PerplexitySearchServerRequestBody;

  if (!perplexityAPIKey) {
    const serviceResponse = new ServiceResponse(
      ResponseStatus.Failed,
      'Perplexity API Key is missing in request body',
      null,
      StatusCodes.BAD_REQUEST
    );
    return handleServiceResponse(serviceResponse, res);
  }

  if (!keyword) {
    const serviceResponse = new ServiceResponse(
      ResponseStatus.Failed,
      'keyword is missing in request body',
      null,
      StatusCodes.BAD_REQUEST
    );
    return handleServiceResponse(serviceResponse, res);
  }

  const perplexityRequestBody = {
    model: model ?? 'sonar-pro',
    messages: [
      { role: 'system', content: systemMessage ?? 'Be precise and concise.' },
      { role: 'user', content: keyword },
    ],
  };

  try {
    const perplexityResponse = await got.post(PERPLEXITY_API_URL, {
      json: perplexityRequestBody,
      headers: {
        Authorization: `Bearer ${perplexityAPIKey}`,
      },
      responseType: 'json',
      throwHttpErrors: false,
    });

    const responseData = perplexityResponse.body as any;

    if (perplexityResponse.statusCode !== StatusCodes.OK) {
      logger.error(
        { data: responseData, statusCode: perplexityResponse.statusCode },
        'Perplexity API request failed'
      );
      const errorMessage =
        responseData?.error?.message || responseData?.message || JSON.stringify(responseData);
      const serviceResponse = new ServiceResponse(
        ResponseStatus.Failed,
        `Perplexity API error: ${errorMessage}`,
        responseData,
        perplexityResponse.statusCode as StatusCodes
      );
      return handleServiceResponse(serviceResponse, res);
    }

    const content: string = (responseData.choices ?? [])
      .map((c: any) => c?.message?.content ?? '')
      .join(' ')
      .trim();

    const citations: string[] = Array.isArray(responseData.citations) ? responseData.citations : [];

    res.status(StatusCodes.OK).json({ content, citations });
  } catch (error: any) {
    logger.error(error, 'Error during Perplexity API call via proxy');
    let message = 'An unexpected error occurred';
    if (error.response && error.response.body) {
      try {
        const gotErrorBody = JSON.parse(error.response.body as string);
        message =
          gotErrorBody?.error?.message ||
          gotErrorBody.message ||
          gotErrorBody.error ||
          (error.response.body as string);
      } catch (e) {
        message = (error.response.body as string) || error.message;
      }
    } else if (error.message) {
      message = error.message;
    }
    const serviceResponse = new ServiceResponse(
      ResponseStatus.Failed,
      message,
      null,
      StatusCodes.INTERNAL_SERVER_ERROR
    );
    handleServiceResponse(serviceResponse, res);
  }
};
