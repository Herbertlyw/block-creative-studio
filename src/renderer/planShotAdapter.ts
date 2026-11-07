import type { FixedCameraAssetMetadata, ResolvedRenderPlan } from '../headless/contracts';
import type { ShotExecution, StyleSpec } from '../domain/types';
import { FIXED_SHOT_PROFILE, type ShotProfileLike } from './shotProfile';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readSize(value: unknown): { width: number; height: number } | undefined {
  if (!isRecord(value)) return undefined;
  const width = value.width;
  const height = value.height;
  if (typeof width !== 'number' || typeof height !== 'number') return undefined;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  return { width, height };
}

function readRect(value: unknown): ShotExecution['boardScreenRect'] | undefined {
  if (!isRecord(value)) return undefined;
  const x = value.x;
  const y = value.y;
  const width = value.width;
  const height = value.height;
  if ([x, y, width, height].some((item) => typeof item !== 'number' || !Number.isFinite(item))) return undefined;
  if ((width as number) <= 0 || (height as number) <= 0) return undefined;
  return {
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
  };
}

function readZoom(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < 1 || value > 1.2) return undefined;
  return value;
}

export function cameraMetadataFromPlan(
  plan: ResolvedRenderPlan,
): Partial<FixedCameraAssetMetadata> {
  const metadata = plan.cameraProfile.manifest.metadata;
  return isRecord(metadata) ? metadata as Partial<FixedCameraAssetMetadata> : {};
}

export function layoutDesignResolutionFromPlan(
  plan: ResolvedRenderPlan,
): { width: number; height: number } | undefined {
  const metadata = plan.layoutProfile.manifest.metadata;
  return isRecord(metadata) ? readSize(metadata.designResolution) : undefined;
}

export function shotExecutionFromPlan(plan: ResolvedRenderPlan): ShotExecution {
  const cameraMeta = cameraMetadataFromPlan(plan);
  const cameraDesign = readSize(cameraMeta.designResolution);
  const layoutDesign = layoutDesignResolutionFromPlan(plan);
  const boardScreenRect = readRect(cameraMeta.boardScreenRect);
  const maximumScreenZoom = readZoom(cameraMeta.maximumScreenZoom);
  const designResolution = cameraDesign ?? layoutDesign ?? { ...FIXED_SHOT_PROFILE.designResolution };
  const compositionSource = layoutDesign ?? cameraDesign ?? FIXED_SHOT_PROFILE.designResolution;
  return {
    cameraProfileId: plan.cameraProfile.manifest.id,
    layoutProfileId: plan.layoutProfile.manifest.id,
    designResolution,
    ...(layoutDesign ? { layoutDesignResolution: layoutDesign } : {}),
    compositionAspect: compositionSource.width / compositionSource.height,
    boardScreenRect: boardScreenRect ?? { ...FIXED_SHOT_PROFILE.boardScreenRect },
    maximumScreenZoom: maximumScreenZoom ?? FIXED_SHOT_PROFILE.maximumScreenZoom,
    verticalFovDegrees: FIXED_SHOT_PROFILE.verticalFovDegrees,
    contentWidth: FIXED_SHOT_PROFILE.contentWidth,
    contentHeight: FIXED_SHOT_PROFILE.contentHeight,
    widthFill: FIXED_SHOT_PROFILE.widthFill,
    heightFill: FIXED_SHOT_PROFILE.heightFill,
    baseDistance: FIXED_SHOT_PROFILE.baseDistance,
    lookAt: FIXED_SHOT_PROFILE.lookAt,
    cameraOffset: { ...FIXED_SHOT_PROFILE.cameraOffset },
    poseSource: 'fallback-fixed-shot',
    fovSource: 'fallback-fixed-shot',
    cameraFieldsFromPlan: {
      designResolution: Boolean(cameraDesign),
      boardScreenRect: Boolean(boardScreenRect),
      maximumScreenZoom: Boolean(maximumScreenZoom),
    },
    layoutFieldsFromPlan: {
      designResolution: Boolean(layoutDesign),
    },
  };
}

export function attachShotExecutionToStyle(style: StyleSpec, plan: ResolvedRenderPlan): void {
  style.shotExecution = shotExecutionFromPlan(plan);
}

export function activeShotProfile(style?: Pick<StyleSpec, 'shotExecution'> | null): ShotProfileLike {
  return style?.shotExecution ?? FIXED_SHOT_PROFILE;
}

export function shotDrivesCameraPixels(
  plan: ResolvedRenderPlan,
  style: StyleSpec,
): boolean {
  const shot = style.shotExecution;
  if (!shot || style.renderer !== 'fixed-camera-cinematic') return false;
  if (shot.cameraProfileId !== plan.cameraProfile.manifest.id) return false;
  return shot.cameraFieldsFromPlan.designResolution
    && shot.cameraFieldsFromPlan.boardScreenRect
    && shot.cameraFieldsFromPlan.maximumScreenZoom;
}

export function shotDrivesLayoutPixels(
  plan: ResolvedRenderPlan,
  style: StyleSpec,
): boolean {
  const shot = style.shotExecution;
  if (!shot || style.renderer !== 'fixed-camera-cinematic') return false;
  if (shot.layoutProfileId !== plan.layoutProfile.manifest.id) return false;
  if (!shot.layoutFieldsFromPlan.designResolution || !shot.layoutDesignResolution) return false;
  const expected = shot.layoutDesignResolution.width / shot.layoutDesignResolution.height;
  return Math.abs(shot.compositionAspect - expected) < 1e-8;
}
