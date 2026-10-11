import { createHash } from 'crypto';

import type { ToolCatalogEntryV1 } from './types';

/** Canonical hash for tool list (excludes catalog_hash field). */
export function computeCatalogHash(tools: ToolCatalogEntryV1[]): string {
  const canonical = JSON.stringify(
    tools.map((t) => ({
      handle: t.handle,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }))
  );
  return createHash('sha256').update(canonical).digest('hex');
}

export function verifyCatalogHash(catalog: { catalog_hash: string; tools: ToolCatalogEntryV1[] }): boolean {
  return catalog.catalog_hash === computeCatalogHash(catalog.tools);
}
