import { describe, expect, it } from 'vitest';

import { optionalRecord } from '../zodHelpers';

describe('optionalRecord', () => {
  it('maps null to undefined', () => {
    const r = optionalRecord.safeParse(null);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBeUndefined();
  });

  it('accepts objects', () => {
    const r = optionalRecord.safeParse({ a: 1 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ a: 1 });
  });
});
