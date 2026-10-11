export type VendorCredentialMap = Record<string, string>;

/**
 * Resolve API key for a plugin handle from ephemeral TM snapshot vendor map.
 * Keys are `plugin:{pluginId}:{settingName}`; handle is `plugin:{pluginId}`.
 */
export function pickCredentialForHandle(
  credentials: VendorCredentialMap,
  handle: string
): string | undefined {
  const trimmed = handle.trim();
  if (!trimmed) return undefined;

  const exact = credentials[trimmed];
  if (exact?.trim()) return exact.trim();

  const prefix = `${trimmed}:`;
  for (const [key, value] of Object.entries(credentials)) {
    if (key.startsWith(prefix) && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/** @deprecated legacy stash keys; try handle prefix first. */
export function pickCredentialForHttpTarget(
  credentials: VendorCredentialMap,
  handle: string,
  legacyRef?: string
): string | undefined {
  const fromHandle = pickCredentialForHandle(credentials, handle);
  if (fromHandle) return fromHandle;
  if (legacyRef && credentials[legacyRef]?.trim()) {
    return credentials[legacyRef].trim();
  }
  return undefined;
}
