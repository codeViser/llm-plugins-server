import { Request, Response } from 'express';
import got from 'got';
import { StatusCodes } from 'http-status-codes';

import { ResponseStatus, ServiceResponse } from '@/common/models/serviceResponse';
import { handleServiceResponse } from '@/common/utils/httpHandlers';
import { logger } from '@/server';

import { TavilyMapServerRequestBody, TavilyMapServerResponse } from './tavilyMapModel';

// Type for the actual request body sent to the external Tavily Map API
// It excludes tavilyAPIKey which is used for Authorization header
type TavilyExternalApiRequestBody = Omit<TavilyMapServerRequestBody, 'tavilyAPIKey'>;

export const handleTavilyMapProxy = async (req: Request, res: Response) => {
  const {
    tavilyAPIKey,
    // Spread the rest of the properties into a new object for the external API call
    ...externalApiParams
  } = req.body as TavilyMapServerRequestBody;

  const { url } = externalApiParams;

  if (!tavilyAPIKey) {
    const serviceResponse = new ServiceResponse(
      ResponseStatus.Failed,
      'Tavily API Key is missing in request body',
      null,
      StatusCodes.BAD_REQUEST
    );
    return handleServiceResponse(serviceResponse, res);
  }
  if (!url) {
    const serviceResponse = new ServiceResponse(
      ResponseStatus.Failed,
      'URL is missing in request body',
      null,
      StatusCodes.BAD_REQUEST
    );
    return handleServiceResponse(serviceResponse, res);
  }

  const tavilyMapApiUrl = 'https://api.tavily.com/map';

  // Construct the request body for Tavily Map API from validated params
  // externalApiParams already has the correct structure matching TavilyExternalApiRequestBody
  const tavilyApiSendBody: TavilyExternalApiRequestBody = externalApiParams;

  try {
    const tavilyResponse = await got.post(tavilyMapApiUrl, {
      json: tavilyApiSendBody, // Use the strongly-typed object
      headers: {
        Authorization: `Bearer ${tavilyAPIKey}`,
        'Content-Type': 'application/json',
      },
      responseType: 'json',
      throwHttpErrors: false,
    });

    const responseData = tavilyResponse.body as any; // Tavily's response can be initially treated as any

    if (tavilyResponse.statusCode !== StatusCodes.OK) {
      logger.error({ data: responseData, statusCode: tavilyResponse.statusCode }, `Tavily Map API request failed`);
      const errorMessage = responseData?.message || responseData?.error || JSON.stringify(responseData);
      const serviceResponse = new ServiceResponse(
        ResponseStatus.Failed,
        `Tavily Map API error: ${errorMessage}`,
        responseData,
        tavilyResponse.statusCode as StatusCodes
      );
      return handleServiceResponse(serviceResponse, res);
    }

    // Validate and structure the response before sending it back
    const validatedResponse: TavilyMapServerResponse = {
      base_url: responseData.base_url,
      results: responseData.results,
      response_time: responseData.response_time,
    };

    res.status(StatusCodes.OK).json(validatedResponse);
  } catch (error: any) {
    logger.error(error, 'Error during Tavily Map API call via proxy');
    let message = 'An unexpected error occurred while calling Tavily Map API';
    if (error.response && error.response.body) {
      try {
        const gotErrorBody = JSON.parse(error.response.body as string);
        message = gotErrorBody.message || gotErrorBody.error || (error.response.body as string);
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
