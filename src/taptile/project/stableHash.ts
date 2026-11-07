function canonicalize(value: unknown, seen: Set<unknown>): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
    return value;
  }
  if (seen.has(value)) throw new Error('Cannot stable-serialize cyclic data.');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort((left, right) => left.localeCompare(right))
        .filter((key) => source[key] !== undefined)
        .map((key) => [key, canonicalize(source[key], seen)]),
    );
  } finally {
    seen.delete(value);
  }
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()));
}

/** A small deterministic FNV-1a hash for cache keys and state identity. */
export function stableHash(value: unknown, prefix = 'hash'): string {
  const input = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
