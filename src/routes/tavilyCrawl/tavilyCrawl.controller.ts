import { Request, Response } from 'express';
import got from 'got';
import { StatusCodes } from 'http-status-codes';

import { ResponseStatus, ServiceResponse } from '@/common/models/serviceResponse';
import { handleServiceResponse } from '@/common/utils/httpHandlers';
import { logger } from '@/server';

import { TavilyCrawlServerRequestBody } from './tavilyCrawlModel';

export const handleTavilyCrawlProxy = async (req: Request, res: Response) => {
  const {
    tavilyAPIKey,
    url,
    instructions,
    max_depth,
    max_breadth,
    limit,
    allow_external,
    include_images,
    extract_depth,
    select_paths,
    select_domains,
    exclude_paths,
    exclude_domains,
    categories,
  } = req.body as TavilyCrawlServerRequestBody;

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

  const tavilyApiUrl = 'https://api.tavily.com/crawl';

  // Construct the request body for Tavily, excluding tavilyAPIKey
  const tavilyRequestBody: any = { url }; // Start with required fields
  if (instructions !== undefined) tavilyRequestBody.instructions = instructions;
  if (max_depth !== undefined) tavilyRequestBody.max_depth = max_depth;
  if (max_breadth !== undefined) tavilyRequestBody.max_breadth = max_breadth;
  if (limit !== undefined) tavilyRequestBody.limit = limit;
  if (allow_external !== undefined) tavilyRequestBody.allow_external = allow_external;
  if (include_images !== undefined) tavilyRequestBody.include_images = include_images;
  if (extract_depth !== undefined) tavilyRequestBody.extract_depth = extract_depth;
  if (select_paths !== undefined) tavilyRequestBody.select_paths = select_paths;
  if (select_domains !== undefined) tavilyRequestBody.select_domains = select_domains;
  if (exclude_paths !== undefined) tavilyRequestBody.exclude_paths = exclude_paths;
  if (exclude_domains !== undefined) tavilyRequestBody.exclude_domains = exclude_domains;
  if (categories !== undefined) tavilyRequestBody.categories = categories;

  try {
    const tavilyResponse = await got.post(tavilyApiUrl, {
      json: tavilyRequestBody,
      headers: {
        Authorization: `Bearer ${tavilyAPIKey}`,
      },
      responseType: 'json',
      throwHttpErrors: false,
    });

    const responseData = tavilyResponse.body as any;

    if (tavilyResponse.statusCode !== StatusCodes.OK) {
      logger.error({ data: responseData, statusCode: tavilyResponse.statusCode }, `Tavily Crawl API request failed`);
      const errorMessage = responseData?.message || responseData?.error || JSON.stringify(responseData);
      const serviceResponse = new ServiceResponse(
        ResponseStatus.Failed,
        `Tavily Crawl API error: ${errorMessage}`,
        responseData,
        tavilyResponse.statusCode as StatusCodes
      );
      return handleServiceResponse(serviceResponse, res);
    }

    // Forward Tavily's successful response directly
    res.status(StatusCodes.OK).json(responseData);
  } catch (error: any) {
    logger.error(error, 'Error during Tavily Crawl API call via proxy');
    let message = 'An unexpected error occurred';
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
