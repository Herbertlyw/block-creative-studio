/** Static reference sprites can use the same hash-checked asset attachments as other BB images. */
export function validReferenceSprite(value: unknown, entries: Record<string, any>, maxChars: number): boolean {
  if (typeof value !== 'string') return false;
  if (value.startsWith('data:image/png;base64,')) return value.length <= maxChars;
  if (!/^asset:[a-zA-Z0-9_-]+$/.test(value)) return false;
  const entry = entries[value.slice(6)];
  return !!entry && entry.kind === 'image' && entry.mimeType === 'image/png'
    && (entry.encoding === 'base64' || entry.encoding === 'ref')
    && Number.isFinite(entry.byteLength) && entry.byteLength * 4 / 3 + 22 <= maxChars;
}

export function resolveReferenceSprites(sprites: Record<string, string> | undefined, entries: Record<string, any>): Record<string, string> {
  return Object.fromEntries(Object.entries(sprites ?? {}).map(([name, value]) => {
    if (!value.startsWith('asset:')) return [name, value];
    const entry = entries[value.slice(6)];
    if (!entry || entry.kind !== 'image' || entry.mimeType !== 'image/png') throw new Error(`REFERENCE_SPRITE_ASSET_MISSING:${name}`);
    if (entry.encoding !== 'base64' || typeof entry.data !== 'string') throw new Error(`REFERENCE_SPRITE_ASSET_UNRESOLVED:${name}`);
    return [name, `data:image/png;base64,${entry.data}`];
  }));
}
