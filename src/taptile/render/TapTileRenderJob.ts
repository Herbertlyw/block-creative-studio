import { validateFrameRenderJob, type FrameRenderJob } from '../../exporter/fixedFrameExporter';
import type { CompiledTapTileTake, TapTilePresentationFrame } from '../director';
import { evaluateTapTileFrame } from '../director';
import { stableHash, type CompiledTapTileLevel, type TapTileProjectV2 } from '../project';
import { resolveTileVisual, validateSkinPack } from '../visual';
import { TapTileAssetCache, collectTapTileDrawableAssetIds, type TapTileAssetCacheLoaders } from './AssetCache';
import { renderTapTilePresentationFrame } from './CanvasRenderer';

export interface TapTileRenderIdentity {
  projectHash: string;
  levelHash: string;
  takeHash: string;
  finalStateHash: string;
  skinHash: string;
  directorHash: string;
  assetVersionHash: string;
}

export interface TapTileRenderJob extends FrameRenderJob<TapTilePresentationFrame> {
  readonly project: TapTileProjectV2;
  readonly level: CompiledTapTileLevel;
  readonly compiledTake: CompiledTapTileTake;
  readonly assets: TapTileAssetCache;
  readonly requiredAssetIds: string[];
  readonly identity: TapTileRenderIdentity;
}

export interface TapTileRenderPreflightIssue {
  code: string;
  message: string;
}

export interface TapTileRenderPreflightResult {
  valid: boolean;
  issues: TapTileRenderPreflightIssue[];
  identity: TapTileRenderIdentity;
  evaluatedFrames: number;
  assetsLoaded: number;
}

function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function createTapTileRenderJob(
  project: TapTileProjectV2,
  level: CompiledTapTileLevel,
  compiledTake: CompiledTapTileTake,
  loaders: TapTileAssetCacheLoaders = {},
): TapTileRenderJob {
  const projectSnapshot = deepFreeze(structuredClone(project));
  const levelSnapshot = deepFreeze(structuredClone(level));
  const takeSnapshot = deepFreeze(structuredClone(compiledTake));
  const assets = new TapTileAssetCache(projectSnapshot, loaders);
  const requiredAssetIds = collectTapTileDrawableAssetIds(projectSnapshot);
  const themeId = projectSnapshot.visuals.selectedThemeId;
  const visualIdentities = Object.keys(projectSnapshot.visuals.archetypes).sort().map((archetypeId) =>
    resolveTileVisual(projectSnapshot, archetypeId, themeId, 'board').identityHash);
  const identity: TapTileRenderIdentity = Object.freeze({
    projectHash: stableHash(projectSnapshot, 'project'),
    levelHash: levelSnapshot.levelHash,
    takeHash: stableHash(takeSnapshot.sourceTake, 'take'),
    finalStateHash: takeSnapshot.finalStateHash,
    skinHash: stableHash({ themeId, visualIdentities }, 'skin'),
    directorHash: stableHash({ id: takeSnapshot.id, profile: takeSnapshot.profile, actions: takeSnapshot.actions.map((action) => action.timing) }, 'director'),
    assetVersionHash: assets.versionHash,
  });
  let prepared = false;
  return {
    width: projectSnapshot.stage.exportWidth,
    height: projectSnapshot.stage.exportHeight,
    fps: takeSnapshot.fps,
    totalFrames: takeSnapshot.totalFrames,
    project: projectSnapshot,
    level: levelSnapshot,
    compiledTake: takeSnapshot,
    assets,
    requiredAssetIds,
    identity,
    evaluate: (frameIndex) => evaluateTapTileFrame(takeSnapshot, frameIndex),
    prepare: async (canvas, options) => {
      const pixelScale = Math.max(1, Math.min(2, options?.pixelScale ?? 1));
      canvas.width = Math.round(projectSnapshot.stage.exportWidth * pixelScale);
      canvas.height = Math.round(projectSnapshot.stage.exportHeight * pixelScale);
      if (!prepared) {
        await assets.preload(requiredAssetIds);
        prepared = true;
      }
    },
    render: (frame, canvas, options) => {
      renderTapTilePresentationFrame(canvas, frame, { project: projectSnapshot, level: levelSnapshot, assets }, options);
    },
    dispose: () => assets.dispose(),
  };
}

export async function preflightTapTileRenderJob(job: TapTileRenderJob): Promise<TapTileRenderPreflightResult> {
  const issues: TapTileRenderPreflightIssue[] = [];
  const validation = validateFrameRenderJob(job, true);
  for (const message of validation.errors) issues.push({ code: 'FRAME_JOB_INVALID', message });
  if (job.width !== 1080 || job.height !== 1920 || job.fps !== 30) {
    issues.push({ code: 'OUTPUT_PROFILE_INVALID', message: `TapTile 正式输出必须为 1080×1920、30fps；当前 ${job.width}×${job.height}、${job.fps}fps。` });
  }
  if (job.compiledTake.levelHash !== job.level.levelHash) issues.push({ code: 'LEVEL_HASH_MISMATCH', message: '导演时间线与关卡 levelHash 不一致。' });
  if (job.compiledTake.sourceTake.finalStateHash !== job.compiledTake.finalStateHash) issues.push({ code: 'FINAL_STATE_HASH_MISMATCH', message: '冻结 Take 的 finalStateHash 不一致。' });
  const skin = validateSkinPack(job.project, job.project.visuals.selectedThemeId);
  for (const issue of skin.issues.filter((item) => item.severity === 'error')) issues.push({ code: issue.code, message: issue.message });
  for (const assetId of job.requiredAssetIds) {
    const entry = job.project.assets.entries[assetId];
    if (!entry) issues.push({ code: 'ASSET_MISSING', message: `找不到导出资产 ${assetId}。` });
    else if (entry.kind === 'sequence') issues.push({ code: 'SEQUENCE_FRAMES_UNVERIFIED', message: `序列 ${assetId} 未提供可验证的逐帧清单。` });
  }
  if (issues.length === 0) {
    try {
      const canvas = document.createElement('canvas');
      await job.prepare?.(canvas);
    } catch (error) {
      issues.push({ code: 'ASSET_PRELOAD_FAILED', message: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    valid: issues.length === 0,
    issues,
    identity: job.identity,
    evaluatedFrames: validation.valid ? job.totalFrames : 0,
    assetsLoaded: job.requiredAssetIds.filter((id) => job.assets.has(id)).length,
  };
}
