import got from 'got';
import { z } from 'zod';

import { GooglePlacesApiRequestBodySchema } from './googlePlacesModel';

type PlacesRequest = z.infer<typeof GooglePlacesApiRequestBodySchema>;

const PLACES_BASE = 'https://places.googleapis.com/v1';

/** Legacy Places field names → Places API (New) field paths (list/search). */
const LEGACY_LIST_FIELD_MAP: Record<string, string> = {
  place_id: 'places.id',
  name: 'places.displayName',
  formatted_address: 'places.formattedAddress',
  geometry: 'places.location',
  location: 'places.location',
  rating: 'places.rating',
  types: 'places.types',
  business_status: 'places.businessStatus',
  opening_hours: 'places.regularOpeningHours,places.currentOpeningHours',
  'opening_hours/open_now': 'places.currentOpeningHours',
  photos: 'places.photos',
  user_ratings_total: 'places.userRatingCount',
  price_level: 'places.priceLevel',
  vicinity: 'places.formattedAddress',
  icon: 'places.iconMaskBaseUri',
  reference: 'places.id',
};

/** Legacy detail field names → Places API (New) field paths (single place). */
const LEGACY_DETAIL_FIELD_MAP: Record<string, string> = {
  place_id: 'id',
  name: 'displayName',
  formatted_address: 'formattedAddress',
  geometry: 'location',
  location: 'location',
  rating: 'rating',
  types: 'types',
  business_status: 'businessStatus',
  opening_hours: 'regularOpeningHours,currentOpeningHours',
  'opening_hours/open_now': 'currentOpeningHours',
  formatted_phone_number: 'nationalPhoneNumber',
  international_phone_number: 'internationalPhoneNumber',
  website: 'websiteUri',
  url: 'googleMapsUri',
  photos: 'photos',
  user_ratings_total: 'userRatingCount',
  price_level: 'priceLevel',
  reviews: 'reviews',
};

const DEFAULT_LIST_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.googleMapsUri';

const DEFAULT_DETAIL_FIELD_MASK =
  'id,displayName,formattedAddress,location,rating,types,googleMapsUri,nationalPhoneNumber,websiteUri,regularOpeningHours,currentOpeningHours';

export function buildFieldMask(
  fields: string | undefined,
  mode: 'list' | 'details'
): string {
  if (!fields?.trim()) {
    return mode === 'details' ? DEFAULT_DETAIL_FIELD_MASK : DEFAULT_LIST_FIELD_MASK;
  }

  const map = mode === 'details' ? LEGACY_DETAIL_FIELD_MAP : LEGACY_LIST_FIELD_MAP;
  const out = new Set<string>();

  for (const raw of fields.split(',')) {
    const key = raw.trim();
    if (!key) continue;
    const mapped = map[key] ?? (mode === 'details' ? key : `places.${key}`);
    for (const part of mapped.split(',')) {
      out.add(part.trim());
    }
  }

  if (out.size === 0) {
    return mode === 'details' ? DEFAULT_DETAIL_FIELD_MASK : DEFAULT_LIST_FIELD_MASK;
  }
  return [...out].join(',');
}

function parseLocation(location: string): { latitude: number; longitude: number } {
  const parts = location.split(',').map((s) => s.trim());
  if (parts.length !== 2) {
    throw new Error("The 'location' parameter must be 'latitude,longitude'.");
  }
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("The 'location' parameter must contain numeric latitude and longitude.");
  }
  return { latitude, longitude };
}

