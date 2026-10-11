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
});
