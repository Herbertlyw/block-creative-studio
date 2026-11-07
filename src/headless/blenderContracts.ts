import { BCS_CONTRACT_VERSION, type ContractIssue } from './contracts.js';

export const BCS_BLENDER_SCENE_EXCHANGE_CONTRACT = 'bcs.blender-scene-exchange' as const;
export const BCS_BLENDER_COMPILE_REPORT_CONTRACT = 'bcs.blender-compile-report' as const;

export type BlenderVector3 = [number, number, number];

export interface BlenderExchangeOutput {
  width: number;
  height: number;
  fps: number;
  frameStart: number;
  frameEnd: number;
  alphaMode: 'straight' | 'opaque';
}

export interface BlenderExchangeCamera {
  type: 'orthographic' | 'perspective';
  location: BlenderVector3;
  target: BlenderVector3;
  orthographicScale?: number;
  focalLengthMm?: number;
}

export interface BlenderExchangeMaterial {
  baseColor: string;
  roughness: number;
  metallic: number;
  emissionStrength?: number;
  emissionColor?: string;
}

export interface BlenderExchangeImageAsset {
  id: string;
  kind: 'image';
  source:
    | { type: 'builtin-uri'; uri: string }
    | { type: 'package-path'; path: string };
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  contentHash?: string;
}

export interface BlenderExchangeFaceLayer {
  id: string;
  source:
    | { kind: 'image'; assetId: string }
    | { kind: 'glyph'; value: string };
  transform: {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotationDeg: number;
    opacity: number;
  };
}

export interface BlenderExchangeEntity {
  id: string;
  role: 'tile' | 'board-part' | 'large-fragment' | 'hero-prop';
  primitive: 'rounded-box' | 'box' | 'sphere' | 'plane';
  position: BlenderVector3;
  rotationEulerDegrees: BlenderVector3;
  scale: BlenderVector3;
  dimensions: BlenderVector3;
  bevelRadius?: number;
  material: BlenderExchangeMaterial;
  face?: {
    label?: string;
    color?: string;
    layers?: BlenderExchangeFaceLayer[];
  };
}

export interface BlenderExchangeMatchEvent {
  id: string;
  type: 'match';
  frame: number;
  entityIds: string[];
  center: BlenderVector3;
  intensity: number;
  vfx?: BlenderExchangeMatchVfx;
}

export interface BlenderExchangeMatchVfx {
  style: 'burst' | 'shatter' | 'pulse';
  durationFrames: number;
  fragmentCount: number;
  fragmentScale: number;
  radialSpread: number;
  gravity: number;
  shockwave: boolean;
  glowStrength: number;
  palette: string[];
}

export interface BlenderExchangeTransformKeyframe {
  frame: number;
  position: BlenderVector3;
  rotationEulerDegrees: BlenderVector3;
  scale: BlenderVector3;
  visible: boolean;
}

export interface BlenderExchangeTransformTrack {
  entityId: string;
  interpolation: 'linear' | 'bezier' | 'constant';
  keyframes: BlenderExchangeTransformKeyframe[];
}

export interface BlenderSceneExchange {
  contract: typeof BCS_BLENDER_SCENE_EXCHANGE_CONTRACT;
  contractVersion: typeof BCS_CONTRACT_VERSION;
  id: string;
  seed: number;
  output: BlenderExchangeOutput;
  coordinates: {
    handedness: 'right';
    upAxis: 'Z';
    unit: 'meter';
    unitScale: 1;
  };
  camera: BlenderExchangeCamera;
  stage: {
    backgroundColor: string;
    groundColor: string;
  };
  assets: BlenderExchangeImageAsset[];
  entities: BlenderExchangeEntity[];
  tracks: BlenderExchangeTransformTrack[];
  events: BlenderExchangeMatchEvent[];
}

export interface BlenderCompileOutputArtifact {
  role: 'scene-exchange' | 'source-artifact' | 'normalized-blend' | 'scene-glb' | 'vfx-glb' | 'preview' | 'representative-frame';
  path: string;
  sha256: string;
  byteLength: number;
  frame?: number;
}

