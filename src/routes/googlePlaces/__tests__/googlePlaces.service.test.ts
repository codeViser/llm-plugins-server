import { describe, expect, it } from 'vitest';

import {
  buildFieldMask,
  normalizeLegacyFieldKey,
  PLUGIN_DEFAULT_FIELDS_DETAILS,
  PLUGIN_DEFAULT_FIELDS_SEARCH,
} from '../googlePlaces.service';

describe('normalizeLegacyFieldKey', () => {
  it('preserves mapped slash paths and collapses unknown geometry paths', () => {
    expect(normalizeLegacyFieldKey('geometry/location')).toBe('geometry/location');
    expect(normalizeLegacyFieldKey('geometry/viewport')).toBe('geometry');
  });

  it('maps singular legacy type alias', () => {
    expect(normalizeLegacyFieldKey('type')).toBe('type');
  });
});

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

  it('maps TypingMind plugin default search fields without invalid paths', () => {
    const mask = buildFieldMask(PLUGIN_DEFAULT_FIELDS_SEARCH, 'list');
    expect(mask).toContain('places.location');
    expect(mask).toContain('places.currentOpeningHours');
    expect(mask).not.toContain('places.geometry/location');
    expect(mask).not.toMatch(/places\.review\b/);
    expect(mask).not.toMatch(/places\.type\b/);
  });

  it('maps TypingMind plugin default detail fields without invalid paths', () => {
    const mask = buildFieldMask(PLUGIN_DEFAULT_FIELDS_DETAILS, 'details');
    expect(mask).toContain('reviews');
    expect(mask).toContain('types');
    expect(mask).toContain('location');
    expect(mask).not.toMatch(/\breview\b/);
    expect(mask).not.toMatch(/\btype\b/);
  });

  it('maps geometry/location, review, and type tokens explicitly', () => {
    const listMask = buildFieldMask('geometry/location,review,type', 'list');
    expect(listMask).toContain('places.location');
    expect(listMask).toContain('places.reviews');
    expect(listMask).toContain('places.types');
    expect(listMask).not.toContain('geometry/location');
  });

  it('does not emit places.${raw} for unknown legacy tokens', () => {
    const mask = buildFieldMask('name,totally_unknown_field', 'list');
    expect(mask).toContain('places.displayName');
    expect(mask).not.toContain('totally_unknown_field');
    expect(mask).not.toContain('places.totally_unknown_field');
  });

  it('matches openaiSpec example field list for search', () => {
    const mask = buildFieldMask(
      'name,formatted_address,opening_hours/open_now,rating,types,geometry/location,business_status',
      'list'
    );
    expect(mask).toContain('places.displayName');
    expect(mask).toContain('places.currentOpeningHours');
    expect(mask).not.toContain('places.geometry/location');
  });
});
