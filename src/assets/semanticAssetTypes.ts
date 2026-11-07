/**
 * Renderer-independent contracts for the reference-first asset lineage.
 *
 * These types deliberately model semantic roles rather than file formats.
 * A tile body may be a Canvas recipe in the reference renderer, true geometry
 * in the fixed-camera cinematic renderer, and a baked sprite in another
 * backend without changing the gameplay event that activates it.
 */

export type SemanticAssetKind =
  | 'visual-asset'
  | 'vector'
  | 'typography'
  | 'render-recipe'
  | 'motion-recipe'
  | 'particle-recipe'
  | 'rule-binding'
  | 'color-token'
  | 'geometry-asset'
  | 'audio-asset';

export type EvidenceStatus = 'observed' | 'inferred' | 'unresolved';
export type EngineRequirement = 'core-required' | 'optional';
export type TriggerRequirement = 'required' | 'optional' | 'not-applicable';
export type ReferenceRequirement = 'required' | 'optional' | 'capture-only';

export type SpatialRepresentation =
  | 'screen-2d'
  | 'vector'
  | 'bitmap'
  | 'procedural-2d'
  | 'procedural-screen-vfx'
  | 'camera-facing-2d'
  | 'layered-2.5d-sprite'
  | 'normal-mapped-sprite'
  | 'camera-profile-dependent-layout'
  | 'shallow-3d'
  | 'full-3d'
  | 'baked-view-sprite'
  | 'baked-transform-3d'
  | 'motion-recipe'
  | 'nonvisual-rule'
  | 'not-applicable'
  | 'optional-full-3d';

export type ViewDependency =
  | 'none'
  | 'camera-profile-dependent'
  | 'lighting-profile-dependent'
  | 'fully-baked';

export type AssetProvider = 'builtin' | 'project' | 'external' | 'dcc';
export type SemanticReplaceability =
  | 'independent'
  | 'rule-preserving'
  | 'rule-bound'
  | 'director-controlled';

export interface SemanticRequirementPolicy {
  engine: EngineRequirement;
  whenTriggered: TriggerRequirement;
  referenceProfile: ReferenceRequirement;
}

export interface SemanticRendererRepresentations {
  reference2d: SpatialRepresentation;
  fixedCameraCinematic: SpatialRepresentation;
  full3dSandbox: SpatialRepresentation;
}

export interface SemanticViewDependencies {
  reference2d: ViewDependency;
  fixedCameraCinematic: ViewDependency;
}

export interface SemanticAssetAtom {
  id: string;
  label: string;
  category: string;
  kind: SemanticAssetKind;
  status: EvidenceStatus;
  requirement: SemanticRequirementPolicy;
  trigger: string;
  allowsNone: boolean;
  replaceability: SemanticReplaceability;
  spatialRepresentations: SemanticRendererRepresentations;
  viewDependency: SemanticViewDependencies;
  evidenceSelectors: string[];
  dependencies: string[];
  implementationStatus: 'implemented' | 'partial' | 'not-implemented' | 'prototype-only';
  notes?: string;
}

/** A concrete asset/recipe selected for one semantic atom. */
export interface SemanticAssetSlotRef {
  atomId: string;
  provider: AssetProvider;
  assetId: string;
  version: string;
  representation: SpatialRepresentation;
  uri?: string;
  parameters?: Record<string, string | number | boolean>;
}

export interface DesignResolution {
  width: number;
  height: number;
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraPose {
  position: readonly [number, number, number];
  rotationEulerRadians: readonly [number, number, number];
}

export type FixedCameraProjection =
  | {
      mode: 'perspective';
      focalLengthMm: number;
      sensorWidthMm: number;
      near: number;
      far: number;
    }
  | {
      mode: 'orthographic';
      verticalWorldSize: number;
      near: number;
      far: number;
    }
  | {
      /** Used before Golden Scene calibration chooses a physical projection. */
      mode: 'calibration-pending';
    };

export interface FixedCameraMotionPolicy {
  transformAnimation: false;
  orbit: false;
  lensAnimation: false;
  screenShake: boolean;
  screenTranslate: boolean;
  screenZoom: boolean;
  maximumScreenZoom: number;
  maximumScreenRotationDegrees: number;
}

/**
 * A first-class contract shared by true-3D, shallow-3D and baked-view assets.
 * The camera itself is locked; optional feedback is applied after projection as
 * a bounded screen-space transform.
 */
export interface FixedCameraProfile {
  id: string;
  designResolution: DesignResolution;
  boardScreenRect: ScreenRect;
  pose: CameraPose;
  projection: FixedCameraProjection;
  motionPolicy: FixedCameraMotionPolicy;
}

export interface NormalizedScreenPoint {
  x: number;
  y: number;
}

export function designPixelToNormalizedScreen(
  point: { x: number; y: number },
  resolution: DesignResolution,
): NormalizedScreenPoint {
  if (resolution.width <= 0 || resolution.height <= 0) {
    throw new Error('Design resolution must be positive.');
  }
  return {
    x: point.x / resolution.width,
    y: point.y / resolution.height,
  };
}

export function validateFixedCameraProfile(profile: FixedCameraProfile): string[] {
  const errors: string[] = [];
  const { designResolution, boardScreenRect, motionPolicy, projection } = profile;

  if (!profile.id.trim()) errors.push('Camera profile id is required.');
  if (designResolution.width <= 0 || designResolution.height <= 0) {
    errors.push('Design resolution must be positive.');
  }
  if (boardScreenRect.width <= 0 || boardScreenRect.height <= 0) {
    errors.push('Board screen rect must be positive.');
  }
  if (
    boardScreenRect.x < 0
    || boardScreenRect.y < 0
    || boardScreenRect.x + boardScreenRect.width > designResolution.width
    || boardScreenRect.y + boardScreenRect.height > designResolution.height
  ) {
    errors.push('Board screen rect must remain inside the design resolution.');
  }
  if (motionPolicy.maximumScreenZoom < 1 || motionPolicy.maximumScreenZoom > 1.1) {
    errors.push('Fixed-camera screen zoom must remain within the bounded cinematic range.');
  }
  if (Math.abs(motionPolicy.maximumScreenRotationDegrees) > 3) {
    errors.push('Fixed-camera screen rotation must remain within ±3 degrees.');
  }
  if (projection.mode !== 'calibration-pending') {
    if (projection.near <= 0 || projection.far <= projection.near) {
      errors.push('Camera clipping planes are invalid.');
    }
    if (projection.mode === 'perspective') {
      if (projection.focalLengthMm <= 0 || projection.sensorWidthMm <= 0) {
        errors.push('Perspective lens values must be positive.');
      }
    } else if (projection.verticalWorldSize <= 0) {
      errors.push('Orthographic vertical world size must be positive.');
    }
  }
  return errors;
}