export interface BlenderCompileReport {
  contract: typeof BCS_BLENDER_COMPILE_REPORT_CONTRACT;
  contractVersion: typeof BCS_CONTRACT_VERSION;
  packageId: string;
  status: 'passed' | 'failed';
  source: {
    path: string;
    sha256: string;
  };
  blender: {
    version: string;
    engine: 'BLENDER_EEVEE' | 'CYCLES';
    executable?: string;
  };
  render: BlenderExchangeOutput;
  metrics: {
    objectCount: number;
    meshCount: number;
    materialCount: number;
    triangleCount: number;
    compileDurationMs: number;
    eventCount?: number;
    vfxObjectCount?: number;
    vfxTriangleCount?: number;
    vfxGlbByteLength?: number;
  };
  quality?: {
    structure: 'passed' | 'failed';
    visual: 'passed' | 'degraded' | 'failed';
    resolvedAssetCount: number;
    unresolvedAssetIds: string[];
    fallbackFaceEntityIds: string[];
  };
  outputs: BlenderCompileOutputArtifact[];
  warnings: string[];
  errors: string[];
}

function issue(
  code: string,
  message: string,
  path: string,
  severity: ContractIssue['severity'] = 'error',
): ContractIssue {
  return { code, message, path, severity, recoverable: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateVector3(value: unknown, path: string, issues: ContractIssue[]): void {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => !isFiniteNumber(entry))) {
    issues.push(issue('BLENDER_VECTOR_INVALID', `${path} must contain exactly three finite numbers.`, path));
  }
}

function validateHexColor(value: unknown, path: string, issues: ContractIssue[]): void {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    issues.push(issue('BLENDER_COLOR_INVALID', `${path} must be a six-digit hexadecimal color.`, path));
  }
}

function validatePositiveInteger(value: unknown, path: string, issues: ContractIssue[]): void {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    issues.push(issue('BLENDER_INTEGER_INVALID', `${path} must be a positive integer.`, path));
  }
}

function isSafePackagePath(value: string): boolean {
  return value.length > 0
    && !value.startsWith('/')
    && !value.startsWith('\\')
    && !/^[a-z]:/iu.test(value)
    && !value.split(/[\\/]+/u).includes('..');
}

function validateFaceTransform(value: unknown, path: string, issues: ContractIssue[]): void {
  if (!isRecord(value)) {
    issues.push(issue('BLENDER_FACE_TRANSFORM_INVALID', `${path} must be an object.`, path));
    return;
  }
  for (const key of ['x', 'y', 'scaleX', 'scaleY', 'rotationDeg', 'opacity'] as const) {
    if (!isFiniteNumber(value[key])) {
      issues.push(issue('BLENDER_FACE_TRANSFORM_INVALID', `${path}.${key} must be finite.`, `${path}.${key}`));
    }
  }
  if (isFiniteNumber(value.opacity) && (value.opacity < 0 || value.opacity > 1)) {
    issues.push(issue('BLENDER_FACE_OPACITY_INVALID', `${path}.opacity must be between 0 and 1.`, `${path}.opacity`));
  }
  for (const key of ['scaleX', 'scaleY'] as const) {
    if (isFiniteNumber(value[key]) && Math.abs(value[key]) <= 0.000001) {
      issues.push(issue('BLENDER_FACE_SCALE_INVALID', `${path}.${key} must not be zero.`, `${path}.${key}`));
    }
  }
}

function validateMatchVfx(value: unknown, path: string, issues: ContractIssue[]): void {
  if (!isRecord(value)) {
    issues.push(issue('BLENDER_MATCH_VFX_INVALID', `${path} must be an object.`, path));
    return;
  }
  if (!['burst', 'shatter', 'pulse'].includes(String(value.style))) {
    issues.push(issue('BLENDER_MATCH_VFX_STYLE_INVALID', `${path}.style is invalid.`, `${path}.style`));
  }
  const integerRanges = { durationFrames: [1, 120], fragmentCount: [0, 96] } as const;
  for (const [key, [minimum, maximum]] of Object.entries(integerRanges)) {
    const numeric = value[key];
    if (!Number.isInteger(numeric) || Number(numeric) < minimum || Number(numeric) > maximum) {
      issues.push(issue('BLENDER_MATCH_VFX_INTEGER_INVALID', `${path}.${key} must be an integer in ${minimum}..${maximum}.`, `${path}.${key}`));
    }
  }
  const numericRanges = {
    fragmentScale: [Number.EPSILON, 4],
    radialSpread: [0, 8],
    gravity: [0, 8],
    glowStrength: [0, 20],
  } as const;
  for (const [key, [minimum, maximum]] of Object.entries(numericRanges)) {
    const numeric = value[key];
    if (!isFiniteNumber(numeric) || numeric < minimum || numeric > maximum) {
      issues.push(issue('BLENDER_MATCH_VFX_NUMBER_INVALID', `${path}.${key} must be in ${minimum}..${maximum}.`, `${path}.${key}`));
    }
  }
  if (typeof value.shockwave !== 'boolean') {
    issues.push(issue('BLENDER_MATCH_VFX_SHOCKWAVE_INVALID', `${path}.shockwave must be boolean.`, `${path}.shockwave`));
  }
  if (!Array.isArray(value.palette) || value.palette.length < 1 || value.palette.length > 8) {
    issues.push(issue('BLENDER_MATCH_VFX_PALETTE_INVALID', `${path}.palette must contain 1..8 colors.`, `${path}.palette`));
  } else {
    value.palette.forEach((color, index) => validateHexColor(color, `${path}.palette[${index}]`, issues));
  }
}

