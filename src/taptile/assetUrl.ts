function currentDocumentBaseUrl(): string {
  if (typeof document === 'undefined') return '/';
  try {
    return new URL('.', document.baseURI).href;
  } catch {
    return '/';
  }
}

export function resolveTapTileBuiltinAssetUrl(
  uri: string,
  baseUrl = currentDocumentBaseUrl(),
): string {
  if (!uri.startsWith('/') || uri.startsWith('//')) return uri;
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${uri.replace(/^\/+/, '')}`;
}
