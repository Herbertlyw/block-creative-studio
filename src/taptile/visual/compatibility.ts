import { stableHash, type FaceAssembly, type FacePart, type TapTileProjectV2 } from '../project';
import { TapTileAssetRegistry } from './AssetRegistry';
import { renderFaceAssembly } from './FaceAssemblyRenderer';
import type { SkinCompatibilityIssue, SkinCompatibilityReport } from './types';

function partBounds(part: FacePart): { left: number; top: number; right: number; bottom: number } {
  return {
    left: part.transform.x - Math.abs(part.transform.scaleX) / 2,
    right: part.transform.x + Math.abs(part.transform.scaleX) / 2,
    top: part.transform.y - Math.abs(part.transform.scaleY) / 2,
    bottom: part.transform.y + Math.abs(part.transform.scaleY) / 2,
  };
}

function validateAssembly(
  project: TapTileProjectV2,
  themeId: string,
  archetypeId: string,
  assembly: FaceAssembly,
  issues: SkinCompatibilityIssue[],
): void {
  if (assembly.parts.length === 0) {
    issues.push({ code: 'FACE_ASSEMBLY_EMPTY', severity: 'error', message: '牌面组合没有任何部件。', themeId, archetypeId, faceAssemblyId: assembly.id });
    return;
  }
  if (assembly.mode === 'overlay-on-body' && assembly.bodyInteraction === 'replace-front-surface') {
    issues.push({ code: 'OVERLAY_REPLACES_BODY', severity: 'error', message: 'overlay-on-body 不应替换整个牌体正面。', themeId, archetypeId, faceAssemblyId: assembly.id });
  }
  if (assembly.mode === 'full-front' && assembly.bodyInteraction !== 'replace-front-surface') {
    issues.push({ code: 'FULL_FRONT_DOUBLE_BORDER', severity: 'warning', message: 'full-front 仍显示牌体，可能产生双边框。', themeId, archetypeId, faceAssemblyId: assembly.id });
  }
  if (assembly.mode === 'composed' && assembly.parts.length < 2 && !assembly.parts.some((part) => (part.repeat?.count ?? 1) > 1)) {
    issues.push({ code: 'COMPOSED_SINGLE_PART', severity: 'warning', message: 'composed 只有一个不可重复部件，建议改为 overlay。', themeId, archetypeId, faceAssemblyId: assembly.id });
  }
  for (const part of assembly.parts) {
    if (part.repeat && (!Number.isInteger(part.repeat.count) || part.repeat.count < 1)) {
      issues.push({ code: 'FACE_REPEAT_INVALID', severity: 'error', message: 'repeat.count 必须是正整数。', themeId, archetypeId, faceAssemblyId: assembly.id, partId: part.id });
    }
    if (part.repeat?.layout === 'custom' && (part.repeat.offsets?.length ?? 0) < part.repeat.count) {
      issues.push({ code: 'FACE_REPEAT_OFFSETS_MISSING', severity: 'error', message: 'custom repeat 缺少逐项 offsets。', themeId, archetypeId, faceAssemblyId: assembly.id, partId: part.id });
    }
    const bounds = partBounds(part);
    const safeInset = assembly.mode === 'overlay-on-body' ? 0.08 : 0;
    if (bounds.left < safeInset || bounds.top < safeInset || bounds.right > 1 - safeInset || bounds.bottom > 1 - safeInset) {
      issues.push({
        code: assembly.mode === 'overlay-on-body' ? 'OVERLAY_OUTSIDE_SAFE_AREA' : 'FACE_PART_CLIPPED',
        severity: 'warning',
        message: '牌面部件超出当前模式的建议可视边界。',
        themeId,
        archetypeId,
        faceAssemblyId: assembly.id,
        partId: part.id,
      });
    }
    if (part.source.kind === 'image') {
      const asset = project.assets.entries[part.source.assetId];
      if (!asset) {
        issues.push({ code: 'FACE_ASSET_MISSING', severity: 'error', message: `找不到牌面资产 ${part.source.assetId}。`, themeId, archetypeId, faceAssemblyId: assembly.id, partId: part.id });
      } else if (assembly.mode === 'overlay-on-body' && asset.hasAlpha !== true) {
        issues.push({ code: 'OVERLAY_ALPHA_REQUIRED', severity: asset.hasAlpha === false ? 'error' : 'warning', message: 'overlay 图片必须明确具有透明通道。', themeId, archetypeId, faceAssemblyId: assembly.id, partId: part.id });
      }
    }
  }
}

