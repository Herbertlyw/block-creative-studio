/** Saved project settings are the default; a temporary override exists only after user selection. */
export interface PreviewVariantSelection {
  lookKey: string;
  route: 'bridge' | 'v2';
  clearFromLook: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Inspect the untrusted document without interpreting unsupported fields. */
export function readPreviewStyle(document: unknown): Record<string, unknown> | undefined {
  return record(record(record(document)?.direction)?.style);
}

export function resolvePreviewVariant(
  document: unknown,
  override: PreviewVariantSelection | null,
): PreviewVariantSelection {
  if (override) return override;
  const value = readPreviewStyle(document)?.workbenchVariantV1;
  if (value && typeof value === 'object') {
    const saved = value as { lookKey?: unknown; clearFromLook?: unknown };
    if (typeof saved.lookKey === 'string' && typeof saved.clearFromLook === 'string') {
      return { lookKey: saved.lookKey, clearFromLook: saved.clearFromLook, route: 'v2' };
    }
  }
  return { lookKey: '', clearFromLook: '', route: 'bridge' };
}