export function validateBlenderSceneExchange(value: unknown): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!isRecord(value)) return [issue('BLENDER_EXCHANGE_INVALID', 'Scene exchange must be an object.', '$')];
  if (value.contract !== BCS_BLENDER_SCENE_EXCHANGE_CONTRACT) {
    issues.push(issue('BLENDER_CONTRACT_INVALID', `contract must be ${BCS_BLENDER_SCENE_EXCHANGE_CONTRACT}.`, 'contract'));
  }
  if (value.contractVersion !== BCS_CONTRACT_VERSION) {
    issues.push(issue('BLENDER_CONTRACT_VERSION_UNSUPPORTED', `contractVersion must be ${BCS_CONTRACT_VERSION}.`, 'contractVersion'));
  }
  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,127}$/i.test(value.id)) {
    issues.push(issue('BLENDER_PACKAGE_ID_INVALID', 'id must be a stable 3-128 character package identifier.', 'id'));
  }
  if (!Number.isInteger(value.seed)) issues.push(issue('BLENDER_SEED_INVALID', 'seed must be an integer.', 'seed'));

  if (!isRecord(value.output)) {
    issues.push(issue('BLENDER_OUTPUT_INVALID', 'output must be an object.', 'output'));
  } else {
    validatePositiveInteger(value.output.width, 'output.width', issues);
    validatePositiveInteger(value.output.height, 'output.height', issues);
    validatePositiveInteger(value.output.fps, 'output.fps', issues);
    validatePositiveInteger(value.output.frameStart, 'output.frameStart', issues);
    validatePositiveInteger(value.output.frameEnd, 'output.frameEnd', issues);
    if (isFiniteNumber(value.output.frameStart) && isFiniteNumber(value.output.frameEnd) && value.output.frameEnd < value.output.frameStart) {
      issues.push(issue('BLENDER_FRAME_RANGE_INVALID', 'output.frameEnd must not precede output.frameStart.', 'output.frameEnd'));
    }
    if (value.output.alphaMode !== 'straight' && value.output.alphaMode !== 'opaque') {
      issues.push(issue('BLENDER_ALPHA_MODE_INVALID', 'output.alphaMode must be straight or opaque.', 'output.alphaMode'));
    }
    if (value.output.width !== 1080 || value.output.height !== 1920 || value.output.fps !== 30) {
      issues.push(issue(
        'BLENDER_OUTPUT_PROFILE_NONSTANDARD',
        'TapTile production exchange should use 1080×1920 at 30fps.',
        'output',
        'warning',
      ));
    }
  }

  if (!isRecord(value.coordinates)) {
    issues.push(issue('BLENDER_COORDINATES_INVALID', 'coordinates must be an object.', 'coordinates'));
  } else if (
    value.coordinates.handedness !== 'right'
    || value.coordinates.upAxis !== 'Z'
    || value.coordinates.unit !== 'meter'
    || value.coordinates.unitScale !== 1
  ) {
    issues.push(issue(
      'BLENDER_COORDINATES_UNSUPPORTED',
      'The v1 bridge requires right-handed metric coordinates with Z-up and unitScale 1.',
      'coordinates',
    ));
  }

  if (!isRecord(value.camera)) {
    issues.push(issue('BLENDER_CAMERA_INVALID', 'camera must be an object.', 'camera'));
  } else {
    if (value.camera.type !== 'orthographic' && value.camera.type !== 'perspective') {
      issues.push(issue('BLENDER_CAMERA_TYPE_INVALID', 'camera.type must be orthographic or perspective.', 'camera.type'));
    }
    validateVector3(value.camera.location, 'camera.location', issues);
    validateVector3(value.camera.target, 'camera.target', issues);
    if (value.camera.type === 'orthographic' && (!isFiniteNumber(value.camera.orthographicScale) || value.camera.orthographicScale <= 0)) {
      issues.push(issue('BLENDER_CAMERA_SCALE_INVALID', 'Orthographic camera requires a positive orthographicScale.', 'camera.orthographicScale'));
    }
    if (value.camera.type === 'perspective' && (!isFiniteNumber(value.camera.focalLengthMm) || value.camera.focalLengthMm <= 0)) {
      issues.push(issue('BLENDER_CAMERA_FOCAL_INVALID', 'Perspective camera requires a positive focalLengthMm.', 'camera.focalLengthMm'));
    }
  }

  if (!isRecord(value.stage)) {
    issues.push(issue('BLENDER_STAGE_INVALID', 'stage must be an object.', 'stage'));
  } else {
    validateHexColor(value.stage.backgroundColor, 'stage.backgroundColor', issues);
    validateHexColor(value.stage.groundColor, 'stage.groundColor', issues);
  }

  const assetIds = new Set<string>();
  if (!Array.isArray(value.assets)) {
    issues.push(issue('BLENDER_ASSETS_INVALID', 'assets must be an array.', 'assets'));
  } else {
    for (const [index, raw] of value.assets.entries()) {
      const path = `assets[${index}]`;
      if (!isRecord(raw)) {
        issues.push(issue('BLENDER_ASSET_INVALID', `${path} must be an object.`, path));
        continue;
      }
      if (typeof raw.id !== 'string' || raw.id.length === 0) {
        issues.push(issue('BLENDER_ASSET_ID_INVALID', `${path}.id must be non-empty.`, `${path}.id`));
      } else if (assetIds.has(raw.id)) {
        issues.push(issue('BLENDER_ASSET_ID_DUPLICATE', `Duplicate asset id ${raw.id}.`, `${path}.id`));
      } else {
        assetIds.add(raw.id);
      }
      if (raw.kind !== 'image') issues.push(issue('BLENDER_ASSET_KIND_INVALID', `${path}.kind must be image.`, `${path}.kind`));
      if (!isRecord(raw.source)) {
        issues.push(issue('BLENDER_ASSET_SOURCE_INVALID', `${path}.source must be an object.`, `${path}.source`));
      } else if (raw.source.type === 'builtin-uri') {
        if (typeof raw.source.uri !== 'string' || !raw.source.uri.startsWith('/assets/') || raw.source.uri.includes('..')) {
          issues.push(issue('BLENDER_ASSET_URI_INVALID', `${path}.source.uri must stay under /assets/.`, `${path}.source.uri`));
        }
      } else if (raw.source.type === 'package-path') {
        if (typeof raw.source.path !== 'string' || !isSafePackagePath(raw.source.path)) {
          issues.push(issue('BLENDER_ASSET_PATH_INVALID', `${path}.source.path must be a safe relative path.`, `${path}.source.path`));
        }
      } else {
        issues.push(issue('BLENDER_ASSET_SOURCE_TYPE_INVALID', `${path}.source.type is unsupported.`, `${path}.source.type`));
      }
      for (const key of ['width', 'height'] as const) {
        if (raw[key] !== undefined && (!Number.isInteger(raw[key]) || Number(raw[key]) <= 0)) {
          issues.push(issue('BLENDER_ASSET_DIMENSION_INVALID', `${path}.${key} must be a positive integer.`, `${path}.${key}`));
        }
      }
      if (raw.hasAlpha !== undefined && typeof raw.hasAlpha !== 'boolean') {
        issues.push(issue('BLENDER_ASSET_ALPHA_INVALID', `${path}.hasAlpha must be boolean.`, `${path}.hasAlpha`));
      }
      if (raw.contentHash !== undefined && (typeof raw.contentHash !== 'string' || !/^[0-9a-f]{64}$/iu.test(raw.contentHash))) {
        issues.push(issue('BLENDER_ASSET_HASH_INVALID', `${path}.contentHash must be a SHA-256 digest.`, `${path}.contentHash`));
      }
    }
  }

  const entityIds = new Set<string>();
  if (!Array.isArray(value.entities) || value.entities.length === 0) {
    issues.push(issue('BLENDER_ENTITIES_EMPTY', 'entities must contain at least one entity.', 'entities'));
  } else {
    for (const [index, raw] of value.entities.entries()) {
      const path = `entities[${index}]`;
      if (!isRecord(raw)) {
        issues.push(issue('BLENDER_ENTITY_INVALID', `${path} must be an object.`, path));
        continue;
      }
      if (typeof raw.id !== 'string' || raw.id.length === 0) {
        issues.push(issue('BLENDER_ENTITY_ID_INVALID', `${path}.id must be a non-empty string.`, `${path}.id`));
      } else if (entityIds.has(raw.id)) {
        issues.push(issue('BLENDER_ENTITY_ID_DUPLICATE', `Duplicate entity id ${raw.id}.`, `${path}.id`));
      } else {
        entityIds.add(raw.id);
      }
      if (!['tile', 'board-part', 'large-fragment', 'hero-prop'].includes(String(raw.role))) {
        issues.push(issue('BLENDER_ENTITY_ROLE_INVALID', `${path}.role is unsupported.`, `${path}.role`));
      }
      if (!['rounded-box', 'box', 'sphere', 'plane'].includes(String(raw.primitive))) {
        issues.push(issue('BLENDER_PRIMITIVE_INVALID', `${path}.primitive is unsupported.`, `${path}.primitive`));
      }
      validateVector3(raw.position, `${path}.position`, issues);
      validateVector3(raw.rotationEulerDegrees, `${path}.rotationEulerDegrees`, issues);
      validateVector3(raw.scale, `${path}.scale`, issues);
      validateVector3(raw.dimensions, `${path}.dimensions`, issues);
      if (raw.bevelRadius !== undefined && (!isFiniteNumber(raw.bevelRadius) || raw.bevelRadius < 0)) {
        issues.push(issue('BLENDER_BEVEL_INVALID', `${path}.bevelRadius must be non-negative.`, `${path}.bevelRadius`));
      }
      if (!isRecord(raw.material)) {
        issues.push(issue('BLENDER_MATERIAL_INVALID', `${path}.material must be an object.`, `${path}.material`));
      } else {
        validateHexColor(raw.material.baseColor, `${path}.material.baseColor`, issues);
        for (const key of ['roughness', 'metallic'] as const) {
          const parameter = raw.material[key];
          if (!isFiniteNumber(parameter) || parameter < 0 || parameter > 1) {
            issues.push(issue('BLENDER_MATERIAL_RANGE_INVALID', `${path}.material.${key} must be between 0 and 1.`, `${path}.material.${key}`));
          }
        }
      }
      if (raw.face !== undefined) {
        const facePath = `${path}.face`;
        if (!isRecord(raw.face)) {
          issues.push(issue('BLENDER_FACE_INVALID', `${facePath} must be an object.`, facePath));
        } else {
          if (raw.face.label !== undefined && (typeof raw.face.label !== 'string' || raw.face.label.length > 32)) {
            issues.push(issue('BLENDER_FACE_LABEL_INVALID', `${facePath}.label must be at most 32 characters.`, `${facePath}.label`));
          }
          if (raw.face.color !== undefined) validateHexColor(raw.face.color, `${facePath}.color`, issues);
          if (raw.face.layers !== undefined) {
            if (!Array.isArray(raw.face.layers) || raw.face.layers.length > 16) {
              issues.push(issue('BLENDER_FACE_LAYERS_INVALID', `${facePath}.layers must contain at most 16 entries.`, `${facePath}.layers`));
            } else {
              const layerIds = new Set<string>();
              for (const [layerIndex, layer] of raw.face.layers.entries()) {
                const layerPath = `${facePath}.layers[${layerIndex}]`;
                if (!isRecord(layer)) {
                  issues.push(issue('BLENDER_FACE_LAYER_INVALID', `${layerPath} must be an object.`, layerPath));
                  continue;
                }
                if (typeof layer.id !== 'string' || layer.id.length === 0 || layerIds.has(layer.id)) {
                  issues.push(issue('BLENDER_FACE_LAYER_ID_INVALID', `${layerPath}.id must be unique and non-empty.`, `${layerPath}.id`));
                } else layerIds.add(layer.id);
                if (!isRecord(layer.source)) {
                  issues.push(issue('BLENDER_FACE_SOURCE_INVALID', `${layerPath}.source must be an object.`, `${layerPath}.source`));
                } else if (layer.source.kind === 'image') {
                  if (typeof layer.source.assetId !== 'string' || !assetIds.has(layer.source.assetId)) {
                    issues.push(issue('BLENDER_FACE_ASSET_MISSING', `${layerPath} references an unknown image asset.`, `${layerPath}.source.assetId`));
                  }
                } else if (layer.source.kind === 'glyph') {
                  if (typeof layer.source.value !== 'string' || layer.source.value.length === 0 || [...layer.source.value].length > 16) {
                    issues.push(issue('BLENDER_FACE_GLYPH_INVALID', `${layerPath}.source.value must contain 1-16 characters.`, `${layerPath}.source.value`));
                  }
                } else {
                  issues.push(issue('BLENDER_FACE_SOURCE_KIND_INVALID', `${layerPath}.source.kind is unsupported.`, `${layerPath}.source.kind`));
                }
                validateFaceTransform(layer.transform, `${layerPath}.transform`, issues);
              }
            }
          }
        }
      }
    }
  }

  const eventIds = new Set<string>();
  const trackedEntityIds = new Set<string>();
  if (!Array.isArray(value.tracks)) {
    issues.push(issue('BLENDER_TRACKS_INVALID', 'tracks must be an array.', 'tracks'));
  } else {
    for (const [index, raw] of value.tracks.entries()) {
      const path = `tracks[${index}]`;
      if (!isRecord(raw)) {
        issues.push(issue('BLENDER_TRACK_INVALID', `${path} must be an object.`, path));
        continue;
      }
      if (typeof raw.entityId !== 'string' || !entityIds.has(raw.entityId)) {
        issues.push(issue('BLENDER_TRACK_ENTITY_MISSING', `${path} references unknown entity ${String(raw.entityId)}.`, `${path}.entityId`));
      } else if (trackedEntityIds.has(raw.entityId)) {
        issues.push(issue('BLENDER_TRACK_ENTITY_DUPLICATE', `Entity ${raw.entityId} has more than one transform track.`, `${path}.entityId`));
      } else {
        trackedEntityIds.add(raw.entityId);
      }
      if (!['linear', 'bezier', 'constant'].includes(String(raw.interpolation))) {
        issues.push(issue('BLENDER_TRACK_INTERPOLATION_INVALID', `${path}.interpolation is unsupported.`, `${path}.interpolation`));
      }
      if (!Array.isArray(raw.keyframes) || raw.keyframes.length === 0) {
        issues.push(issue('BLENDER_TRACK_KEYFRAMES_EMPTY', `${path}.keyframes must be a non-empty array.`, `${path}.keyframes`));
        continue;
      }
      let priorFrame = -Infinity;
      for (const [keyframeIndex, keyframe] of raw.keyframes.entries()) {
        const keyframePath = `${path}.keyframes[${keyframeIndex}]`;
        if (!isRecord(keyframe)) {
          issues.push(issue('BLENDER_TRACK_KEYFRAME_INVALID', `${keyframePath} must be an object.`, keyframePath));
          continue;
        }
        const frameValue = keyframe.frame;
        if (!Number.isInteger(frameValue)) {
          issues.push(issue('BLENDER_TRACK_FRAME_INVALID', `${keyframePath}.frame must be an integer.`, `${keyframePath}.frame`));
        } else {
          const frameNumber = Number(frameValue);
          if (frameNumber <= priorFrame) {
            issues.push(issue('BLENDER_TRACK_FRAME_ORDER_INVALID', `${keyframePath}.frame must be strictly increasing.`, `${keyframePath}.frame`));
          }
          priorFrame = frameNumber;
          if (
            isRecord(value.output)
            && isFiniteNumber(value.output.frameStart)
            && isFiniteNumber(value.output.frameEnd)
            && (frameNumber < value.output.frameStart || frameNumber > value.output.frameEnd)
          ) issues.push(issue('BLENDER_TRACK_FRAME_OUT_OF_RANGE', `${keyframePath}.frame is outside the output range.`, `${keyframePath}.frame`));
        }
        validateVector3(keyframe.position, `${keyframePath}.position`, issues);
        validateVector3(keyframe.rotationEulerDegrees, `${keyframePath}.rotationEulerDegrees`, issues);
        validateVector3(keyframe.scale, `${keyframePath}.scale`, issues);
        if (typeof keyframe.visible !== 'boolean') {
          issues.push(issue('BLENDER_TRACK_VISIBILITY_INVALID', `${keyframePath}.visible must be boolean.`, `${keyframePath}.visible`));
        }
      }
    }
  }

  if (!Array.isArray(value.events)) {
    issues.push(issue('BLENDER_EVENTS_INVALID', 'events must be an array.', 'events'));
  } else {
    for (const [index, raw] of value.events.entries()) {
      const path = `events[${index}]`;
      if (!isRecord(raw)) {
        issues.push(issue('BLENDER_EVENT_INVALID', `${path} must be an object.`, path));
        continue;
      }
      if (typeof raw.id !== 'string' || raw.id.length === 0) {
        issues.push(issue('BLENDER_EVENT_ID_INVALID', `${path}.id must be a non-empty string.`, `${path}.id`));
      } else if (eventIds.has(raw.id)) {
        issues.push(issue('BLENDER_EVENT_ID_DUPLICATE', `Duplicate event id ${raw.id}.`, `${path}.id`));
      } else {
        eventIds.add(raw.id);
      }
      if (raw.type !== 'match') issues.push(issue('BLENDER_EVENT_TYPE_INVALID', `${path}.type must be match.`, `${path}.type`));
      if (!Number.isInteger(raw.frame)) issues.push(issue('BLENDER_EVENT_FRAME_INVALID', `${path}.frame must be an integer.`, `${path}.frame`));
      if (
        isRecord(value.output)
        && isFiniteNumber(raw.frame)
        && isFiniteNumber(value.output.frameStart)
        && isFiniteNumber(value.output.frameEnd)
        && (raw.frame < value.output.frameStart || raw.frame > value.output.frameEnd)
      ) issues.push(issue('BLENDER_EVENT_FRAME_OUT_OF_RANGE', `${path}.frame is outside the output frame range.`, `${path}.frame`));
      if (!Array.isArray(raw.entityIds) || raw.entityIds.length !== 3) {
        issues.push(issue('BLENDER_MATCH_CARDINALITY_INVALID', `${path}.entityIds must contain exactly three ids.`, `${path}.entityIds`));
      } else {
        for (const id of raw.entityIds) {
          if (typeof id !== 'string' || !entityIds.has(id)) {
            issues.push(issue('BLENDER_EVENT_ENTITY_MISSING', `${path} references unknown entity ${String(id)}.`, `${path}.entityIds`));
          }
        }
      }
      validateVector3(raw.center, `${path}.center`, issues);
      if (!isFiniteNumber(raw.intensity) || raw.intensity < 0 || raw.intensity > 2) {
        issues.push(issue('BLENDER_EVENT_INTENSITY_INVALID', `${path}.intensity must be between 0 and 2.`, `${path}.intensity`));
      }
      if (raw.vfx !== undefined) validateMatchVfx(raw.vfx, `${path}.vfx`, issues);
    }
  }
  return issues;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