export function validateSkinPack(project: TapTileProjectV2, themeId: string): SkinCompatibilityReport {
  const issues: SkinCompatibilityIssue[] = [];
  const theme = project.visuals.themes[themeId];
  if (!theme) {
    return { valid: false, themeId, coveredArchetypeIds: [], issues: [{ code: 'THEME_MISSING', severity: 'error', message: `找不到主题 ${themeId}。`, themeId }] };
  }
  const registry = new TapTileAssetRegistry(project.assets);
  const coveredArchetypeIds: string[] = [];
  const visibleFaceOwners = new Map<string, { matchKey: string; displayName: string }>();
  for (const archetype of Object.values(project.visuals.archetypes).sort((left, right) => left.id.localeCompare(right.id))) {
    const binding = theme.bindings[archetype.id];
    if (!binding) {
      issues.push({ code: 'THEME_BINDING_MISSING', severity: 'error', message: `主题未覆盖 ${archetype.displayName}。`, themeId, archetypeId: archetype.id });
      continue;
    }
    const assembly = project.visuals.faceAssemblies[binding.faceAssemblyId];
    const bodyStyle = project.visuals.bodyStyles[binding.bodyStyleId];
    if (!assembly) issues.push({ code: 'FACE_ASSEMBLY_MISSING', severity: 'error', message: `找不到 ${binding.faceAssemblyId}。`, themeId, archetypeId: archetype.id, faceAssemblyId: binding.faceAssemblyId });
    if (!bodyStyle) issues.push({ code: 'BODY_STYLE_MISSING', severity: 'error', message: `找不到 ${binding.bodyStyleId}。`, themeId, archetypeId: archetype.id });
    if (!assembly || !bodyStyle) continue;
    if (bodyStyle.bodyAssetId && !registry.has(bodyStyle.bodyAssetId)) {
      issues.push({ code: 'BODY_ASSET_MISSING', severity: 'error', message: `找不到牌体资产 ${bodyStyle.bodyAssetId}。`, themeId, archetypeId: archetype.id });
    }
    validateAssembly(project, themeId, archetype.id, assembly, issues);
    try {
      renderFaceAssembly(assembly, registry);
      coveredArchetypeIds.push(archetype.id);
      const visibleFaceSignature = stableHash({
        mode: assembly.mode,
        bodyInteraction: assembly.bodyInteraction,
        parts: assembly.parts.map((part) => {
          if (part.source.kind === 'glyph') {
            return { source: part.source, transform: part.transform, repeat: part.repeat };
          }
          const asset = project.assets.entries[part.source.assetId];
          const assetIdentity = asset?.contentHash
            ?? (asset?.source.type === 'builtin' ? asset.source.uri : part.source.assetId);
          return {
            source: { kind: part.source.kind, assetIdentity },
            transform: part.transform,
            repeat: part.repeat,
          };
        }),
      }, 'visible-face');
      const previousOwner = visibleFaceOwners.get(visibleFaceSignature);
      if (previousOwner && previousOwner.matchKey !== archetype.matchKey) {
        issues.push({
          code: 'MATCH_VISUAL_DUPLICATE',
          severity: 'error',
          message: `${archetype.displayName} 与 ${previousOwner.displayName} 使用了相同可见牌面，但属于不同匹配组。`,
          themeId,
          archetypeId: archetype.id,
          faceAssemblyId: assembly.id,
        });
      } else {
        visibleFaceOwners.set(visibleFaceSignature, {
          matchKey: archetype.matchKey,
          displayName: archetype.displayName,
        });
      }
    } catch (error) {
      issues.push({ code: 'FACE_RESOLUTION_FAILED', severity: 'error', message: error instanceof Error ? error.message : String(error), themeId, archetypeId: archetype.id, faceAssemblyId: assembly.id });
    }
  }
  for (const layer of project.visuals.stageAssemblies[project.visuals.selectedStageAssemblyId] ?? []) {
    if (layer.assetId && !registry.has(layer.assetId)) {
      issues.push({ code: 'STAGE_ASSET_MISSING', severity: 'error', message: `找不到舞台资产 ${layer.assetId}。`, themeId });
    }
  }
  return { valid: !issues.some((issue) => issue.severity === 'error'), themeId, coveredArchetypeIds, issues };
}