function stripPlaceId(placeId: string): string {
  return placeId.replace(/^places\//, '');
}

function placeToLegacy(place: Record<string, unknown>) {
  const rawId = place.id as string | undefined;
  const place_id = rawId ? stripPlaceId(rawId) : undefined;
  const displayName = place.displayName as { text?: string } | string | undefined;
  const name =
    typeof displayName === 'string' ? displayName : displayName?.text;

  const loc = place.location as { latitude?: number; longitude?: number } | undefined;

  const legacy: Record<string, unknown> = {
    place_id,
    name,
    formatted_address: place.formattedAddress,
    rating: place.rating,
    types: place.types,
    business_status: place.businessStatus,
    user_ratings_total: place.userRatingCount,
    price_level: place.priceLevel,
    vicinity: place.formattedAddress,
    url: place.googleMapsUri,
    website: place.websiteUri,
    formatted_phone_number: place.nationalPhoneNumber,
    international_phone_number: place.internationalPhoneNumber,
  };

  if (loc?.latitude != null && loc?.longitude != null) {
    legacy.geometry = {
      location: { lat: loc.latitude, lng: loc.longitude },
    };
  }

  const current = place.currentOpeningHours as { openNow?: boolean } | undefined;
  const regular = place.regularOpeningHours;
  if (current || regular) {
    legacy.opening_hours = {
      open_now: current?.openNow,
      ...(regular ? { periods: regular } : {}),
    };
  }

  return legacy;
}

function legacyListResponse(places: Record<string, unknown>[]) {
  return {
    status: 'OK',
    results: places.map(placeToLegacy),
  };
}

function legacyDetailResponse(place: Record<string, unknown>) {
  return {
    status: 'OK',
    result: placeToLegacy(place),
  };
}

function legacyError(status: string, error_message: string) {
  return { status, error_message, results: [] };
}

async function placesPost(
  apiKey: string,
  path: string,
  fieldMask: string,
  json: Record<string, unknown>
) {
  try {
    const response = await got.post(`${PLACES_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      json,
      responseType: 'json',
    });
    return response.body as Record<string, unknown>;
  } catch (error: unknown) {
    const err = error as { response?: { body?: unknown }; message?: string };
    const body = err.response?.body;
    if (body && typeof body === 'object' && 'error' in body) {
      const e = (body as { error: { message?: string; status?: string } }).error;
      const status = e.status === 'PERMISSION_DENIED' ? 'REQUEST_DENIED' : 'UNKNOWN_ERROR';
      throw Object.assign(new Error(e.message || 'Google Places API error'), {
        legacy: legacyError(status, e.message || 'Google Places API error'),
      });
    }
    throw new Error(err.message || 'Google Places API error');
  }
}

async function placesGet(apiKey: string, placeId: string, fieldMask: string) {
  const id = encodeURIComponent(stripPlaceId(placeId));
  try {
    const response = await got.get(`${PLACES_BASE}/places/${id}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      responseType: 'json',
    });
    return response.body as Record<string, unknown>;
  } catch (error: unknown) {
    const err = error as { response?: { body?: unknown }; message?: string };
    const body = err.response?.body;
    if (body && typeof body === 'object' && 'error' in body) {
      const e = (body as { error: { message?: string; status?: string } }).error;
      const status = e.status === 'PERMISSION_DENIED' ? 'REQUEST_DENIED' : 'UNKNOWN_ERROR';
      throw Object.assign(new Error(e.message || 'Google Places API error'), {
        legacy: legacyError(status, e.message || 'Google Places API error'),
      });
    }
    throw new Error(err.message || 'Google Places API error');
  }
}

/**
 * Places API (New) — https://developers.google.com/maps/documentation/places/web-service/op-overview
 * Responses are normalized to the legacy JSON shape expected by TypingMind plugins.
 */
export async function fetchFromGooglePlacesApi(params: PlacesRequest) {
  const { apiKey, searchType } = params;

  if (!apiKey?.trim()) {
    throw new Error('API Key is required.');
  }

  switch (searchType) {
    case 'textsearch': {
      if (!params.query?.trim()) {
        throw new Error("'query' is required for textsearch.");
      }
      const fieldMask = buildFieldMask(params.fields, 'list');
      const body = await placesPost(apiKey, '/places:searchText', fieldMask, {
        textQuery: params.query,
        maxResultCount: 20,
      });
      const places = (body.places as Record<string, unknown>[]) || [];
      return legacyListResponse(places);
    }

    case 'nearbysearch': {
      if (!params.location) {
        throw new Error("The 'location' parameter (latitude,longitude) is required for 'nearbysearch'.");
      }
      const center = parseLocation(params.location);
      const radius = params.radius ?? 1500;
      const fieldMask = buildFieldMask(params.fields, 'list');

      if (params.query?.trim()) {
        const body = await placesPost(apiKey, '/places:searchText', fieldMask, {
          textQuery: params.query,
          maxResultCount: 20,
          locationBias: {
            circle: { center, radius: Number(radius) },
          },
        });
        const places = (body.places as Record<string, unknown>[]) || [];
        return legacyListResponse(places);
      }

      const body = await placesPost(apiKey, '/places:searchNearby', fieldMask, {
        maxResultCount: 20,
        locationRestriction: {
          circle: { center, radius: Number(radius) },
        },
      });
      const places = (body.places as Record<string, unknown>[]) || [];
      return legacyListResponse(places);
    }

    case 'details': {
      if (!params.placeId?.trim()) {
        throw new Error("The 'placeId' parameter is required for 'details' searchType.");
      }
      const fieldMask = buildFieldMask(params.fields, 'details');
      const place = await placesGet(apiKey, params.placeId, fieldMask);
      return legacyDetailResponse(place);
    }

    default:
      throw new Error(`Invalid searchType: ${searchType}.`);
  }
}
