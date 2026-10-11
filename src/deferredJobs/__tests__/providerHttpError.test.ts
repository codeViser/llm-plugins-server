import { describe, expect, it } from 'vitest';

import { formatProviderHttpError } from '../providerHttpError';

describe('formatProviderHttpError', () => {
  it('includes provider error message from JSON body', () => {
    const msg = formatProviderHttpError(
      {
        message: 'Response code 400 (Bad Request)',
        response: {
          statusCode: 400,
          body: { error: { message: 'anthropic/claude-haikyu-5.5 is not a valid model ID' } },
        },
      },
      'OpenRouter gather chat'
    );
    expect(msg).toContain('OpenRouter gather chat');
    expect(msg).toContain('not a valid model ID');
  });

  it('includes OpenRouter metadata.raw when present', () => {
    const msg = formatProviderHttpError(
      {
        message: 'Response code 400',
        response: {
          statusCode: 400,
          body: {
            error: {
              message: 'Provider returned error',
              metadata: { raw: 'reasoning is not supported for this model', provider_name: 'Anthropic' },
            },
          },
        },
      },
      'OpenRouter gather chat'
    );
    expect(msg).toContain('reasoning is not supported');
  });
});
