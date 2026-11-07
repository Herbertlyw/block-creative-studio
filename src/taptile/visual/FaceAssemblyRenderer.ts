import type { FaceAssembly, FacePart, FacePartTransform } from '../project';
import { TapTileAssetRegistry } from './AssetRegistry';
import type { RenderedFaceAssembly, RenderedFacePart } from './types';

function repeatOffset(part: FacePart, index: number, count: number): { x: number; y: number } {
  const custom = part.repeat?.offsets?.[index];
  if (custom) return custom;
  const centered = index - (count - 1) / 2;
  if (part.repeat?.layout === 'column') return { x: 0, y: centered * 0.18 };
  if (part.repeat?.layout === 'grid') {
    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    return {
      x: (index % columns - (columns - 1) / 2) * 0.18,
      y: (Math.floor(index / columns) - (rows - 1) / 2) * 0.18,
    };
  }
  if (part.repeat?.layout === 'custom') return { x: 0, y: 0 };
  return { x: centered * 0.18, y: 0 };
}

function repeatedTransform(part: FacePart, index: number, count: number): FacePartTransform {
  const offset = repeatOffset(part, index, count);
  return { ...part.transform, x: part.transform.x + offset.x, y: part.transform.y + offset.y };
}

export function renderFaceAssembly(
  assembly: FaceAssembly,
  registry: TapTileAssetRegistry,
): RenderedFaceAssembly {
  const parts: RenderedFacePart[] = [];
  for (const part of assembly.parts) {
    const count = Math.max(1, Math.floor(part.repeat?.count ?? 1));
    for (let index = 0; index < count; index += 1) {
      parts.push({
        id: count === 1 ? part.id : `${part.id}:${index}`,
        source: part.source.kind === 'glyph'
          ? { ...part.source }
          : { kind: 'image', assetId: part.source.assetId, asset: registry.resolve(part.source.assetId) },
        transform: repeatedTransform(part, index, count),
        repeatIndex: index,
      });
    }
  }
  return {
    id: assembly.id,
    mode: assembly.mode,
    showBody: assembly.bodyInteraction !== 'replace-front-surface',
    fit: assembly.mode === 'overlay-on-body'
      ? 'contain-safe-area'
      : assembly.mode === 'full-front'
        ? 'cover-front'
        : 'composed',
    parts,
  };
}
