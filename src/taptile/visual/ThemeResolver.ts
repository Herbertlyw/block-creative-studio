import { stableHash, type TapTilePresentationRole, type TapTileProjectV2 } from '../project';
import { TapTileAssetRegistry } from './AssetRegistry';
import { renderFaceAssembly } from './FaceAssemblyRenderer';
import type { ResolvedTileVisual } from './types';

const ROLE_SCALE: Record<TapTilePresentationRole, number> = {
  board: 1,
  flight: 1,
  tray: 0.92,
  'match-ghost': 1.08,
  'hud-preview': 0.86,
};

export function resolveTileVisual(
  project: TapTileProjectV2,
  archetypeId: string,
  themeVariantId: string,
  role: TapTilePresentationRole,
): ResolvedTileVisual {
  const archetype = project.visuals.archetypes[archetypeId];
  if (!archetype) throw new Error(`ARCHETYPE_NOT_FOUND: ${archetypeId}`);
  const theme = project.visuals.themes[themeVariantId];
  if (!theme) throw new Error(`THEME_NOT_FOUND: ${themeVariantId}`);
  const binding = theme.bindings[archetypeId];
  if (!binding) throw new Error(`THEME_BINDING_NOT_FOUND: ${themeVariantId}/${archetypeId}`);
  const faceAssembly = project.visuals.faceAssemblies[binding.faceAssemblyId];
  if (!faceAssembly) throw new Error(`FACE_ASSEMBLY_NOT_FOUND: ${binding.faceAssemblyId}`);
  const bodyStyle = project.visuals.bodyStyles[binding.bodyStyleId];
  if (!bodyStyle) throw new Error(`BODY_STYLE_NOT_FOUND: ${binding.bodyStyleId}`);
  const registry = new TapTileAssetRegistry(project.assets);
  const renderedFace = renderFaceAssembly(faceAssembly, registry);
  const bodyAsset = bodyStyle.bodyAssetId ? registry.resolve(bodyStyle.bodyAssetId) : undefined;
  const identityHash = stableHash({
    themeVariantId,
    archetypeId,
    material: project.authoring.material,
    faceAssembly,
    bodyStyle,
    assetVersions: [
      ...(bodyAsset ? [{ id: bodyAsset.entry.id, version: bodyAsset.entry.version, contentHash: bodyAsset.entry.contentHash }] : []),
      ...renderedFace.parts
        .filter((part) => part.source.kind === 'image')
        .map((part) => part.source.kind === 'image'
          ? { id: part.source.asset.entry.id, version: part.source.asset.entry.version, contentHash: part.source.asset.entry.contentHash }
          : null),
    ],
  }, 'visual');
  return {
    archetype,
    theme,
    material: project.authoring.material,
    role,
    faceAssembly,
    renderedFace,
    bodyStyle,
    ...(bodyAsset ? { bodyAsset } : {}),
    identityHash,
    roleScale: ROLE_SCALE[role],
  };
}

export function resolveTileVisualForMatchKey(
  project: TapTileProjectV2,
  matchKey: string,
  themeVariantId: string,
  role: TapTilePresentationRole,
): ResolvedTileVisual {
  const archetype = Object.values(project.visuals.archetypes).find((candidate) => candidate.matchKey === matchKey);
  if (!archetype) throw new Error(`MATCH_KEY_ARCHETYPE_NOT_FOUND: ${matchKey}`);
  return resolveTileVisual(project, archetype.id, themeVariantId, role);
}