export function validateBlenderCompileReport(value: unknown): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!isRecord(value)) return [issue('BLENDER_REPORT_INVALID', 'Compile report must be an object.', '$')];
  if (value.contract !== BCS_BLENDER_COMPILE_REPORT_CONTRACT) {
    issues.push(issue('BLENDER_REPORT_CONTRACT_INVALID', `contract must be ${BCS_BLENDER_COMPILE_REPORT_CONTRACT}.`, 'contract'));
  }
  if (value.contractVersion !== BCS_CONTRACT_VERSION) {
    issues.push(issue('BLENDER_REPORT_VERSION_UNSUPPORTED', `contractVersion must be ${BCS_CONTRACT_VERSION}.`, 'contractVersion'));
  }
  if (typeof value.packageId !== 'string' || value.packageId.length === 0) {
    issues.push(issue('BLENDER_REPORT_PACKAGE_INVALID', 'packageId must be non-empty.', 'packageId'));
  }
  if (value.status !== 'passed' && value.status !== 'failed') {
    issues.push(issue('BLENDER_REPORT_STATUS_INVALID', 'status must be passed or failed.', 'status'));
  }
  if (!isRecord(value.source) || typeof value.source.path !== 'string' || !isSha256(value.source.sha256)) {
    issues.push(issue('BLENDER_REPORT_SOURCE_INVALID', 'source must contain an absolute path and SHA-256 digest.', 'source'));
  }
  if (!isRecord(value.blender) || typeof value.blender.version !== 'string' || !['BLENDER_EEVEE', 'CYCLES'].includes(String(value.blender.engine))) {
    issues.push(issue('BLENDER_REPORT_RUNTIME_INVALID', 'blender must declare a version and supported engine.', 'blender'));
  }
  if (!isRecord(value.render)) {
    issues.push(issue('BLENDER_REPORT_RENDER_INVALID', 'render settings are missing.', 'render'));
  }
  if (!isRecord(value.metrics)) {
    issues.push(issue('BLENDER_REPORT_METRICS_INVALID', 'metrics are missing.', 'metrics'));
  } else {
    for (const key of ['objectCount', 'meshCount', 'materialCount', 'triangleCount', 'compileDurationMs']) {
      if (!isFiniteNumber(value.metrics[key]) || value.metrics[key] < 0) {
        issues.push(issue('BLENDER_REPORT_METRIC_INVALID', `metrics.${key} must be non-negative.`, `metrics.${key}`));
      }
    }
    for (const key of ['eventCount', 'vfxObjectCount', 'vfxTriangleCount', 'vfxGlbByteLength']) {
      if (value.metrics[key] !== undefined && (!Number.isInteger(value.metrics[key]) || Number(value.metrics[key]) < 0)) {
        issues.push(issue('BLENDER_REPORT_VFX_METRIC_INVALID', `metrics.${key} must be a non-negative integer.`, `metrics.${key}`));
      }
    }
  }
  if (value.quality !== undefined) {
    if (!isRecord(value.quality)) {
      issues.push(issue('BLENDER_REPORT_QUALITY_INVALID', 'quality must be an object.', 'quality'));
    } else {
      if (!['passed', 'failed'].includes(String(value.quality.structure))) {
        issues.push(issue('BLENDER_REPORT_STRUCTURE_STATUS_INVALID', 'quality.structure is invalid.', 'quality.structure'));
      }
      if (!['passed', 'degraded', 'failed'].includes(String(value.quality.visual))) {
        issues.push(issue('BLENDER_REPORT_VISUAL_STATUS_INVALID', 'quality.visual is invalid.', 'quality.visual'));
      }
      if (!Number.isInteger(value.quality.resolvedAssetCount) || Number(value.quality.resolvedAssetCount) < 0) {
        issues.push(issue('BLENDER_REPORT_ASSET_COUNT_INVALID', 'quality.resolvedAssetCount must be a non-negative integer.', 'quality.resolvedAssetCount'));
      }
      for (const key of ['unresolvedAssetIds', 'fallbackFaceEntityIds'] as const) {
        const entries = value.quality[key];
        if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string')) {
          issues.push(issue('BLENDER_REPORT_QUALITY_LIST_INVALID', `quality.${key} must be a string array.`, `quality.${key}`));
        }
      }
      if (value.status === 'passed' && value.quality.structure !== 'passed') {
        issues.push(issue('BLENDER_REPORT_STRUCTURE_STATUS_MISMATCH', 'A passed report requires passed structural quality.', 'quality.structure'));
      }
      if (value.quality.visual === 'degraded') {
        issues.push(issue(
          'BLENDER_REPORT_VISUAL_DEGRADED',
          'Blender compiled the scene structure, but one or more faces used fallback visuals.',
          'quality.visual',
          'warning',
        ));
      }
    }
  } else if (value.status === 'passed') {
    issues.push(issue(
      'BLENDER_REPORT_QUALITY_MISSING',
      'Legacy report has no independent structural/visual quality status.',
      'quality',
      'warning',
    ));
  }
  if (!Array.isArray(value.outputs) || value.outputs.length < 5) {
    issues.push(issue('BLENDER_REPORT_OUTPUTS_INCOMPLETE', 'At least exchange, source, blend, GLB and preview artifacts are required.', 'outputs'));
  } else {
    const requiredRoles = new Set(['scene-exchange', 'source-artifact', 'normalized-blend', 'scene-glb', 'preview']);
    for (const [index, raw] of value.outputs.entries()) {
      const path = `outputs[${index}]`;
      if (!isRecord(raw) || typeof raw.path !== 'string' || !isSha256(raw.sha256) || !isFiniteNumber(raw.byteLength) || raw.byteLength <= 0) {
        issues.push(issue('BLENDER_REPORT_OUTPUT_INVALID', `${path} must contain role, path, SHA-256 and byteLength.`, path));
        continue;
      }
      requiredRoles.delete(String(raw.role));
    }
    for (const role of requiredRoles) {
      issues.push(issue('BLENDER_REPORT_OUTPUT_MISSING', `Required output role ${role} is missing.`, 'outputs'));
    }
  }
  if (!Array.isArray(value.warnings)) issues.push(issue('BLENDER_REPORT_WARNINGS_INVALID', 'warnings must be an array.', 'warnings'));
  if (!Array.isArray(value.errors)) issues.push(issue('BLENDER_REPORT_ERRORS_INVALID', 'errors must be an array.', 'errors'));
  if (value.status === 'passed' && Array.isArray(value.errors) && value.errors.length > 0) {
    issues.push(issue('BLENDER_REPORT_PASSED_WITH_ERRORS', 'A passed report cannot contain errors.', 'errors'));
  }
  return issues;
}

export function isBlenderSceneExchange(value: unknown): value is BlenderSceneExchange {
  return validateBlenderSceneExchange(value).every((candidate) => candidate.severity !== 'error');
}

export function isBlenderCompileReport(value: unknown): value is BlenderCompileReport {
  return validateBlenderCompileReport(value).every((candidate) => candidate.severity !== 'error');
}
