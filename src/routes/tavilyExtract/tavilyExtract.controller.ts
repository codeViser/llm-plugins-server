import { Request, Response } from 'express';
import got from 'got';
import { StatusCodes } from 'http-status-codes';

import { logger } from '@/server';
import { ServiceResponse, ResponseStatus } from '@/common/models/serviceResponse';
import { handleServiceResponse } from '@/common/utils/httpHandlers';

interface TavilyExtractRequestBody {
  urls: string[];
  include_images?: boolean;
  tavilyAPIKey: string;
}

export const handleAdvancedExtract = async (req: Request, res: Response) => {
  const { urls, include_images, tavilyAPIKey } = req.body as TavilyExtractRequestBody;

  if (!tavilyAPIKey) {
    const serviceResponse = new ServiceResponse(ResponseStatus.Failed, 'Tavily API Key is missing in request body', null, StatusCodes.BAD_REQUEST);
    return handleServiceResponse(serviceResponse, res);
  }

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    const serviceResponse = new ServiceResponse(ResponseStatus.Failed, 'URLs are missing or invalid in request body', null, StatusCodes.BAD_REQUEST);
    return handleServiceResponse(serviceResponse, res);
  }

  const tavilyApiUrl = 'https://api.tavily.com/extract';
  const tavilyRequestBody = {
    urls: urls,
    include_images: include_images || false,
    extract_depth: "advanced",
  };

  try {
    const tavilyResponse = await got.post(tavilyApiUrl, {
      json: tavilyRequestBody,
      headers: {
        "Authorization": `Bearer ${tavilyAPIKey}`,
      },
      responseType: 'json',
      throwHttpErrors: false, // We want to handle HTTP errors manually to forward Tavily's response
    });

    // Type assertion for the body, as got with responseType: 'json' will parse it.
    const responseData = tavilyResponse.body as any;

    if (tavilyResponse.statusCode !== StatusCodes.OK) {
      logger.error({ data: responseData, statusCode: tavilyResponse.statusCode }, `Tavily API request failed`);
      const errorMessage = responseData?.message || responseData?.error || JSON.stringify(responseData);
      const serviceResponse = new ServiceResponse(ResponseStatus.Failed, `Tavily API error: ${errorMessage}`, responseData, tavilyResponse.statusCode as StatusCodes);
      return handleServiceResponse(serviceResponse, res);
    }
    
    // Tavily API was successful, forward the data
    res.status(StatusCodes.OK).json(responseData);

  } catch (error: any) {
    logger.error(error, 'Error during advanced Tavily API call');
    // Check if it's a GotError to potentially extract more details
    let message = 'An unexpected error occurred';
    if (error.response && error.response.body) {
        try {
            const gotErrorBody = JSON.parse(error.response.body);
            message = gotErrorBody.message || gotErrorBody.error || error.response.body;
        } catch (e) {
            message = error.response.body || error.message;
        }
    } else if (error.message) {
        message = error.message;
    }
    const serviceResponse = new ServiceResponse(ResponseStatus.Failed, message, null, StatusCodes.INTERNAL_SERVER_ERROR);
    handleServiceResponse(serviceResponse, res);
  }
}; 