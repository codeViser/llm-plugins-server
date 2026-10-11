import { describe, expect, it } from 'vitest';

import { pickCredentialForHandle, pickCredentialForHttpTarget } from '../credentialLookup';

describe('credentialLookup', () => {
  const vendor = {
    'plugin:tavily_search:tavilyAPIKey': 'tvly-abc',
    'vendor:tavily': 'legacy',
  };

  it('pickCredentialForHandle returns first plugin:id:* match', () => {
    expect(pickCredentialForHandle(vendor, 'plugin:tavily_search')).toBe('tvly-abc');
  });

  it('pickCredentialForHandle returns undefined when missing', () => {
    expect(pickCredentialForHandle(vendor, 'plugin:unknown')).toBeUndefined();
  });

  it('pickCredentialForHttpTarget prefers handle over legacy ref', () => {
    expect(pickCredentialForHttpTarget(vendor, 'plugin:tavily_search', 'vendor:tavily')).toBe(
      'tvly-abc'
    );
  });
});
