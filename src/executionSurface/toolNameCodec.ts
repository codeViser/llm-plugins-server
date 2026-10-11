const TM_PREFIX = 'tm__';

export function encodeTmToolName(handle: string, functionName: string): string {
  const h = encodeURIComponent(handle);
  const f = functionName.replace(/__/g, '_');
  return `${TM_PREFIX}${h}__${f}`;
}

export function decodeTmToolName(encoded: string): { handle: string; functionName: string } | null {
  if (!encoded.startsWith(TM_PREFIX)) {
    return null;
  }
  const rest = encoded.slice(TM_PREFIX.length);
  const sep = rest.indexOf('__');
  if (sep <= 0) {
    return null;
  }
  const handle = decodeURIComponent(rest.slice(0, sep));
  const functionName = rest.slice(sep + 2);
  if (!handle || !functionName) {
    return null;
  }
  return { handle, functionName };
}

export function parseMcpHandle(handle: string): string | null {
  if (!handle.startsWith('mcp:')) {
    return null;
  }
  const id = handle.slice('mcp:'.length).trim();
  return id.length ? id : null;
}
