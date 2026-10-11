import got from 'got';

import type { ToolExecuteResult } from './types';

export type VendorCredentialMap = Record<string, string>;

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';

export async function executeConnectorHttpTool(args: {
  piTarget: string;
  functionName: string;
  rawArguments: string | Record<string, unknown> | undefined;
  credentials: VendorCredentialMap;
}): Promise<ToolExecuteResult> {
  let parsed: Record<string, unknown> = {};
  if (typeof args.rawArguments === 'string') {
    try {
      parsed = JSON.parse(args.rawArguments) as Record<string, unknown>;
    } catch {
      return { ok: false, text: 'Invalid tool arguments JSON' };
    }
  } else if (args.rawArguments && typeof args.rawArguments === 'object') {
    parsed = args.rawArguments;
  }

  if (args.piTarget === 'tavily:search') {
    const apiKey = args.credentials['vendor:tavily'];
    if (!apiKey) {
      return { ok: false, text: 'vendor:tavily credential missing (send vendor_credential_stash at START)' };
    }
    const query = String(parsed.query ?? parsed.q ?? '');
    if (!query) {
      return { ok: false, text: 'tavily_search requires query' };
    }
    try {
      const body = await got
        .post(TAVILY_SEARCH_URL, {
          json: {
            api_key: apiKey,
            query,
            max_results: parsed.max_results ?? 5,
            search_depth: parsed.search_depth ?? 'basic',
          },
          responseType: 'json',
          timeout: { request: 60_000 },
        })
        .json<unknown>();
      return { ok: true, text: JSON.stringify(body) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, text: `tavily:search failed: ${message}` };
    }
  }

  if (args.piTarget === 'tavily:extract') {
    const apiKey = args.credentials['vendor:tavily'];
    if (!apiKey) {
      return { ok: false, text: 'vendor:tavily credential missing' };
    }
    const urls = parsed.urls ?? parsed.url;
    const urlList = Array.isArray(urls) ? urls : urls ? [urls] : [];
    if (!urlList.length) {
      return { ok: false, text: 'tavily_extract requires urls' };
    }
    try {
      const body = await got
        .post(TAVILY_EXTRACT_URL, {
          json: { api_key: apiKey, urls: urlList },
          responseType: 'json',
          timeout: { request: 90_000 },
        })
        .json<unknown>();
      return { ok: true, text: JSON.stringify(body) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, text: `tavily:extract failed: ${message}` };
    }
  }

  return { ok: false, text: `Unknown pi_connector_http target: ${args.piTarget}` };
}
