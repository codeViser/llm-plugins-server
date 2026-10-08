import { describe, expect, it } from 'vitest';

import { buildFieldMask } from '../googlePlaces.service';

describe('buildFieldMask', () => {
  it('uses defaults when fields omitted', () => {
    expect(buildFieldMask(undefined, 'list')).toContain('places.displayName');
    expect(buildFieldMask(undefined, 'details')).toContain('displayName');
  });

  it('maps legacy list field names', () => {
    const mask = buildFieldMask('name,formatted_address,rating', 'list');
    expect(mask).toContain('places.displayName');
    expect(mask).toContain('places.formattedAddress');
    expect(mask).toContain('places.rating');
  });

  it('maps legacy detail field names', () => {
    const mask = buildFieldMask('name,website,formatted_phone_number', 'details');
    expect(mask).toContain('displayName');
    expect(mask).toContain('websiteUri');
    expect(mask).toContain('nationalPhoneNumber');
  });
});
