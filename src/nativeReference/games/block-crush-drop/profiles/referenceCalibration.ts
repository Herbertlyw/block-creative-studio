import {
  NATIVE_INERTIAL_CALIBRATION_SCHEMA,
  validateNativeInertialCalibration,
} from './nativeInertialCalibration';
import type { DropFragmentPhysics } from './fragmentPhysics';
import type { BallisticPrefractureProfile } from './ballisticPrefracturePartition';
import type { DropLayeredCurve } from './layeredCurve';
import {
  parsePartitionedSolidProfile,
  PARTITIONED_SOLID_PROFILE_SCHEMA,
  type PartitionedSolidProfile,
} from '../../../rendering/partitionedSolid';
import type { PyramidQuarterPerspectiveCamera } from '../../../rendering/pyramidQuarterFragment';
import type { BlockCrushDropObservedFragmentMotionProfile } from '../presentation/presentationAdapter';
import {
  DROP_OBSERVED_FRAGMENT_MAX_KEYS_PER_CALIBRATION,
  DROP_OBSERVED_FRAGMENT_MOTION_V2_SCHEMA,
  isDropObservedFragmentMotionV2,
  parseDropObservedFragmentMotionV2,
  type DropObservedFragmentMotionV2,
} from './observedFragmentMotion';
import {
  DROP_IMPACT_BEAM_CUES_SCHEMA,
  parseDropImpactBeamCues,
  type DropImpactBeamCue,
} from './impactBeam';
import {
  DROP_LANDING_SURFACE_FLASH_CUES_SCHEMA,
  parseDropLandingSurfaceFlashCues,
  type DropLandingSurfaceFlashCue,
} from './landingSurfaceFlash';
import {
  DROP_ENCOURAGEMENT_GLYPH_CUES_SCHEMA,
  parseDropEncouragementGlyphCues,
  type DropEncouragementGlyphCue,
} from './encouragementGlyphCues';

export const DROP_UI_ATLAS_SLOTS = [
  'ui.atlas',
  'ui.atlas.1',
  'ui.atlas.2',
  'ui.atlas.3',
  'ui.atlas.4',
  'ui.atlas.5',
  'ui.atlas.6',
] as const;
export type DropUiAtlasSlot = (typeof DROP_UI_ATLAS_SLOTS)[number];

/** Optional controls consumed by rounded-cube and fractured-block fragments. */
export interface DropRoundedCubeControls {
  /** Radians at release, default -.32; an explicit value also aligns the waiting slice. */
  fragmentCubePitchStart?: number;
  /** Default .9 radians per scaled rotation-age unit; fragmentCubeRotationAgeScale still applies. */
  fragmentCubePitchRate?: number;
  /** Directional diffuse weight, default .65. */
  fragmentDiffuse?: number;
  /** Nonzero light vector, default {x:-.2,y:-1,z:.35}. */
  fragmentLightDirection?: { x: number; y: number; z: number };
  /** Smooth random-axis rotation onset in genuine release seconds; default 0 is immediate. */
  fragmentRotationSpreadRampSeconds?: number;
  /** Rounded edge radius in cube-size units, default .065. */
  fragmentCubeCornerRadius?: number;
  /** Object-front mother UV across the rounded cap; omission preserves flat-patch. */
  fragmentCubeFrontUvMapping?: 'flat-patch' | 'mother-plane';
  /** Optional directional specular highlight; omission preserves the old helper. */
  fragmentSpecularStrength?: number;
  fragmentSpecularPower?: number;
  /** Opt-in rounded-cube cast shadow, in cube-size units; multiplied by clear.shadow. */
  fragmentCastShadow?: {
    offsetX: number;
    offsetY: number;
    blur: number;
    opacity: number;
    color?: string;
  };
  /** Optional rounded-cube ambient clamp floor; omission retains the legacy .55 floor. */
  fragmentAmbientFloor?: number;
  /** Object-space cut/outer face albedos, rounded-cube only; omitted preserves legacy material. */
  fragmentFaceColors?: Partial<
    Record<'front' | 'back' | 'left' | 'right' | 'top' | 'bottom', string>
  >;
  /** Real mother-depth partition, opt-in fractured-volume geometry only. */
  fragmentDepthLayers?: 1 | 2;
  /** Opt-in non-grid eight-cell partition; center-three requires volume/n2/depth2. */
  fragmentVolumeSeedPattern?: 'grid' | 'center-three';
  /** Explicit convex four-region mother partition, observed V2 only. */
  fragmentPartitionProfile?: PartitionedSolidProfile;
  /** Explicit stage-pixel camera hypothesis; V2 pyramid, or opaque mother-plane rounded cube. */
  fragmentPerspectiveCamera?: PyramidQuarterPerspectiveCamera;
  /** Explicit opaque shared depth buffer; omission keeps the Canvas painter. */
  fragmentDepthRenderer?: 'webgl-opaque';
}

/** Numerical reference measurements. No source frames or video layers are accepted. */
export interface DropReferenceCalibration {
  /** Fixed screen-space landing light, bound to a real native clear wave. */
  impactBeamCues?: DropImpactBeamCue[];
  landingSurfaceFlashCues?: DropLandingSurfaceFlashCue[];
  /** Discrete independent glyph planes attached to native clear origins. */
  encouragementGlyphCues?: DropEncouragementGlyphCue[];
  /** Colors for a bound horizontal strip of reusable square cell-face images. */
  tilePaletteColors?: string[];
  /** Rows of reusable face-lighting variants, interpolated by screen height. */
  tilePaletteLighting?: { rows: number; top: number; bottom: number };
  /** Optional extruded bottom/right sides for bound palette faces, in cell units. */
  paletteDepth?: number;
  airbornePaletteDepth?: number;
  /** Optional lit extrusion color for translucent cell faces. */
  paletteDepthColor?: string;
  sceneSaturationKeys?: Array<{ seconds: number; value: number }>;
  /** Signed visual rise correction; full-Take canonical frames, never semantic rows. */
  fieldRiseOffsetKeys?: Array<{ canonicalFrame: number; offsetCells: number }>;
  /** Source pixels excluded from each atlas face to prevent neighbouring-tile bleed. */
  tilePaletteCropPixels?: { top: number; right: number; bottom: number; left: number };
  /** Numeric presentation keyframes; gameplay state is unaffected. */
  boardColorKeys?: Array<{ seconds: number; color: string }>;
  /** Step changes on native cell identities; ordered independently for each id. */
  cellColorKeys?: Array<{ id: string; seconds: number; color: string }>;
  /** Procedural screen-edge warning, independent of gameplay and audio clocks. */
  screenVignette?: {
    color: string;
    inset: number;
    samples: Array<{ seconds: number; opacity: number }>;
  };
  counterTracks?: Array<{
    textColorKeys?: Array<{ seconds: number; color: string }>;
    format?: 'integer' | 'centiseconds' | 'seconds-sixtieths';
    font?: 'sans-serif' | 'serif';
    align?: 'left' | 'center' | 'right';
    id: string;
    x: number;
    y: number;
    iconSize: number;
    fontSize: number;
    color: string;
    samples: Array<{ seconds: number; value: number }>;
  }>;
  /** Bounded reusable UI sprites; never a gameplay/frame layer. */
  spriteCues?: Array<{
    atlasSlot?: DropUiAtlasSlot;
    layer?: 'background' | 'overlay';
    preserveColor?: boolean;
    animation?: { frames: number; columns: number; frameSeconds: number; loop: boolean };
    clipToBoard?: boolean;
    id: string;
    startSeconds: number;
    endSeconds: number;
    x: number;
    y: number;
    width: number;
    height: number;
    sourceX: number;
    sourceY: number;
    sourceWidth: number;
    sourceHeight: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }>;
  /** Decorative pre-game cells shattered by an intro tool; not runtime colliders. */
  introCellCues?: Array<{
    id: string;
    x: number;
    y: number;
    color: string;
    startSeconds: number;
    endSeconds: number;
    shatterSeconds: number;
  }>;
  /** Source-measured fragment centres, attached to one real native clear wave. */
  observedFragmentMotionCues?: Array<{
    actionIndex: number;
    cycleIndex: number;
    motion: BlockCrushDropObservedFragmentMotionProfile | DropObservedFragmentMotionV2;
  }>;
  version: 1;
  /** Blend airborne and column faces after contact, in seconds (independent of FPS). */
  landingColorSeconds?: number;
  fallTrail?: {
    color: string;
    opacity: number;
    lengthPixels: number;
    minSpeedPixelsPerSecond: number;
  };
  /** World surfaces keep face lighting upright inside the unchanged affine cell footprint. */
  pieceTracks?: Array<{
    actionIndex: number;
    pieceId?: string;
    uncommitted?: boolean;
    previewOnly?: boolean;
    surfaceOrientation?: 'piece' | 'world';
    samples: Array<{
      seconds: number;
      x: number;
      y: number;
      angle: number;
      scaleX?: number;
      scaleY?: number;
    }>;
  }>;
  /** Opt-in track ownership outside its visible window; native world cells remain visible. */
  respectPieceTrackWindows?: boolean;
  board: {
    x: number;
    y: number;
    cell: number;
    verticalScale?: number;
    verticalLines?: boolean;
    height?: number;
    gridY?: number;
    lineWidth?: number;
    background: string;
    line: string;
    horizontalLines: boolean;
  };
  guidance?: Array<{
    id: string;
    text: string;
    startSeconds: number;
    endSeconds: number;
    x: number;
    y: number;
    size: number;
    color: string;
    outline: string;
    outlineWidth: number;
    align: 'left' | 'center' | 'right';
    weight: 'normal' | 'bold';
    fadeSeconds: number;
  }>;
  queuePreviews?: Array<{
    pieceId: string;
    startSeconds: number;
    endSeconds: number;
    x: number;
    y: number;
    scale: number;
    quarterTurns: 0 | 1 | 2 | 3;
  }>;
  clear?: DropRoundedCubeControls & {
    /** Opt-in palette texture on existing faceted-chip/rock and rounded-rock shapes. Absent/false preserves legacy solid paint; requires a bound tile.palette at render time. */ fragmentMaterialTexture?: boolean;
    /** Opt-in board-space advection for legacy screen-anchored clear effects; absence retains historical motion. */ followFieldRise?: boolean;
    /** Explicit calibrated consumer of the shared native two-depth world. */ nativeInertial?: boolean;
    ballisticPrefracture?: BallisticPrefractureProfile;
    prefractureRefineSeconds?: number;
    fragmentDisplayFps?: number;
    fragmentDisplayPhaseSeconds?: number;
    layeredCurve?: DropLayeredCurve;
    fragmentPhysics?: DropFragmentPhysics;
    fragmentShading?: 'legacy' | 'material';
    sheetLiftPixels?: number;
    sheetLiftFrontFalloffPower?: number;
    sheetLiftSeconds?: number;
    sheetThicknessScale?: number;
    fragmentLightColor?: string;
    fragmentPalette?: string[];
    prefractureScale?: number;
    prefractureSubdivisions?: number;
    colorByAction?: string[][];
    colorSource?: 'cell' | 'action-piece';
    fragmentSurface?: 'tile' | 'solid' | 'tile-repeat';
    scatterVerticalRatio?: number;
    scatterHorizontalRatio?: number;
    prefracture?: boolean;
    fragmentAmbient?: number;
    fragmentRotationSpread?: number;
    fragmentCubeRotationAgeScale?: number;
    fragmentColor?: string;
    sheetMotionRate?: number;
    sheetTearSeconds?: number;
    motionModel?: 'ballistic' | 'constrained-sheet' | 'layered-curve';
    frontOrigin?: 'left' | 'right' | 'center' | 'edges';
    freezeColorAtRelease?: boolean;
    frontExponent?: number;
    fragmentAgeOffsetSeconds?: number;
    overlap?: boolean;
    fallSpread?: number;
    sizeSpread?: number;
    style: 'granular-sweep' | 'fold-sheet';
    subdivisions: number;
    frontSeconds: number;
    fallPixels: number;
    scatterPixels: number;
    lifetimeSeconds: number;
    highlight?: number;
    fragmentScale?: number;
    fragmentGeometry?:
      | 'flat-shard'
      | 'faceted-chip'
      | 'faceted-rock'
      | 'rounded-rock'
      | 'textured-chip'
      | 'textured-cube'
      | 'rounded-cube'
      | 'rounded-polyhedron'
      | 'fractured-block'
      | 'fractured-volume'
      | 'relief-cube'
      | 'pyramid-quarter'
      | 'partitioned-solid';
    shadow?: number;
  };
  background: string;
  material: 'bevel' | 'pyramid' | 'wood-star' | 'ice';
  tileColor: string;
  columnColors?: string[];
  incomingRowColors?: string[];
  incomingCellColors?: string[][];
  colorMode?: 'identity' | 'columns';
  hud: {
    kind: 'level-score' | 'timer-score' | 'score' | 'none' | 'queue-panel';
    scoreLabelSize?: number;
    height: number;
    background: string;
    color: string;
    levelLabel: string;
    level: string;
    scoreLabel: string;
    initialScore: number;
    scoreCeiling?: number;
    countdown: number;
  };
  queue: { visible: boolean; y: number; scale: number };
  faceShading?: { top: number; left: number; right: number; bottom: number };
  bevel: number;
  seam: number;
  shadow: number;
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (key: string): never => {
  throw new Error(`DROP_REFERENCE_CALIBRATION_INVALID: ${key}`);
};
const n = (v: unknown, key: string, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(key);
const hex = (v: unknown, key: string): string =>
  typeof v === 'string' && /^#[\da-f]{6}$/i.test(v) ? v : fail(key);
const str = (v: unknown, key: string): string =>
  typeof v === 'string' && v.length <= 80 ? v : fail(key);
function obj(v: unknown, keys: string[], key: string) {
  if (!isRecord(v) || Object.keys(v).some((k) => !keys.includes(k))) fail(key);
  return v as Record<string, unknown>;
}
function parseFragmentLightDirection(
  value: unknown,
): NonNullable<DropRoundedCubeControls['fragmentLightDirection']> {
  const q = obj(value, ['x', 'y', 'z'], 'clear.fragmentLightDirection');
  const direction = {
    x: n(q.x, 'clear.fragmentLightDirection.x', -1, 1),
    y: n(q.y, 'clear.fragmentLightDirection.y', -1, 1),
    z: n(q.z, 'clear.fragmentLightDirection.z', -1, 1),
  };
  if (direction.x === 0 && direction.y === 0 && direction.z === 0)
    fail('clear.fragmentLightDirection must be nonzero');
  return direction;
}
function parseFragmentFaceColors(
  value: unknown,
): NonNullable<DropRoundedCubeControls['fragmentFaceColors']> {
  const key = 'clear.fragmentFaceColors',
    keys = ['front', 'back', 'left', 'right', 'top', 'bottom'],
    q = obj(value, keys, key);
  if (Object.keys(q).length === 0) fail(key + ' must specify at least one face');
  return Object.fromEntries(
    Object.entries(q).map(([face, color]) => [face, hex(color, key + '.' + face)]),
  );
}
function parseFragmentCastShadow(
  value: unknown,
): NonNullable<DropRoundedCubeControls['fragmentCastShadow']> {
  const key = 'clear.fragmentCastShadow',
    q = obj(value, ['offsetX', 'offsetY', 'blur', 'opacity', 'color'], key);
  return {
    offsetX: n(q.offsetX, key + '.offsetX', -2, 2),
    offsetY: n(q.offsetY, key + '.offsetY', -2, 2),
    blur: n(q.blur, key + '.blur', 0, 2),
    opacity: n(q.opacity, key + '.opacity', 0, 1),
    ...(q.color === undefined ? {} : { color: hex(q.color, key + '.color') }),
  };
}
function parseFragmentPerspectiveCamera(value: unknown): PyramidQuarterPerspectiveCamera {
  const key = 'clear.fragmentPerspectiveCamera',
    q = obj(value, ['focalLengthPixels', 'centerX', 'centerY', 'referencePlaneDepthPixels'], key);
  return {
    focalLengthPixels: n(q.focalLengthPixels, key + '.focalLengthPixels', 1, 1e6),
    centerX: n(q.centerX, key + '.centerX', -1e6, 1e6),
    centerY: n(q.centerY, key + '.centerY', -1e6, 1e6),
    referencePlaneDepthPixels: n(
      q.referencePlaneDepthPixels,
      key + '.referencePlaneDepthPixels',
      -1e6,
      1e6,
    ),
  };
}
function parseLayeredCurve(value: unknown): DropLayeredCurve {
  const q = obj(
    value,
    [
      'keys',
      'frontSeconds',
      'thicknessGrowth',
      'horizontalCompression',
      'scatterPixels',
      'waveOriginOffsets',
      'depthLayers',
      'referenceBandRows',
      'depthStaggerPixels',
      'depthRotationSpread',
      'rowStagger',
      'sizeGrowth',
    ],
    'clear.layeredCurve',
  );
  if (!Array.isArray(q.keys) || q.keys.length < 1 || q.keys.length > 64)
    fail('clear.layeredCurve.keys');
  const keys = (q.keys as unknown[]).map((value, i) => {
    const key = `clear.layeredCurve.keys.${i}`,
      k = obj(
        value,
        [
          'seconds',
          'centerDropPixels',
          'midDropPixels',
          'edgeDropPixels',
          'centerThickness',
          'midThickness',
          'edgeThickness',
        ],
        key,
      );
    const thicknessKeys = ['centerThickness', 'midThickness', 'edgeThickness'],
      hasThickness = thicknessKeys.some((name) => k[name] !== undefined);
    if (hasThickness && thicknessKeys.some((name) => k[name] === undefined))
      fail(key + '.thickness requires center/mid/edge together');
    return {
      seconds: n(k.seconds, key + '.seconds', 0, 5),
      centerDropPixels: n(k.centerDropPixels, key + '.centerDropPixels', -500, 10000),
      midDropPixels: n(k.midDropPixels, key + '.midDropPixels', -500, 10000),
      edgeDropPixels: n(k.edgeDropPixels, key + '.edgeDropPixels', -500, 10000),
      ...(hasThickness
        ? {
            centerThickness: n(k.centerThickness, key + '.centerThickness', 0.5, 12),
            midThickness: n(k.midThickness, key + '.midThickness', 0.5, 12),
            edgeThickness: n(k.edgeThickness, key + '.edgeThickness', 0.5, 12),
          }
        : {}),
    };
  });
  if (keys.some((key, i) => i > 0 && key.seconds <= keys[i - 1]!.seconds))
    fail('clear.layeredCurve.keys.seconds must strictly increase');
  if (
    keys.some(
      (key) => (key.centerThickness === undefined) !== (keys[0]!.centerThickness === undefined),
    )
  )
    fail('clear.layeredCurve.keys.thickness must be consistent throughout timeline');
  let waveOriginOffsets: DropLayeredCurve['waveOriginOffsets'];
  if (q.waveOriginOffsets !== undefined) {
    if (!Array.isArray(q.waveOriginOffsets) || q.waveOriginOffsets.length > 2048)
      fail('clear.layeredCurve.waveOriginOffsets');
    const pairs = new Set<string>();
    waveOriginOffsets = (q.waveOriginOffsets as unknown[]).map((value, i) => {
      const key = `clear.layeredCurve.waveOriginOffsets.${i}`,
        w = obj(value, ['actionIndex', 'cycleIndex', 'offsetY'], key),
        actionIndex = n(w.actionIndex, key + '.actionIndex', 0, 999),
        cycleIndex = n(w.cycleIndex, key + '.cycleIndex', 0, 63);
      if (!Number.isInteger(actionIndex) || !Number.isInteger(cycleIndex)) fail(key + '.indices');
      const pair = `${actionIndex}:${cycleIndex}`;
      if (pairs.has(pair)) fail(key + '.duplicate');
      pairs.add(pair);
      return { actionIndex, cycleIndex, offsetY: n(w.offsetY, key + '.offsetY', -1920, 1920) };
    });
  }
  if (q.depthLayers !== undefined && q.depthLayers !== 1 && q.depthLayers !== 2)
    fail('clear.layeredCurve.depthLayers');
  let referenceBandRows: number | undefined;
  if (q.referenceBandRows !== undefined) {
    referenceBandRows = n(q.referenceBandRows, 'clear.layeredCurve.referenceBandRows', 1, 28);
    if (!Number.isInteger(referenceBandRows)) fail('clear.layeredCurve.referenceBandRows');
  }
  return {
    keys,
    frontSeconds: n(q.frontSeconds, 'clear.layeredCurve.frontSeconds', 0, 5),
    thicknessGrowth: n(q.thicknessGrowth, 'clear.layeredCurve.thicknessGrowth', 0, 20),
    horizontalCompression: n(
      q.horizontalCompression,
      'clear.layeredCurve.horizontalCompression',
      0,
      5,
    ),
    scatterPixels: n(q.scatterPixels, 'clear.layeredCurve.scatterPixels', 0, 1080),
    ...(waveOriginOffsets === undefined ? {} : { waveOriginOffsets }),
    ...(q.depthLayers === undefined ? {} : { depthLayers: q.depthLayers as 1 | 2 }),
    ...(referenceBandRows === undefined ? {} : { referenceBandRows }),
    ...(q.depthStaggerPixels === undefined
      ? {}
      : {
          depthStaggerPixels: n(
            q.depthStaggerPixels,
            'clear.layeredCurve.depthStaggerPixels',
            0,
            150,
          ),
        }),
    ...(q.depthRotationSpread === undefined
      ? {}
      : {
          depthRotationSpread: n(
            q.depthRotationSpread,
            'clear.layeredCurve.depthRotationSpread',
            0,
            1,
          ),
        }),
    ...(q.rowStagger === undefined
      ? {}
      : { rowStagger: n(q.rowStagger, 'clear.layeredCurve.rowStagger', 0, 0.45) }),
    ...(q.sizeGrowth === undefined
      ? {}
      : { sizeGrowth: n(q.sizeGrowth, 'clear.layeredCurve.sizeGrowth', 0, 0.3) }),
  };
}
export function parseDropReferenceCalibration(value: unknown): DropReferenceCalibration {
  const r = obj(
    value,
    [
      'version',
      'impactBeamCues',
      'landingSurfaceFlashCues',
      'encouragementGlyphCues',
      'fallTrail',
      'fieldRiseOffsetKeys',
      'sceneSaturationKeys',
      'paletteDepth',
      'airbornePaletteDepth',
      'paletteDepthColor',
      'introCellCues',
      'observedFragmentMotionCues',
      'screenVignette',
      'boardColorKeys',
      'cellColorKeys',
      'counterTracks',
      'spriteCues',
      'landingColorSeconds',
      'tilePaletteColors',
      'tilePaletteLighting',
      'tilePaletteCropPixels',
      'faceShading',
      'pieceTracks',
      'respectPieceTrackWindows',
      'guidance',
      'queuePreviews',
      'clear',
      'board',
      'background',
      'material',
      'tileColor',
      'colorMode',
      'columnColors',
      'incomingRowColors',
      'incomingCellColors',
      'hud',
      'queue',
      'bevel',
      'seam',
      'shadow',
    ],
    'root',
  );
  const impactBeamCues =
    r.impactBeamCues === undefined ? undefined : parseDropImpactBeamCues(r.impactBeamCues);
  const landingSurfaceFlashCues =
    r.landingSurfaceFlashCues === undefined
      ? undefined
      : parseDropLandingSurfaceFlashCues(r.landingSurfaceFlashCues);
  const encouragementGlyphCues =
    r.encouragementGlyphCues === undefined
      ? undefined
      : parseDropEncouragementGlyphCues(r.encouragementGlyphCues);
  if (r.version !== 1) fail('version');
  const b = obj(
    r.board,
    [
      'x',
      'y',
      'cell',
      'verticalScale',
      'verticalLines',
      'height',
      'gridY',
      'lineWidth',
      'background',
      'line',
      'horizontalLines',
    ],
    'board',
  );
  const h = obj(
    r.hud,
    [
      'kind',
      'scoreLabelSize',
      'height',
      'background',
      'color',
      'levelLabel',
      'level',
      'scoreLabel',
      'initialScore',
      'scoreCeiling',
      'countdown',
    ],
    'hud',
  );
  const q = obj(r.queue, ['visible', 'y', 'scale'], 'queue');
  if (!['bevel', 'pyramid', 'wood-star', 'ice'].includes(String(r.material))) fail('material');
  if (!['level-score', 'timer-score', 'score', 'none', 'queue-panel'].includes(String(h.kind)))
    fail('hud.kind');
  if (
    typeof b.horizontalLines !== 'boolean' ||
    typeof q.visible !== 'boolean' ||
    (b.verticalLines !== undefined && typeof b.verticalLines !== 'boolean')
  )
    fail('boolean');
  if (r.respectPieceTrackWindows !== undefined && typeof r.respectPieceTrackWindows !== 'boolean')
    fail('respectPieceTrackWindows');
  if (
    r.columnColors !== undefined &&
    (!Array.isArray(r.columnColors) || r.columnColors.length > 64)
  )
    fail('columnColors');
  if (
    r.incomingRowColors !== undefined &&
    (!Array.isArray(r.incomingRowColors) ||
      r.incomingRowColors.length < 1 ||
      r.incomingRowColors.length > 256)
  )
    fail('incomingRowColors');
  const incomingRowColors =
    r.incomingRowColors === undefined
      ? undefined
      : (r.incomingRowColors as unknown[]).map((v, i) => hex(v, `incomingRowColors.${i}`));
  let incomingCellColors: string[][] | undefined;
  if (r.incomingCellColors !== undefined) {
    if (
      !Array.isArray(r.incomingCellColors) ||
      r.incomingCellColors.length < 1 ||
      r.incomingCellColors.length > 256
    )
      fail('incomingCellColors');
    incomingCellColors = (r.incomingCellColors as unknown[]).map((row, i) => {
      if (!Array.isArray(row) || row.length < 1 || row.length > 64) fail(`incomingCellColors.${i}`);
      return (row as unknown[]).map((v, j) => hex(v, `incomingCellColors.${i}.${j}`));
    });
  }
  if (r.colorMode !== undefined && !['identity', 'columns'].includes(String(r.colorMode)))
    fail('colorMode');
  if (
    r.tilePaletteColors !== undefined &&
    (!Array.isArray(r.tilePaletteColors) ||
      r.tilePaletteColors.length < 1 ||
      r.tilePaletteColors.length > 32)
  )
    fail('tilePaletteColors');
  const tilePaletteColors =
    r.tilePaletteColors === undefined
      ? undefined
      : (r.tilePaletteColors as unknown[]).map((v, i) => hex(v, `tilePaletteColors.${i}`));
  let tilePaletteLighting: DropReferenceCalibration['tilePaletteLighting'];
  if (r.tilePaletteLighting !== undefined) {
    const q = obj(r.tilePaletteLighting, ['rows', 'top', 'bottom'], 'tilePaletteLighting');
    const rows = n(q.rows, 'tilePaletteLighting.rows', 2, 64),
      top = n(q.top, 'tilePaletteLighting.top', -1920, 3840),
      bottom = n(q.bottom, 'tilePaletteLighting.bottom', -1920, 3840);
    if (!Number.isInteger(rows) || bottom <= top) fail('tilePaletteLighting');
    tilePaletteLighting = { rows, top, bottom };
  }
  let tilePaletteCropPixels: DropReferenceCalibration['tilePaletteCropPixels'];
  if (r.tilePaletteCropPixels !== undefined) {
    const crop = obj(
      r.tilePaletteCropPixels,
      ['top', 'right', 'bottom', 'left'],
      'tilePaletteCropPixels',
    );
    tilePaletteCropPixels = {
      top: n(crop.top, 'crop.top', 0, 16),
      right: n(crop.right, 'crop.right', 0, 16),
      bottom: n(crop.bottom, 'crop.bottom', 0, 16),
      left: n(crop.left, 'crop.left', 0, 16),
    };
  }
  let clear: DropReferenceCalibration['clear'];
  if (r.clear !== undefined) {
    const e = obj(
      r.clear,
      [
        'followFieldRise',
        'fragmentMaterialTexture',
        'nativeInertial',
        'ballisticPrefracture',
        'prefractureRefineSeconds',
        'fragmentDisplayFps',
        'fragmentDisplayPhaseSeconds',
        'fragmentDepthRenderer',
        'fragmentPerspectiveCamera',
        'fragmentPartitionProfile',
        'fragmentCubeFrontUvMapping',
        'fragmentVolumeSeedPattern',
        'fragmentDepthLayers',
        'fragmentFaceColors',
        'fragmentCastShadow',
        'fragmentAmbientFloor',
        'fragmentSpecularStrength',
        'fragmentSpecularPower',
        'fragmentCubePitchStart',
        'fragmentCubePitchRate',
        'fragmentDiffuse',
        'fragmentLightDirection',
        'fragmentRotationSpreadRampSeconds',
        'fragmentCubeCornerRadius',
        'layeredCurve',
        'fragmentPhysics',
        'fragmentShading',
        'sheetLiftPixels',
        'sheetLiftFrontFalloffPower',
        'sheetLiftSeconds',
        'sheetThicknessScale',
        'fragmentLightColor',
        'fragmentPalette',
        'prefractureScale',
        'prefractureSubdivisions',
        'colorByAction',
        'colorSource',
        'fragmentSurface',
        'scatterVerticalRatio',
        'scatterHorizontalRatio',
        'prefracture',
        'fragmentAmbient',
        'fragmentRotationSpread',
        'fragmentCubeRotationAgeScale',
        'fragmentColor',
        'sheetMotionRate',
        'sheetTearSeconds',
        'motionModel',
        'frontOrigin',
        'freezeColorAtRelease',
        'frontExponent',
        'fragmentAgeOffsetSeconds',
        'fallSpread',
        'sizeSpread',
        'overlap',
        'style',
        'subdivisions',
        'frontSeconds',
        'fallPixels',
        'scatterPixels',
        'lifetimeSeconds',
        'highlight',
        'fragmentScale',
        'fragmentGeometry',
        'shadow',
      ],
      'clear',
    );
    if (!['granular-sweep', 'fold-sheet'].includes(String(e.style))) fail('clear.style');
    const subdivisions = n(e.subdivisions, 'clear.subdivisions', 1, 8);
    if (!Number.isInteger(subdivisions)) fail('clear.subdivisions');
    if (
      e.fragmentGeometry !== undefined &&
      ![
        'flat-shard',
        'faceted-chip',
        'faceted-rock',
        'rounded-rock',
        'textured-chip',
        'textured-cube',
        'rounded-cube',
        'rounded-polyhedron',
        'fractured-block',
        'fractured-volume',
        'relief-cube',
        'pyramid-quarter',
        'partitioned-solid',
      ].includes(String(e.fragmentGeometry))
    )
      fail('clear.fragmentGeometry');
    if (
      e.fragmentGeometry === 'rounded-polyhedron' &&
      (e.fragmentSurface !== 'solid' ||
        e.fragmentShading === 'legacy' ||
        e.motionModel !== 'ballistic' ||
        e.nativeInertial === true ||
        (e.fragmentPhysics &&
          ((e.fragmentPhysics as Record<string, unknown>).sheetDetachSeconds !== undefined ||
            (e.fragmentPhysics as Record<string, unknown>).sheetDetachAfterReleaseSeconds !==
              undefined)) ||
        e.fragmentCubeFrontUvMapping !== undefined ||
        e.fragmentVolumeSeedPattern !== undefined ||
        e.fragmentDepthLayers !== undefined ||
        e.fragmentDepthRenderer !== undefined ||
        e.fragmentPerspectiveCamera !== undefined ||
        e.fragmentPartitionProfile !== undefined)
    )
      fail(
        'clear.rounded-polyhedron requires solid normal-lit ballistic and excludes legacy shading/sheet/native/observed/UV/volume/depth/perspective/partition controls',
      );
    if (e.fragmentMaterialTexture !== undefined && typeof e.fragmentMaterialTexture !== 'boolean')
      fail('clear.fragmentMaterialTexture');
    if (
      e.fragmentMaterialTexture === true &&
      (!['faceted-chip', 'faceted-rock', 'rounded-rock'].includes(String(e.fragmentGeometry)) ||
        e.nativeInertial === true ||
        e.fragmentDepthRenderer !== undefined ||
        e.fragmentPerspectiveCamera !== undefined)
    )
      fail(
        'clear.fragmentMaterialTexture requires faceted-chip/faceted-rock/rounded-rock and native Canvas fragments',
      );
    if (
      e.fragmentCubeFrontUvMapping !== undefined &&
      !['flat-patch', 'mother-plane'].includes(String(e.fragmentCubeFrontUvMapping))
    )
      fail('clear.fragmentCubeFrontUvMapping');
    if (
      e.fragmentCubeFrontUvMapping === 'mother-plane' &&
      (e.fragmentGeometry !== 'rounded-cube' || e.fragmentSurface === 'tile-repeat')
    )
      fail(
        'clear.fragmentCubeFrontUvMapping mother-plane requires explicit rounded-cube and non-repeating mother UV',
      );
    if (
      e.fragmentDepthLayers !== undefined &&
      !(
        (e.fragmentGeometry === 'fractured-volume' &&
          [1, 2].includes(e.fragmentDepthLayers as number)) ||
        (['relief-cube', 'pyramid-quarter', 'partitioned-solid'].includes(
          String(e.fragmentGeometry),
        ) &&
          e.fragmentDepthLayers === 1) ||
        (e.fragmentGeometry === 'rounded-cube' &&
          e.fragmentDepthRenderer === 'webgl-opaque' &&
          e.fragmentDepthLayers === 1)
      )
    )
      fail(
        'clear.fragmentDepthLayers requires fractured-volume 1 or 2, or relief-cube/pyramid-quarter 1',
      );
    if (
      e.fragmentVolumeSeedPattern !== undefined &&
      !['grid', 'center-three'].includes(String(e.fragmentVolumeSeedPattern))
    )
      fail('clear.fragmentVolumeSeedPattern');
    if (
      e.fragmentVolumeSeedPattern === 'center-three' &&
      (e.fragmentGeometry !== 'fractured-volume' ||
        subdivisions !== 2 ||
        e.fragmentDepthLayers !== 2 ||
        (e.prefractureSubdivisions !== undefined && e.prefractureSubdivisions !== 2))
    )
      fail(
        'clear.fragmentVolumeSeedPattern center-three requires fractured-volume, subdivisions 2 and fragmentDepthLayers 2',
      );
    if (e.overlap !== undefined && typeof e.overlap !== 'boolean') fail('clear.overlap');
    if (e.freezeColorAtRelease !== undefined && typeof e.freezeColorAtRelease !== 'boolean')
      fail('clear.freezeColorAtRelease');
    if (
      e.frontOrigin !== undefined &&
      !['left', 'right', 'center', 'edges'].includes(String(e.frontOrigin))
    )
      fail('clear.frontOrigin');
    if (
      e.motionModel !== undefined &&
      !['ballistic', 'constrained-sheet', 'layered-curve'].includes(String(e.motionModel))
    )
      fail('clear.motionModel');
    if (e.motionModel === 'constrained-sheet' && (subdivisions < 2 || subdivisions > 8))
      fail('clear.motionModel requires subdivisions 2 to 8');
    const layeredCurve =
      e.layeredCurve === undefined ? undefined : parseLayeredCurve(e.layeredCurve);
    if (e.motionModel === 'layered-curve' && (!layeredCurve || subdivisions < 2))
      fail('clear.layeredCurve requires profile and subdivisions 2 to 8');
    if (layeredCurve && e.motionModel !== 'layered-curve')
      fail('clear.layeredCurve requires layered-curve motionModel');
    if (e.prefracture !== undefined && typeof e.prefracture !== 'boolean')
      fail('clear.prefracture');
    if (
      e.fragmentSurface !== undefined &&
      !['tile', 'solid', 'tile-repeat'].includes(String(e.fragmentSurface))
    )
      fail('clear.fragmentSurface');
    if (e.colorSource !== undefined && !['cell', 'action-piece'].includes(String(e.colorSource)))
      fail('clear.colorSource');
    let colorByAction: string[][] | undefined;
    if (e.colorByAction !== undefined) {
      if (!Array.isArray(e.colorByAction) || e.colorByAction.length > 1000)
        fail('clear.colorByAction');
      colorByAction = (e.colorByAction as unknown[]).map((row, i) => {
        if (!Array.isArray(row) || row.length > 64) fail(`clear.colorByAction.${i}`);
        return (row as unknown[]).map((v, j) => hex(v, `clear.colorByAction.${i}.${j}`));
      });
    }
    if (
      e.prefractureSubdivisions !== undefined &&
      (!Number.isInteger(e.prefractureSubdivisions) ||
        Number(e.prefractureSubdivisions) < 1 ||
        Number(e.prefractureSubdivisions) > 8)
    )
      fail('clear.prefractureSubdivisions');
    if (
      e.fragmentGeometry === 'relief-cube' &&
      (subdivisions !== 2 ||
        (e.prefractureSubdivisions !== undefined && e.prefractureSubdivisions !== 2) ||
        (layeredCurve?.depthLayers ?? 1) !== 1 ||
        e.fragmentSurface === 'tile-repeat')
    )
      fail('clear.relief-cube requires subdivisions 2, depthLayers 1 and non-repeating mother UV');
    if (
      e.fragmentGeometry === 'pyramid-quarter' &&
      (subdivisions !== 2 ||
        (e.prefractureSubdivisions !== undefined && e.prefractureSubdivisions !== 2) ||
        (layeredCurve?.depthLayers ?? 1) !== 1 ||
        e.fragmentSurface === 'tile-repeat')
    )
      fail(
        'clear.pyramid-quarter requires subdivisions 2, depthLayers 1 and non-repeating mother UV',
      );
    let fragmentPalette: string[] | undefined;
    if (e.fragmentPalette !== undefined) {
      if (
        !Array.isArray(e.fragmentPalette) ||
        e.fragmentPalette.length < 1 ||
        e.fragmentPalette.length > 32
      )
        fail('clear.fragmentPalette');
      fragmentPalette = (e.fragmentPalette as unknown[]).map((v, i) =>
        hex(v, `clear.fragmentPalette.${i}`),
      );
    }
    let fragmentPhysics: DropFragmentPhysics | undefined;
    if (e.fragmentPhysics !== undefined) {
      const q = obj(
        e.fragmentPhysics,
        [
          'gravityPixelsPerSecondSquared',
          'initialVelocityY',
          'initialVelocityX',
          'velocitySpreadX',
          'velocitySpreadY',
          'velocitySpreadPowerX',
          'velocitySpreadPowerY',
          'exitY',
          'sheetDetachSeconds',
          'sheetDetachAfterReleaseSeconds',
        ],
        'clear.fragmentPhysics',
      );
      fragmentPhysics = {
        gravityPixelsPerSecondSquared: n(
          q.gravityPixelsPerSecondSquared,
          'clear.fragmentPhysics.gravityPixelsPerSecondSquared',
          100,
          20000,
        ),
        initialVelocityY: n(
          q.initialVelocityY,
          'clear.fragmentPhysics.initialVelocityY',
          -2000,
          2000,
        ),
        initialVelocityX: n(
          q.initialVelocityX,
          'clear.fragmentPhysics.initialVelocityX',
          -1200,
          1200,
        ),
        ...(q.velocitySpreadX === undefined
          ? {}
          : {
              velocitySpreadX: n(
                q.velocitySpreadX,
                'clear.fragmentPhysics.velocitySpreadX',
                0,
                1200,
              ),
            }),
        ...(q.velocitySpreadY === undefined
          ? {}
          : {
              velocitySpreadY: n(
                q.velocitySpreadY,
                'clear.fragmentPhysics.velocitySpreadY',
                0,
                1200,
              ),
            }),
        ...(q.velocitySpreadPowerX === undefined
          ? {}
          : {
              velocitySpreadPowerX: n(
                q.velocitySpreadPowerX,
                'clear.fragmentPhysics.velocitySpreadPowerX',
                1,
                8,
              ),
            }),
        ...(q.velocitySpreadPowerY === undefined
          ? {}
          : {
              velocitySpreadPowerY: n(
                q.velocitySpreadPowerY,
                'clear.fragmentPhysics.velocitySpreadPowerY',
                1,
                8,
              ),
            }),
        ...(q.exitY === undefined
          ? {}
          : { exitY: n(q.exitY, 'clear.fragmentPhysics.exitY', 0, 3840) }),
        ...(q.sheetDetachSeconds === undefined
          ? {}
          : {
              sheetDetachSeconds: n(
                q.sheetDetachSeconds,
                'clear.fragmentPhysics.sheetDetachSeconds',
                0,
                2,
              ),
            }),
        ...(q.sheetDetachAfterReleaseSeconds === undefined
          ? {}
          : {
              sheetDetachAfterReleaseSeconds: n(
                q.sheetDetachAfterReleaseSeconds,
                'clear.fragmentPhysics.sheetDetachAfterReleaseSeconds',
                0,
                2,
              ),
            }),
      };
    }
    const local =
        e.motionModel === 'constrained-sheet' &&
        fragmentPhysics?.sheetDetachAfterReleaseSeconds !== undefined,
      plain =
        e.motionModel === 'ballistic' &&
        fragmentPhysics !== undefined &&
        fragmentPhysics.sheetDetachSeconds === undefined &&
        fragmentPhysics.sheetDetachAfterReleaseSeconds === undefined &&
        ['rounded-cube', 'rounded-polyhedron'].includes(String(e.fragmentGeometry)) &&
        e.layeredCurve === undefined &&
        e.fragmentDepthRenderer === undefined &&
        e.fragmentPerspectiveCamera === undefined &&
        (e.fragmentDepthLayers === undefined || e.fragmentDepthLayers === 1) &&
        e.prefractureRefineSeconds === undefined;
    if (local && (e.fragmentAgeOffsetSeconds ?? 0) !== 0)
      fail('clear.fragmentAgeOffsetSeconds is not supported by local detach');
    let ballisticPrefracture: BallisticPrefractureProfile | undefined;
    if (e.ballisticPrefracture !== undefined) {
      const q = obj(
        e.ballisticPrefracture,
        [
          'coarseSubdivisions',
          'coarseScale',
          'refineAfterReleaseSeconds',
          'retainedCoarseFraction',
        ],
        'clear.ballisticPrefracture',
      );
      const m = n(q.coarseSubdivisions, 'clear.ballisticPrefracture.coarseSubdivisions', 1, 7);
      if (
        !plain ||
        e.fragmentDisplayFps === undefined ||
        e.prefracture !== false ||
        e.fragmentSurface === 'tile-repeat' ||
        subdivisions < 2 ||
        !Number.isInteger(m) ||
        m >= subdivisions ||
        subdivisions % m !== 0
      )
        fail(
          'clear.ballisticPrefracture requires sampled plain rounded-cube ballistic, explicit prefracture false, and a dividing coarse lattice',
        );
      ballisticPrefracture = {
        coarseSubdivisions: m,
        coarseScale: n(q.coarseScale, 'clear.ballisticPrefracture.coarseScale', 0.5, 2),
        refineAfterReleaseSeconds: n(
          q.refineAfterReleaseSeconds,
          'clear.ballisticPrefracture.refineAfterReleaseSeconds',
          Number.MIN_VALUE,
          2,
        ),
        retainedCoarseFraction: n(
          q.retainedCoarseFraction,
          'clear.ballisticPrefracture.retainedCoarseFraction',
          0,
          0.25,
        ),
      };
    }
    if (e.sheetLiftFrontFalloffPower !== undefined) {
      n(e.sheetLiftFrontFalloffPower, 'clear.sheetLiftFrontFalloffPower', 0, 4);
      if (!local) fail('clear.sheetLiftFrontFalloffPower requires local constrained-sheet support');
    }
    if (
      (fragmentPhysics?.velocitySpreadPowerX !== undefined ||
        fragmentPhysics?.velocitySpreadPowerY !== undefined) &&
      (!plain || e.fragmentDisplayFps === undefined)
    )
      fail(
        'clear.fragmentPhysics.velocitySpreadPowerX/Y requires sampled plain rounded-cube ballistic physics',
      );
    if (e.fragmentDisplayFps !== undefined) {
      const hz = n(e.fragmentDisplayFps, 'clear.fragmentDisplayFps', 1, 120);
      if (!Number.isInteger(hz)) fail('clear.fragmentDisplayFps must be integer');
      if (!local && !plain)
        fail(
          'clear.fragmentDisplayFps requires local support or plain rounded-cube ballistic physics without sheet/depth/observed overrides',
        );
      if (
        r.observedFragmentMotionCues !== undefined &&
        (r.observedFragmentMotionCues as unknown[]).length
      )
        fail('clear.fragmentDisplayFps excludes observed motion overrides');
    }
    if (e.fragmentDisplayPhaseSeconds !== undefined) {
      if (e.fragmentDisplayFps === undefined)
        fail('clear.fragmentDisplayPhaseSeconds requires fragmentDisplayFps');
      const phase = n(e.fragmentDisplayPhaseSeconds, 'clear.fragmentDisplayPhaseSeconds', 0, 1);
      if (phase >= 1 / (e.fragmentDisplayFps as number))
        fail('clear.fragmentDisplayPhaseSeconds must be less than one display interval');
    }
    if (e.prefractureRefineSeconds !== undefined) {
      n(e.prefractureRefineSeconds, 'clear.prefractureRefineSeconds', Number.MIN_VALUE, 2);
      const coarse = e.prefractureSubdivisions;
      if (
        e.motionModel !== 'constrained-sheet' ||
        fragmentPhysics?.sheetDetachAfterReleaseSeconds === undefined ||
        e.prefracture !== true ||
        typeof coarse !== 'number' ||
        !Number.isInteger(coarse) ||
        coarse < 1 ||
        coarse >= subdivisions ||
        subdivisions % coarse !== 0 ||
        e.fragmentSurface === 'tile-repeat'
      )
        fail(
          'clear.prefractureRefineSeconds requires local support, prefracture true, an explicit dividing coarse lattice and non-repeating mother UV',
        );
    }
    if (fragmentPhysics?.sheetDetachAfterReleaseSeconds !== undefined) {
      if (e.motionModel !== 'constrained-sheet' || fragmentPhysics.sheetDetachSeconds !== undefined)
        fail(
          'clear.fragmentPhysics.sheetDetachAfterReleaseSeconds requires constrained-sheet and excludes global sheetDetachSeconds',
        );
      if (
        fragmentPhysics.initialVelocityX !== 0 ||
        fragmentPhysics.initialVelocityY !== 0 ||
        (fragmentPhysics.velocitySpreadX ?? 0) !== 0 ||
        (fragmentPhysics.velocitySpreadY ?? 0) !== 0
      )
        fail(
          'clear.fragmentPhysics.sheetDetachAfterReleaseSeconds requires zero extra launch velocities/spreads',
        );
      if (
        e.fragmentDepthRenderer !== undefined ||
        e.fragmentPerspectiveCamera !== undefined ||
        (e.frontExponent !== undefined && e.frontExponent !== 1) ||
        (e.prefractureRefineSeconds === undefined &&
          e.prefractureSubdivisions !== undefined &&
          e.prefractureSubdivisions !== subdivisions) ||
        [
          'fractured-block',
          'fractured-volume',
          'relief-cube',
          'pyramid-quarter',
          'partitioned-solid',
        ].includes(String(e.fragmentGeometry))
      )
        fail(
          'clear.fragmentPhysics.sheetDetachAfterReleaseSeconds incompatible renderer/front/partition controls',
        );
      if (
        r.observedFragmentMotionCues !== undefined &&
        (r.observedFragmentMotionCues as unknown[]).length
      )
        fail(
          'clear.fragmentPhysics.sheetDetachAfterReleaseSeconds excludes observed motion overrides',
        );
    }
    if (
      e.fragmentShading !== undefined &&
      !['legacy', 'material'].includes(String(e.fragmentShading))
    )
      fail('clear.fragmentShading');
    let fragmentPartitionProfile: PartitionedSolidProfile | undefined;
    if (e.fragmentPartitionProfile !== undefined) {
      try {
        fragmentPartitionProfile = parsePartitionedSolidProfile(
          e.fragmentPartitionProfile,
          'clear.fragmentPartitionProfile',
        );
      } catch (error) {
        fail(String(error));
      }
    }
    if (
      e.fragmentGeometry === 'partitioned-solid' &&
      (!fragmentPartitionProfile ||
        subdivisions !== 2 ||
        (e.prefractureSubdivisions ?? 2) !== 2 ||
        (e.fragmentDepthLayers ?? 1) !== 1 ||
        (layeredCurve?.depthLayers ?? 1) !== 1 ||
        e.fragmentSurface === 'tile-repeat' ||
        (e.motionModel !== undefined && e.motionModel !== 'ballistic'))
    )
      fail(
        'clear.partitioned-solid requires profile, subdivisions 2, one depth, non-repeating mother UV and observed V2 motion',
      );
    if (fragmentPartitionProfile && e.fragmentGeometry !== 'partitioned-solid')
      fail('clear.fragmentPartitionProfile requires partitioned-solid');
    if (e.fragmentDepthRenderer !== undefined && e.fragmentDepthRenderer !== 'webgl-opaque')
      fail('clear.fragmentDepthRenderer');
    if (e.nativeInertial !== undefined && typeof e.nativeInertial !== 'boolean')
      fail('clear.nativeInertial');
    if (e.followFieldRise !== undefined && typeof e.followFieldRise !== 'boolean')
      fail('clear.followFieldRise');
    if (
      e.followFieldRise === true &&
      (e.nativeInertial === true ||
        e.fragmentDisplayFps !== undefined ||
        fragmentPhysics?.sheetDetachAfterReleaseSeconds !== undefined ||
        (!fragmentPhysics && e.motionModel !== 'layered-curve') ||
        (Array.isArray(r.observedFragmentMotionCues) && r.observedFragmentMotionCues.length > 0))
    )
      fail('clear.followFieldRise requires a legacy screen-anchored physical or layered model');
    clear = {
      ...(e.followFieldRise === undefined ? {} : { followFieldRise: e.followFieldRise as boolean }),
      ...(e.fragmentMaterialTexture === undefined
        ? {}
        : { fragmentMaterialTexture: e.fragmentMaterialTexture as boolean }),
      ...(e.nativeInertial === undefined ? {} : { nativeInertial: e.nativeInertial as boolean }),
      ...(ballisticPrefracture ? { ballisticPrefracture } : {}),
      ...(e.prefractureRefineSeconds === undefined
        ? {}
        : { prefractureRefineSeconds: e.prefractureRefineSeconds as number }),
      ...(e.fragmentDisplayFps === undefined
        ? {}
        : { fragmentDisplayFps: e.fragmentDisplayFps as number }),
      ...(e.fragmentDisplayPhaseSeconds === undefined
        ? {}
        : { fragmentDisplayPhaseSeconds: e.fragmentDisplayPhaseSeconds as number }),
      ...(e.fragmentDepthRenderer === undefined
        ? {}
        : { fragmentDepthRenderer: 'webgl-opaque' as const }),
      ...(e.fragmentPerspectiveCamera === undefined
        ? {}
        : {
            fragmentPerspectiveCamera: parseFragmentPerspectiveCamera(e.fragmentPerspectiveCamera),
          }),
      ...(fragmentPartitionProfile ? { fragmentPartitionProfile } : {}),
      ...(e.fragmentCubeFrontUvMapping === undefined
        ? {}
        : {
            fragmentCubeFrontUvMapping: e.fragmentCubeFrontUvMapping as
              | 'flat-patch'
              | 'mother-plane',
          }),
      ...(e.fragmentVolumeSeedPattern === undefined
        ? {}
        : { fragmentVolumeSeedPattern: e.fragmentVolumeSeedPattern as 'grid' | 'center-three' }),
      ...(e.fragmentDepthLayers === undefined
        ? {}
        : { fragmentDepthLayers: e.fragmentDepthLayers as 1 | 2 }),
      ...(e.fragmentFaceColors === undefined
        ? {}
        : { fragmentFaceColors: parseFragmentFaceColors(e.fragmentFaceColors) }),
      ...(e.fragmentCastShadow === undefined
        ? {}
        : { fragmentCastShadow: parseFragmentCastShadow(e.fragmentCastShadow) }),
      ...(e.fragmentAmbientFloor === undefined
        ? {}
        : {
            fragmentAmbientFloor: n(e.fragmentAmbientFloor, 'clear.fragmentAmbientFloor', 0, 0.55),
          }),
      ...(e.fragmentSpecularStrength === undefined
        ? {}
        : {
            fragmentSpecularStrength: n(
              e.fragmentSpecularStrength,
              'clear.fragmentSpecularStrength',
              0,
              2,
            ),
          }),
      ...(e.fragmentSpecularPower === undefined
        ? {}
        : {
            fragmentSpecularPower: n(
              e.fragmentSpecularPower,
              'clear.fragmentSpecularPower',
              4,
              128,
            ),
          }),
      ...(e.fragmentCubePitchStart === undefined
        ? {}
        : {
            fragmentCubePitchStart: n(
              e.fragmentCubePitchStart,
              'clear.fragmentCubePitchStart',
              -Math.PI,
              Math.PI,
            ),
          }),
      ...(e.fragmentCubePitchRate === undefined
        ? {}
        : {
            fragmentCubePitchRate: n(e.fragmentCubePitchRate, 'clear.fragmentCubePitchRate', 0, 8),
          }),
      ...(e.fragmentDiffuse === undefined
        ? {}
        : { fragmentDiffuse: n(e.fragmentDiffuse, 'clear.fragmentDiffuse', 0, 0.8) }),
      ...(e.fragmentLightDirection === undefined
        ? {}
        : { fragmentLightDirection: parseFragmentLightDirection(e.fragmentLightDirection) }),
      ...(e.fragmentRotationSpreadRampSeconds === undefined
        ? {}
        : {
            fragmentRotationSpreadRampSeconds: n(
              e.fragmentRotationSpreadRampSeconds,
              'clear.fragmentRotationSpreadRampSeconds',
              0,
              2,
            ),
          }),
      ...(e.fragmentCubeCornerRadius === undefined
        ? {}
        : {
            fragmentCubeCornerRadius: n(
              e.fragmentCubeCornerRadius,
              'clear.fragmentCubeCornerRadius',
              0.015,
              0.22,
            ),
          }),
      ...(layeredCurve ? { layeredCurve } : {}),
      ...(fragmentPhysics ? { fragmentPhysics } : {}),
      ...(e.fragmentShading === undefined
        ? {}
        : { fragmentShading: e.fragmentShading as 'legacy' | 'material' }),
      ...(e.sheetLiftPixels === undefined
        ? {}
        : { sheetLiftPixels: n(e.sheetLiftPixels, 'clear.sheetLiftPixels', 0, 800) }),
      ...(e.sheetLiftFrontFalloffPower === undefined
        ? {}
        : { sheetLiftFrontFalloffPower: e.sheetLiftFrontFalloffPower as number }),
      ...(e.sheetLiftSeconds === undefined
        ? {}
        : { sheetLiftSeconds: n(e.sheetLiftSeconds, 'clear.sheetLiftSeconds', 0.01, 2) }),
      ...(e.sheetThicknessScale === undefined
        ? {}
        : { sheetThicknessScale: n(e.sheetThicknessScale, 'clear.sheetThicknessScale', 0.5, 4) }),
      ...(e.fragmentLightColor === undefined
        ? {}
        : { fragmentLightColor: hex(e.fragmentLightColor, 'clear.fragmentLightColor') }),
      ...(fragmentPalette ? { fragmentPalette } : {}),
      ...(e.prefractureSubdivisions === undefined
        ? {}
        : { prefractureSubdivisions: e.prefractureSubdivisions as number }),
      ...(e.prefractureScale === undefined
        ? {}
        : { prefractureScale: n(e.prefractureScale, 'clear.prefractureScale', 0.5, 1) }),
      ...(colorByAction ? { colorByAction } : {}),
      ...(e.colorSource === undefined
        ? {}
        : { colorSource: e.colorSource as 'cell' | 'action-piece' }),
      ...(e.fragmentSurface === undefined
        ? {}
        : { fragmentSurface: e.fragmentSurface as 'tile' | 'solid' | 'tile-repeat' }),
      ...(e.scatterHorizontalRatio === undefined
        ? {}
        : {
            scatterHorizontalRatio: n(
              e.scatterHorizontalRatio,
              'clear.scatterHorizontalRatio',
              0,
              2,
            ),
          }),
      ...(e.scatterVerticalRatio === undefined
        ? {}
        : { scatterVerticalRatio: n(e.scatterVerticalRatio, 'clear.scatterVerticalRatio', 0, 2) }),
      ...(e.prefracture === undefined ? {} : { prefracture: e.prefracture as boolean }),
      ...(e.fragmentAmbient === undefined
        ? {}
        : { fragmentAmbient: n(e.fragmentAmbient, 'clear.fragmentAmbient', 0, 1.5) }),
      ...(e.fragmentRotationSpread === undefined
        ? {}
        : {
            fragmentRotationSpread: n(
              e.fragmentRotationSpread,
              'clear.fragmentRotationSpread',
              0,
              1,
            ),
          }),
      ...(e.fragmentCubeRotationAgeScale === undefined
        ? {}
        : {
            fragmentCubeRotationAgeScale: n(
              e.fragmentCubeRotationAgeScale,
              'clear.fragmentCubeRotationAgeScale',
              0,
              2,
            ),
          }),
      ...(e.fragmentColor === undefined
        ? {}
        : { fragmentColor: hex(e.fragmentColor, 'clear.fragmentColor') }),
      ...(e.sheetTearSeconds === undefined
        ? {}
        : { sheetTearSeconds: n(e.sheetTearSeconds, 'clear.sheetTearSeconds', 0, 2) }),
      ...(e.sheetMotionRate === undefined
        ? {}
        : { sheetMotionRate: n(e.sheetMotionRate, 'clear.sheetMotionRate', 0.25, 4) }),
      ...(e.motionModel === undefined
        ? {}
        : { motionModel: e.motionModel as 'ballistic' | 'constrained-sheet' | 'layered-curve' }),
      ...(e.frontOrigin === undefined
        ? {}
        : { frontOrigin: e.frontOrigin as 'left' | 'right' | 'center' | 'edges' }),
      ...(e.freezeColorAtRelease === undefined
        ? {}
        : { freezeColorAtRelease: e.freezeColorAtRelease as boolean }),
      ...(e.frontExponent === undefined
        ? {}
        : { frontExponent: n(e.frontExponent, 'clear.frontExponent', 0.25, 4) }),
      ...(e.fragmentAgeOffsetSeconds === undefined
        ? {}
        : {
            fragmentAgeOffsetSeconds: n(
              e.fragmentAgeOffsetSeconds,
              'clear.fragmentAgeOffsetSeconds',
              -0.25,
              0.25,
            ),
          }),
      ...(e.fallSpread === undefined
        ? {}
        : { fallSpread: n(e.fallSpread, 'clear.fallSpread', 0, 1) }),
      ...(e.sizeSpread === undefined
        ? {}
        : { sizeSpread: n(e.sizeSpread, 'clear.sizeSpread', 0, 1) }),
      ...(e.overlap === undefined ? {} : { overlap: e.overlap as boolean }),
      ...(e.shadow === undefined ? {} : { shadow: n(e.shadow, 'clear.shadow', 0, 1) }),
      ...(e.fragmentGeometry === undefined
        ? {}
        : {
            fragmentGeometry: e.fragmentGeometry as
              | 'flat-shard'
              | 'faceted-chip'
              | 'faceted-rock'
              | 'rounded-rock'
              | 'textured-chip'
              | 'textured-cube'
              | 'rounded-cube'
              | 'rounded-polyhedron'
              | 'fractured-block'
              | 'fractured-volume'
              | 'relief-cube'
              | 'pyramid-quarter'
              | 'partitioned-solid',
          }),
      ...(e.highlight === undefined ? {} : { highlight: n(e.highlight, 'clear.highlight', 0, 1) }),
      ...(e.fragmentScale === undefined
        ? {}
        : { fragmentScale: n(e.fragmentScale, 'clear.fragmentScale', 0.5, 6) }),
      style: e.style as 'granular-sweep' | 'fold-sheet',
      subdivisions,
      frontSeconds: n(e.frontSeconds, 'clear.frontSeconds', 0, 2),
      fallPixels: n(e.fallPixels, 'clear.fallPixels', 0, 2500),
      scatterPixels: n(e.scatterPixels, 'clear.scatterPixels', 0, 1080),
      lifetimeSeconds: n(e.lifetimeSeconds, 'clear.lifetimeSeconds', 0.1, 5),
    };
  }

  if (
    clear?.fragmentMaterialTexture === true &&
    Array.isArray(r.observedFragmentMotionCues) &&
    r.observedFragmentMotionCues.some(
      (c) => isRecord(c) && isRecord(c.motion) && c.motion.version === 2,
    )
  )
    fail('clear.fragmentMaterialTexture excludes observed motion V2');
  if (
    clear?.fragmentGeometry === 'rounded-polyhedron' &&
    r.observedFragmentMotionCues !== undefined &&
    (!Array.isArray(r.observedFragmentMotionCues) || r.observedFragmentMotionCues.length > 0)
  )
    fail('clear.rounded-polyhedron excludes observed motion');
  const observedFragmentMotionCues: DropReferenceCalibration['observedFragmentMotionCues'] =
    r.observedFragmentMotionCues === undefined
      ? undefined
      : (() => {
          if (
            !Array.isArray(r.observedFragmentMotionCues) ||
            r.observedFragmentMotionCues.length > 2048
          )
            fail('observedFragmentMotionCues');
          const waves = new Set<string>();
          let totalObservedKeys = 0;
          const integer = (v: unknown, key: string, lo: number, hi: number) => {
            const q = n(v, key, lo, hi);
            if (!Number.isInteger(q)) fail(key);
            return q;
          };
          return (r.observedFragmentMotionCues as unknown[]).map((v, i) => {
            const key = `observedFragmentMotionCues.${i}`,
              cue = obj(v, ['actionIndex', 'cycleIndex', 'motion'], key);
            const actionIndex = integer(cue.actionIndex, key + '.actionIndex', 0, 999),
              cycleIndex = integer(cue.cycleIndex, key + '.cycleIndex', 0, 63),
              wave = `${actionIndex}:${cycleIndex}`;
            if (waves.has(wave)) fail(key + '.duplicate');
            waves.add(wave);
            if (isDropObservedFragmentMotionV2(cue.motion)) {
              if (!clear) fail(key + '.motion v2 requires clear calibration');
              const motion = parseDropObservedFragmentMotionV2(cue.motion, key + '.motion');
              if (
                clear?.fragmentVolumeSeedPattern === 'center-three' &&
                (motion.subdivisions !== 2 || motion.particles.some((p) => p.depthIndex > 1))
              )
                fail(
                  key + '.motion center-three supports subdivisions 2 and depthIndex 0 or 1 only',
                );
              if (
                clear?.fragmentGeometry === 'relief-cube' &&
                (motion.subdivisions !== 2 || motion.particles.some((p) => p.depthIndex !== 0))
              )
                fail(key + '.motion relief-cube supports subdivisions 2 and depthIndex 0 only');
              if (
                clear?.fragmentGeometry === 'pyramid-quarter' &&
                (motion.subdivisions !== 2 || motion.particles.some((p) => p.depthIndex !== 0))
              )
                fail(key + '.motion pyramid-quarter supports subdivisions 2 and depthIndex 0 only');
              if (
                clear?.fragmentGeometry === 'partitioned-solid' &&
                (motion.subdivisions !== 2 || motion.particles.some((p) => p.depthIndex !== 0))
              )
                fail(
                  key + '.motion partitioned-solid supports subdivisions 2 and depthIndex 0 only',
                );
              totalObservedKeys += motion.particles.reduce(
                (count, particle) => count + particle.keys.length,
                0,
              );
              if (totalObservedKeys > DROP_OBSERVED_FRAGMENT_MAX_KEYS_PER_CALIBRATION)
                fail('observedFragmentMotionCues.totalKeys');
              return { actionIndex, cycleIndex, motion };
            }
            const m = obj(
              cue.motion,
              [
                'coordinateSpace',
                'canonicalFps',
                'gridX',
                'gridTop',
                'cellPitch',
                'subColumns',
                'minimumTracksPerSubColumn',
                'interpolationMinimumCoverage',
                'frames',
              ],
              key + '.motion',
            );
            if (
              m.coordinateSpace !== 'source-stage-pixels' ||
              !Array.isArray(m.frames) ||
              !m.frames.length ||
              m.frames.length > 6000
            )
              fail(key + '.motion');
            const frames = (m.frames as unknown[]).map((f, j) => {
              const z = obj(f, ['frameOffset', 'tracks'], key + `.frames.${j}`),
                frameOffset = integer(z.frameOffset, key + '.frameOffset', 0, 864000);
              if (!Array.isArray(z.tracks) || z.tracks.length > 8192) fail(key + '.tracks');
              const ids = new Set<number>();
              const tracks = (z.tracks as unknown[]).map((q): [number, number, number] => {
                if (!Array.isArray(q) || q.length !== 3) fail(key + '.track');
                const t = q as unknown[];
                const id = integer(t[0], key + '.track.id', 0, 1048575);
                if (ids.has(id)) fail(key + '.track.duplicate');
                ids.add(id);
                return [
                  id,
                  n(t[1], key + '.track.x', -1080, 2160),
                  n(t[2], key + '.track.y', -1920, 7680),
                ];
              });
              return { frameOffset, tracks };
            });
            if (frames.some((f, j) => j > 0 && f.frameOffset <= frames[j - 1]!.frameOffset))
              fail(key + '.frames.order');
            const motion: BlockCrushDropObservedFragmentMotionProfile = {
              coordinateSpace: 'source-stage-pixels',
              canonicalFps: integer(m.canonicalFps, key + '.canonicalFps', 1, 240),
              gridX: n(m.gridX, key + '.gridX', -1080, 2160),
              gridTop: n(m.gridTop, key + '.gridTop', -1920, 3840),
              cellPitch: n(m.cellPitch, key + '.cellPitch', 1, 270),
              subColumns: integer(m.subColumns, key + '.subColumns', 1, 256),
              minimumTracksPerSubColumn: integer(
                m.minimumTracksPerSubColumn,
                key + '.minimumTracksPerSubColumn',
                1,
                32,
              ),
              ...(m.interpolationMinimumCoverage === undefined
                ? {}
                : {
                    interpolationMinimumCoverage: n(
                      m.interpolationMinimumCoverage,
                      key + '.coverage',
                      0,
                      1,
                    ),
                  }),
              frames,
            };
            return { actionIndex, cycleIndex, motion };
          });
        })();

  if (
    clear?.fragmentGeometry === 'partitioned-solid' &&
    (!observedFragmentMotionCues?.length ||
      observedFragmentMotionCues.some((c) => !isDropObservedFragmentMotionV2(c.motion)))
  )
    fail(
      'clear.partitioned-solid requires matching observed V2 cues; procedural motion is unsupported',
    );
  if (
    clear?.fragmentPerspectiveCamera &&
    ((clear.fragmentGeometry !== 'pyramid-quarter' &&
      !(
        clear.fragmentGeometry === 'rounded-cube' &&
        clear.fragmentDepthRenderer === 'webgl-opaque' &&
        clear.fragmentCubeFrontUvMapping === 'mother-plane'
      )) ||
      !observedFragmentMotionCues?.length ||
      observedFragmentMotionCues.some((c) => !isDropObservedFragmentMotionV2(c.motion)))
  )
    fail(
      'clear.fragmentPerspectiveCamera requires pyramid-quarter or explicit opaque mother-plane rounded-cube and matching observed V2 cues; procedural motion is unsupported',
    );
  if (clear?.fragmentDepthRenderer) {
    if (
      !['pyramid-quarter', 'rounded-cube'].includes(clear.fragmentGeometry ?? '') ||
      !clear.fragmentPerspectiveCamera ||
      clear.subdivisions !== 2 ||
      (clear.fragmentDepthLayers ?? 1) !== 1 ||
      (clear.fragmentGeometry === 'rounded-cube' &&
        clear.fragmentCubeFrontUvMapping !== 'mother-plane') ||
      !observedFragmentMotionCues?.length ||
      observedFragmentMotionCues.some(
        (c) =>
          !isDropObservedFragmentMotionV2(c.motion) ||
          (isDropObservedFragmentMotionV2(c.motion) &&
            (c.motion.subdivisions !== 2 || c.motion.particles.some((p) => p.depthIndex !== 0))),
      )
    )
      fail(
        'clear.fragmentDepthRenderer requires perspective n2/one-depth pyramid-quarter or mother-plane rounded-cube and observed V2',
      );
    if (
      observedFragmentMotionCues?.some(
        (c) =>
          isDropObservedFragmentMotionV2(c.motion) &&
          c.motion.particles.some((p) => p.keys.some((k) => (k[8] ?? 1) !== 1)),
      )
    )
      fail('clear.fragmentDepthRenderer requires all opacity keys 1');
  }
  const range = (v: Record<string, unknown>) => {
    const startSeconds = n(v.startSeconds, 'startSeconds', 0, 3600),
      endSeconds = n(v.endSeconds, 'endSeconds', 0, 3600);
    if (endSeconds <= startSeconds) fail('timeRange');
    return { startSeconds, endSeconds };
  };
  const introCellCues: DropReferenceCalibration['introCellCues'] =
    r.introCellCues === undefined
      ? undefined
      : (() => {
          if (!Array.isArray(r.introCellCues) || r.introCellCues.length > 2048)
            fail('introCellCues');
          const seen = new Set<string>();
          return (r.introCellCues as unknown[]).map((v, i) => {
            const q = obj(
                v,
                ['id', 'x', 'y', 'color', 'startSeconds', 'endSeconds', 'shatterSeconds'],
                `introCellCues.${i}`,
              ),
              id = str(q.id, 'introCellCues.id');
            if (!id || seen.has(id)) fail('introCellCues.id');
            seen.add(id);
            const x = n(q.x, 'introCellCues.x', 0, 31),
              y = n(q.y, 'introCellCues.y', -32, 96);
            if (!Number.isInteger(x) || !Number.isInteger(y)) fail('introCellCues.grid');
            return {
              id,
              x,
              y,
              color: hex(q.color, 'introCellCues.color'),
              ...range(q),
              shatterSeconds: n(q.shatterSeconds, 'introCellCues.shatterSeconds', 0, 4),
            };
          });
        })();
  if (r.guidance !== undefined && (!Array.isArray(r.guidance) || r.guidance.length > 200))
    fail('guidance');
  const guidance =
    r.guidance === undefined
      ? undefined
      : (r.guidance as unknown[]).map((v, i) => {
          const g = obj(
            v,
            [
              'id',
              'text',
              'startSeconds',
              'endSeconds',
              'x',
              'y',
              'size',
              'color',
              'outline',
              'outlineWidth',
              'align',
              'weight',
              'fadeSeconds',
            ],
            `guidance.${i}`,
          );
          if (
            !['left', 'center', 'right'].includes(String(g.align)) ||
            !['normal', 'bold'].includes(String(g.weight))
          )
            fail('guidance.style');
          if (typeof g.text !== 'string' || g.text.length < 1 || g.text.length > 500)
            fail('guidance.text');
          return {
            id: str(g.id, 'guidance.id'),
            text: g.text as string,
            ...range(g),
            x: n(g.x, 'guidance.x', -1080, 2160),
            y: n(g.y, 'guidance.y', -1920, 3840),
            size: n(g.size, 'guidance.size', 8, 240),
            color: hex(g.color, 'guidance.color'),
            outline: hex(g.outline, 'guidance.outline'),
            outlineWidth: n(g.outlineWidth, 'guidance.outlineWidth', 0, 30),
            align: g.align as 'left' | 'center' | 'right',
            weight: g.weight as 'normal' | 'bold',
            fadeSeconds: n(g.fadeSeconds, 'guidance.fadeSeconds', 0, 3),
          };
        });
  if (guidance && new Set(guidance.map((g) => g.id)).size !== guidance.length)
    fail('guidance.duplicate');
  if (
    r.queuePreviews !== undefined &&
    (!Array.isArray(r.queuePreviews) || r.queuePreviews.length > 1000)
  )
    fail('queuePreviews');
  const queuePreviews =
    r.queuePreviews === undefined
      ? undefined
      : (r.queuePreviews as unknown[]).map((v, i) => {
          const q = obj(
            v,
            ['pieceId', 'startSeconds', 'endSeconds', 'x', 'y', 'scale', 'quarterTurns'],
            `queuePreviews.${i}`,
          );
          const k = n(q.quarterTurns, 'quarterTurns', 0, 3);
          if (!Number.isInteger(k)) fail('quarterTurns');
          return {
            pieceId: str(q.pieceId, 'queuePreviews.pieceId'),
            ...range(q),
            x: n(q.x, 'queuePreviews.x', -1080, 2160),
            y: n(q.y, 'queuePreviews.y', -1920, 3840),
            scale: n(q.scale, 'queuePreviews.scale', 0.1, 2),
            quarterTurns: k as 0 | 1 | 2 | 3,
          };
        });
  let faceShading: DropReferenceCalibration['faceShading'];
  if (r.faceShading !== undefined) {
    const s = obj(r.faceShading, ['top', 'left', 'right', 'bottom'], 'faceShading');
    faceShading = {
      top: n(s.top, 'faceShading.top', 0.1, 2),
      left: n(s.left, 'faceShading.left', 0.1, 2),
      right: n(s.right, 'faceShading.right', 0.1, 2),
      bottom: n(s.bottom, 'faceShading.bottom', 0.1, 2),
    };
  }
  const ordered = (samples: Array<{ seconds: number }>, key: string) => {
    if (samples.some((s, i) => i > 0 && s.seconds <= samples[i - 1]!.seconds)) fail(key + '.times');
  };
  const fieldRiseOffsetKeys: DropReferenceCalibration['fieldRiseOffsetKeys'] =
    r.fieldRiseOffsetKeys === undefined
      ? undefined
      : (() => {
          if (
            !Array.isArray(r.fieldRiseOffsetKeys) ||
            r.fieldRiseOffsetKeys.length < 2 ||
            r.fieldRiseOffsetKeys.length > 4096
          )
            fail('fieldRiseOffsetKeys');
          const keys = (r.fieldRiseOffsetKeys as unknown[]).map((v) => {
            const k = obj(v, ['canonicalFrame', 'offsetCells'], 'fieldRiseOffsetKeys');
            return {
              canonicalFrame: n(
                k.canonicalFrame,
                'fieldRiseOffsetKeys.canonicalFrame',
                0,
                100_000_000,
              ),
              offsetCells: n(k.offsetCells, 'fieldRiseOffsetKeys.offsetCells', -1, 1),
            };
          });
          if (keys.some((k, i) => i > 0 && k.canonicalFrame <= keys[i - 1]!.canonicalFrame))
            fail('fieldRiseOffsetKeys.times');
          if (keys[0]!.offsetCells !== 0 || keys.at(-1)!.offsetCells !== 0)
            fail('fieldRiseOffsetKeys.zeroEndpoints');
          return keys;
        })();
  const sceneSaturationKeys =
    r.sceneSaturationKeys === undefined
      ? undefined
      : (() => {
          if (
            !Array.isArray(r.sceneSaturationKeys) ||
            !r.sceneSaturationKeys.length ||
            r.sceneSaturationKeys.length > 6000
          )
            fail('sceneSaturationKeys');
          const keys = (r.sceneSaturationKeys as unknown[]).map((v) => {
            const k = obj(v, ['seconds', 'value'], 'sceneSaturationKeys');
            return {
              seconds: n(k.seconds, 'seconds', 0, 3600),
              value: n(k.value, 'saturation', 0, 1),
            };
          });
          ordered(keys, 'sceneSaturationKeys');
          return keys;
        })();
  if (
    r.boardColorKeys !== undefined &&
    (!Array.isArray(r.boardColorKeys) || !r.boardColorKeys.length || r.boardColorKeys.length > 6000)
  )
    fail('boardColorKeys');
  const boardColorKeys =
    r.boardColorKeys === undefined
      ? undefined
      : (r.boardColorKeys as unknown[]).map((v) => {
          const k = obj(v, ['seconds', 'color'], 'boardColorKey');
          return { seconds: n(k.seconds, 'seconds', 0, 3600), color: hex(k.color, 'color') };
        });
  if (boardColorKeys) ordered(boardColorKeys, 'boardColorKeys');
  const cellColorKeys: DropReferenceCalibration['cellColorKeys'] =
    r.cellColorKeys === undefined
      ? undefined
      : (() => {
          if (
            !Array.isArray(r.cellColorKeys) ||
            !r.cellColorKeys.length ||
            r.cellColorKeys.length > 10000
          )
            fail('cellColorKeys');
          const previous = new Map<string, number>();
          return (r.cellColorKeys as unknown[]).map((v) => {
            const k = obj(v, ['id', 'seconds', 'color'], 'cellColorKey');
            if (typeof k.id !== 'string' || !k.id || k.id.length > 160) fail('cellColorKeys.id');
            const id = k.id as string,
              seconds = n(k.seconds, 'cellColorKeys.seconds', 0, 3600);
            if (seconds <= (previous.get(id) ?? -1)) fail('cellColorKeys.times');
            previous.set(id, seconds);
            return { id, seconds, color: hex(k.color, 'cellColorKeys.color') };
          });
        })();
  let screenVignette: DropReferenceCalibration['screenVignette'];
  if (r.screenVignette !== undefined) {
    const v = obj(r.screenVignette, ['color', 'inset', 'samples'], 'screenVignette');
    if (!Array.isArray(v.samples) || !v.samples.length || v.samples.length > 6000)
      fail('screenVignette.samples');
    const samples = (v.samples as unknown[]).map((k) => {
      const z = obj(k, ['seconds', 'opacity'], 'screenVignette.sample');
      return { seconds: n(z.seconds, 'seconds', 0, 3600), opacity: n(z.opacity, 'opacity', 0, 1) };
    });
    ordered(samples, 'screenVignette.samples');
    screenVignette = {
      color: hex(v.color, 'screenVignette.color'),
      inset: n(v.inset, 'screenVignette.inset', 0.01, 0.49),
      samples,
    };
  }
  if (
    r.counterTracks !== undefined &&
    (!Array.isArray(r.counterTracks) || r.counterTracks.length > 32)
  )
    fail('counterTracks');
  const counterTracks =
    r.counterTracks === undefined
      ? undefined
      : (r.counterTracks as unknown[]).map((v) => {
          const t = obj(
            v,
            [
              'textColorKeys',
              'format',
              'font',
              'align',
              'id',
              'x',
              'y',
              'iconSize',
              'fontSize',
              'color',
              'samples',
            ],
            'counterTrack',
          );
          if (
            t.format !== undefined &&
            !['integer', 'centiseconds', 'seconds-sixtieths'].includes(String(t.format))
          )
            fail('counter.format');
          if (t.font !== undefined && !['sans-serif', 'serif'].includes(String(t.font)))
            fail('counter.font');
          if (t.align !== undefined && !['left', 'center', 'right'].includes(String(t.align)))
            fail('counter.align');
          if (!Array.isArray(t.samples) || !t.samples.length || t.samples.length > 10000)
            fail('counterTrack.samples');
          const samples = (t.samples as unknown[]).map((v) => {
            const k = obj(v, ['seconds', 'value'], 'counterSample');
            return {
              seconds: n(k.seconds, 'seconds', 0, 3600),
              value: n(k.value, 'value', 0, 1e12),
            };
          });
          ordered(samples, 'counterSamples');
          let textColorKeys: Array<{ seconds: number; color: string }> | undefined;
          if (t.textColorKeys !== undefined) {
            if (
              !Array.isArray(t.textColorKeys) ||
              !t.textColorKeys.length ||
              t.textColorKeys.length > 1000
            )
              fail('counter.textColorKeys');
            textColorKeys = (t.textColorKeys as unknown[]).map((z) => {
              const k = obj(z, ['seconds', 'color'], 'counter.textColorKey');
              return { seconds: n(k.seconds, 'seconds', 0, 3600), color: hex(k.color, 'color') };
            });
            ordered(textColorKeys, 'counter.textColorKeys');
          }
          return {
            ...(textColorKeys ? { textColorKeys } : {}),
            ...(t.format === undefined
              ? {}
              : { format: t.format as 'integer' | 'centiseconds' | 'seconds-sixtieths' }),
            ...(t.font === undefined ? {} : { font: t.font as 'sans-serif' | 'serif' }),
            ...(t.align === undefined ? {} : { align: t.align as 'left' | 'center' | 'right' }),
            id: str(t.id, 'id'),
            x: n(t.x, 'x', -1080, 2160),
            y: n(t.y, 'y', -1920, 3840),
            iconSize: n(t.iconSize, 'iconSize', 0, 240),
            fontSize: n(t.fontSize, 'fontSize', 8, 120),
            color: hex(t.color, 'color'),
            samples,
          };
        });
  if (counterTracks && new Set(counterTracks.map((t) => t.id)).size !== counterTracks.length)
    fail('counterTracks.duplicate');
  if (r.spriteCues !== undefined && (!Array.isArray(r.spriteCues) || r.spriteCues.length > 1000))
    fail('spriteCues');
  const spriteCues =
    r.spriteCues === undefined
      ? undefined
      : (r.spriteCues as unknown[]).map((v) => {
          const q = obj(
            v,
            [
              'atlasSlot',
              'layer',
              'preserveColor',
              'animation',
              'clipToBoard',
              'id',
              'startSeconds',
              'endSeconds',
              'x',
              'y',
              'width',
              'height',
              'sourceX',
              'sourceY',
              'sourceWidth',
              'sourceHeight',
              'fadeInSeconds',
              'fadeOutSeconds',
            ],
            'spriteCue',
          );
          let animation: NonNullable<DropReferenceCalibration['spriteCues']>[number]['animation'];
          if (q.animation !== undefined) {
            const z = obj(
              q.animation,
              ['frames', 'columns', 'frameSeconds', 'loop'],
              'sprite.animation',
            );
            const frames = n(z.frames, 'sprite.animation.frames', 1, 1000),
              columns = n(z.columns, 'sprite.animation.columns', 1, 1000);
            if (
              !Number.isInteger(frames) ||
              !Number.isInteger(columns) ||
              typeof z.loop !== 'boolean'
            )
              fail('sprite.animation');
            animation = {
              frames,
              columns,
              frameSeconds: n(z.frameSeconds, 'sprite.animation.frameSeconds', 1 / 240, 10),
              loop: z.loop as boolean,
            };
          }
          if (
            q.atlasSlot !== undefined &&
            !DROP_UI_ATLAS_SLOTS.includes(q.atlasSlot as DropUiAtlasSlot)
          )
            fail('spriteCue.atlasSlot');
          if (q.layer !== undefined && !['background', 'overlay'].includes(String(q.layer)))
            fail('spriteCue.layer');
          if (q.clipToBoard !== undefined && typeof q.clipToBoard !== 'boolean')
            fail('spriteCue.clipToBoard');
          if (q.preserveColor !== undefined && typeof q.preserveColor !== 'boolean')
            fail('spriteCue.preserveColor');
          return {
            ...(q.atlasSlot === undefined ? {} : { atlasSlot: q.atlasSlot as DropUiAtlasSlot }),
            ...(q.layer === undefined ? {} : { layer: q.layer as 'background' | 'overlay' }),
            ...(q.preserveColor === undefined ? {} : { preserveColor: q.preserveColor as boolean }),
            ...(animation ? { animation } : {}),
            ...(q.clipToBoard === undefined ? {} : { clipToBoard: q.clipToBoard as boolean }),
            id: str(q.id, 'id'),
            ...range(q),
            x: n(q.x, 'x', -1080, 2160),
            y: n(q.y, 'y', -1920, 3840),
            width: n(q.width, 'width', 1, 1080),
            height: n(q.height, 'height', 1, q.layer === 'background' ? 1920 : 500),
            sourceX: n(q.sourceX, 'sourceX', 0, 16384),
            sourceY: n(q.sourceY, 'sourceY', 0, 16384),
            sourceWidth: n(q.sourceWidth, 'sourceWidth', 1, 4096),
            sourceHeight: n(q.sourceHeight, 'sourceHeight', 1, 4096),
            fadeInSeconds: n(q.fadeInSeconds, 'fadeInSeconds', 0, 3),
            fadeOutSeconds: n(q.fadeOutSeconds, 'fadeOutSeconds', 0, 3),
          };
        });
  if (spriteCues && new Set(spriteCues.map((c) => c.id)).size !== spriteCues.length)
    fail('spriteCues.duplicate');
  const fallTrail =
    r.fallTrail === undefined
      ? undefined
      : (() => {
          const z = obj(
            r.fallTrail,
            ['color', 'opacity', 'lengthPixels', 'minSpeedPixelsPerSecond'],
            'fallTrail',
          );
          return {
            color: hex(z.color, 'fallTrail.color'),
            opacity: n(z.opacity, 'fallTrail.opacity', 0, 1),
            lengthPixels: n(z.lengthPixels, 'fallTrail.lengthPixels', 0, 1000),
            minSpeedPixelsPerSecond: n(
              z.minSpeedPixelsPerSecond,
              'fallTrail.minSpeedPixelsPerSecond',
              0,
              10000,
            ),
          };
        })();
  const tracks = r.pieceTracks;
  if (tracks !== undefined && (!Array.isArray(tracks) || tracks.length > 500)) fail('pieceTracks');
  const pieceTracks =
    tracks === undefined
      ? undefined
      : (tracks as unknown[]).map((v, i) => {
          const t = obj(
              v,
              [
                'actionIndex',
                'pieceId',
                'uncommitted',
                'previewOnly',
                'surfaceOrientation',
                'samples',
              ],
              `pieceTracks.${i}`,
            ),
            actionIndex = n(t.actionIndex, 'actionIndex', 0, 499);
          if (
            !Number.isInteger(actionIndex) ||
            !Array.isArray(t.samples) ||
            t.samples.length < 2 ||
            t.samples.length > 6000
          )
            fail('track.samples');
          const samples = (t.samples as unknown[]).map((v) => {
            const s = obj(v, ['seconds', 'x', 'y', 'angle', 'scaleX', 'scaleY'], 'sample');
            return {
              seconds: n(s.seconds, 'seconds', 0, 3600),
              x: n(s.x, 'x', -1080, 2160),
              y: n(s.y, 'y', -1920, 3840),
              angle: n(s.angle, 'angle', -36000, 36000),
              ...(s.scaleX === undefined ? {} : { scaleX: n(s.scaleX, 'scaleX', -2, 2) }),
              ...(s.scaleY === undefined ? {} : { scaleY: n(s.scaleY, 'scaleY', -2, 2) }),
            };
          });
          if (samples.some((s, j) => j > 0 && s.seconds <= samples[j - 1]!.seconds))
            fail('sample.times');
          if (t.uncommitted !== undefined && t.uncommitted !== true) fail('track.uncommitted');
          if (
            t.previewOnly !== undefined &&
            (t.previewOnly !== true || typeof t.pieceId !== 'string' || !t.pieceId)
          )
            fail('track.previewOnly');
          if (
            t.surfaceOrientation !== undefined &&
            !['piece', 'world'].includes(t.surfaceOrientation as string)
          )
            fail('track.surfaceOrientation');
          return {
            actionIndex,
            ...(t.surfaceOrientation === undefined
              ? {}
              : { surfaceOrientation: t.surfaceOrientation as 'piece' | 'world' }),
            ...(t.previewOnly ? { previewOnly: true as const } : {}),
            ...(t.uncommitted ? { uncommitted: true as const } : {}),
            ...(t.pieceId === undefined ? {} : { pieceId: str(t.pieceId, 'pieceId') }),
            samples,
          };
        });
  if (pieceTracks && new Set(pieceTracks.map((t) => t.actionIndex)).size !== pieceTracks.length)
    fail('track.duplicate');
  validateNativeInertialCalibration({ clear, observedFragmentMotionCues, fieldRiseOffsetKeys });
  return {
    version: 1,
    ...(r.respectPieceTrackWindows === undefined
      ? {}
      : { respectPieceTrackWindows: r.respectPieceTrackWindows as boolean }),
    ...(impactBeamCues === undefined ? {} : { impactBeamCues }),
    ...(landingSurfaceFlashCues?.length ? { landingSurfaceFlashCues } : {}),
    ...(encouragementGlyphCues?.length ? { encouragementGlyphCues } : {}),
    ...(fieldRiseOffsetKeys ? { fieldRiseOffsetKeys } : {}),
    ...(observedFragmentMotionCues ? { observedFragmentMotionCues } : {}),
    ...(cellColorKeys ? { cellColorKeys } : {}),
    ...(incomingCellColors ? { incomingCellColors } : {}),
    ...(incomingRowColors ? { incomingRowColors } : {}),
    ...(tilePaletteLighting ? { tilePaletteLighting } : {}),
    ...(fallTrail ? { fallTrail } : {}),
    ...(sceneSaturationKeys ? { sceneSaturationKeys } : {}),
    ...(r.paletteDepth === undefined
      ? {}
      : { paletteDepth: n(r.paletteDepth, 'paletteDepth', 0, 0.5) }),
    ...(r.airbornePaletteDepth === undefined
      ? {}
      : { airbornePaletteDepth: n(r.airbornePaletteDepth, 'airbornePaletteDepth', 0, 0.5) }),
    ...(r.paletteDepthColor === undefined
      ? {}
      : { paletteDepthColor: hex(r.paletteDepthColor, 'paletteDepthColor') }),
    ...(introCellCues ? { introCellCues } : {}),
    ...(screenVignette ? { screenVignette } : {}),
    ...(spriteCues ? { spriteCues } : {}),
    ...(boardColorKeys ? { boardColorKeys } : {}),
    ...(counterTracks ? { counterTracks } : {}),
    ...(tilePaletteCropPixels ? { tilePaletteCropPixels } : {}),
    ...(r.landingColorSeconds === undefined
      ? {}
      : { landingColorSeconds: n(r.landingColorSeconds, 'landingColorSeconds', 0, 0.5) }),
    ...(tilePaletteColors ? { tilePaletteColors } : {}),
    ...(faceShading ? { faceShading } : {}),
    ...(guidance ? { guidance } : {}),
    ...(queuePreviews ? { queuePreviews } : {}),
    ...(clear ? { clear } : {}),
    ...(r.colorMode ? { colorMode: r.colorMode as 'identity' | 'columns' } : {}),
    ...(pieceTracks ? { pieceTracks } : {}),
    board: {
      ...(b.verticalLines === undefined ? {} : { verticalLines: b.verticalLines as boolean }),
      ...(b.verticalScale === undefined
        ? {}
        : { verticalScale: n(b.verticalScale, 'board.verticalScale', 0.5, 2) }),
      ...(b.gridY === undefined ? {} : { gridY: n(b.gridY, 'board.gridY', -1920, 1920) }),
      ...(b.lineWidth === undefined
        ? {}
        : { lineWidth: n(b.lineWidth, 'board.lineWidth', 0.1, 12) }),
      ...(b.height === undefined ? {} : { height: n(b.height, 'board.height', 1, 1920) }),
      x: n(b.x, 'board.x', -1080, 1080),
      y: n(b.y, 'board.y', -1920, 1920),
      cell: n(b.cell, 'board.cell', 8, 270),
      background: hex(b.background, 'board.background'),
      line: hex(b.line, 'board.line'),
      horizontalLines: b.horizontalLines as boolean,
    },
    background: hex(r.background, 'background'),
    material: r.material as DropReferenceCalibration['material'],
    tileColor: hex(r.tileColor, 'tileColor'),
    ...(r.columnColors === undefined
      ? {}
      : { columnColors: (r.columnColors as unknown[]).map((c, i) => hex(c, `columnColors.${i}`)) }),
    hud: {
      kind: h.kind as DropReferenceCalibration['hud']['kind'],
      ...(h.scoreLabelSize === undefined
        ? {}
        : { scoreLabelSize: n(h.scoreLabelSize, 'hud.scoreLabelSize', 8, 100) }),
      height: n(h.height, 'hud.height', 0, 500),
      background: hex(h.background, 'hud.background'),
      color: hex(h.color, 'hud.color'),
      levelLabel: str(h.levelLabel, 'hud.levelLabel'),
      level: str(h.level, 'hud.level'),
      scoreLabel: str(h.scoreLabel, 'hud.scoreLabel'),
      initialScore: n(h.initialScore, 'hud.initialScore', 0, 1e12),
      ...(h.scoreCeiling === undefined
        ? {}
        : { scoreCeiling: n(h.scoreCeiling, 'hud.scoreCeiling', 0, 1e12) }),
      countdown: n(h.countdown, 'hud.countdown', 0, 86400),
    },
    queue: {
      visible: q.visible as boolean,
      y: n(q.y, 'queue.y', 0, 1920),
      scale: n(q.scale, 'queue.scale', 0.1, 2),
    },
    bevel: n(r.bevel, 'bevel', 0, 0.45),
    seam: n(r.seam, 'seam', 0, 0.1),
    shadow: n(r.shadow, 'shadow', 0, 2),
  };
}

const colorSchema = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
const numberSchema = (minimum: number, maximum: number) => ({ type: 'number', minimum, maximum });
// A positive union is understood by both JSON Schema and the public transport's
// smaller validator. `not` would silently admit the all-zero light vector there.
const fragmentLightDirectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'z'],
  properties: { x: numberSchema(-1, 1), y: numberSchema(-1, 1), z: numberSchema(-1, 1) },
  anyOf: ['x', 'y', 'z'].flatMap((axis) => [
    { properties: { [axis]: numberSchema(Number.MIN_VALUE, 1) } },
    { properties: { [axis]: numberSchema(-1, -Number.MIN_VALUE) } },
  ]),
};
// The public Agent transport deliberately supports a small structural schema
// vocabulary. Use two disjoint positive shapes (not `not`/conditionals) so its
// oneOf check agrees with JSON Schema on optional measured thickness timelines.
const layeredCurveKeyProperties = {
  seconds: numberSchema(0, 5),
  centerDropPixels: numberSchema(-500, 10000),
  midDropPixels: numberSchema(-500, 10000),
  edgeDropPixels: numberSchema(-500, 10000),
};
const layeredCurveThicknessProperties = {
  centerThickness: numberSchema(0.5, 12),
  midThickness: numberSchema(0.5, 12),
  edgeThickness: numberSchema(0.5, 12),
};
const layeredCurveKeysSchema = {
  type: 'array',
  minItems: 1,
  maxItems: 64,
  oneOf: [
    {
      items: {
        type: 'object',
        additionalProperties: false,
        required: Object.keys(layeredCurveKeyProperties),
        properties: layeredCurveKeyProperties,
      },
    },
    {
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          ...Object.keys(layeredCurveKeyProperties),
          ...Object.keys(layeredCurveThicknessProperties),
        ],
        properties: { ...layeredCurveKeyProperties, ...layeredCurveThicknessProperties },
      },
    },
  ],
};
// Positive alternatives work in the platform validator as well as JSON Schema;
// no unsupported `not` condition is needed to require explicit measured waves.
// Rounded irregular solids have no UV or separate native/depth renderer yet.
// Keep the public structural checker and parser on the same explicit boundary.
const roundedPolyhedronSchema = {
  anyOf: [
    {
      properties: {
        clear: {
          properties: {
            fragmentGeometry: {
              enum: [
                'flat-shard',
                'faceted-chip',
                'faceted-rock',
                'rounded-rock',
                'textured-chip',
                'textured-cube',
                'rounded-cube',
                'fractured-block',
                'fractured-volume',
                'relief-cube',
                'pyramid-quarter',
                'partitioned-solid',
              ],
            },
          },
        },
      },
    },
    {
      required: ['clear'],
      properties: {
        clear: {
          required: ['fragmentGeometry', 'fragmentSurface', 'motionModel'],
          properties: {
            fragmentGeometry: { const: 'rounded-polyhedron' },
            fragmentSurface: { const: 'solid' },
            fragmentShading: { const: 'material' },
            motionModel: { const: 'ballistic' },
            fragmentPhysics: {
              properties: {
                sheetDetachSeconds: { type: 'null' },
                sheetDetachAfterReleaseSeconds: { type: 'null' },
              },
            },
            nativeInertial: { const: false },
            fragmentCubeFrontUvMapping: { type: 'null' },
            fragmentVolumeSeedPattern: { type: 'null' },
            fragmentDepthLayers: { type: 'null' },
            fragmentDepthRenderer: { type: 'null' },
            fragmentPerspectiveCamera: { type: 'null' },
            fragmentPartitionProfile: { type: 'null' },
          },
        },
        observedFragmentMotionCues: { maxItems: 0 },
      },
    },
  ],
};
const partitionedSolidObservedSchema = {
  anyOf: [
    {
      properties: {
        clear: {
          properties: {
            fragmentGeometry: {
              enum: [
                'flat-shard',
                'faceted-chip',
                'faceted-rock',
                'rounded-rock',
                'textured-chip',
                'textured-cube',
                'rounded-cube',
                'rounded-polyhedron',
                'fractured-block',
                'fractured-volume',
                'relief-cube',
                'pyramid-quarter',
              ],
            },
          },
        },
      },
    },
    {
      required: ['clear', 'observedFragmentMotionCues'],
      properties: {
        clear: {
          required: ['fragmentGeometry'],
          properties: { fragmentGeometry: { const: 'partitioned-solid' } },
        },
        observedFragmentMotionCues: {
          minItems: 1,
          items: {
            required: ['motion'],
            properties: {
              motion: {
                required: ['version', 'subdivisions', 'particles'],
                properties: {
                  version: { const: 2 },
                  subdivisions: { const: 2 },
                  particles: { items: { properties: { depthIndex: { const: 0 } } } },
                },
              },
            },
          },
        },
      },
    },
  ],
};
const fragmentPerspectiveCameraSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['focalLengthPixels', 'centerX', 'centerY', 'referencePlaneDepthPixels'],
  properties: {
    focalLengthPixels: numberSchema(1, 1e6),
    centerX: numberSchema(-1e6, 1e6),
    centerY: numberSchema(-1e6, 1e6),
    referencePlaneDepthPixels: numberSchema(-1e6, 1e6),
  },
};
// Positive closed alternatives also enforce this opt-in at the public boundary.
const pyramidPerspectiveObservedSchema = {
  anyOf: [
    { properties: { clear: { properties: { fragmentPerspectiveCamera: { type: 'null' } } } } },
    {
      required: ['clear', 'observedFragmentMotionCues'],
      properties: {
        clear: {
          required: ['fragmentGeometry', 'fragmentPerspectiveCamera'],
          properties: { fragmentGeometry: { const: 'pyramid-quarter' } },
        },
        observedFragmentMotionCues: {
          minItems: 1,
          items: {
            required: ['motion'],
            properties: {
              motion: {
                required: ['version', 'subdivisions', 'particles'],
                properties: {
                  version: { const: 2 },
                  subdivisions: { const: 2 },
                  particles: { items: { properties: { depthIndex: { const: 0 } } } },
                },
              },
            },
          },
        },
      },
    },
    {
      required: ['clear', 'observedFragmentMotionCues'],
      properties: {
        clear: {
          required: [
            'fragmentGeometry',
            'fragmentPerspectiveCamera',
            'fragmentDepthRenderer',
            'fragmentCubeFrontUvMapping',
          ],
          properties: {
            fragmentGeometry: { const: 'rounded-cube' },
            fragmentDepthRenderer: { const: 'webgl-opaque' },
            fragmentCubeFrontUvMapping: { const: 'mother-plane' },
          },
        },
        observedFragmentMotionCues: {
          minItems: 1,
          items: {
            required: ['motion'],
            properties: {
              motion: {
                required: ['version', 'subdivisions', 'particles'],
                properties: {
                  version: { const: 2 },
                  subdivisions: { const: 2 },
                  particles: { items: { properties: { depthIndex: { const: 0 } } } },
                },
              },
            },
          },
        },
      },
    },
  ],
};
const opaqueObservedDepthSchema = {
  anyOf: [
    { properties: { clear: { properties: { fragmentDepthRenderer: { type: 'null' } } } } },
    {
      required: ['clear', 'observedFragmentMotionCues'],
      properties: {
        clear: {
          required: ['fragmentDepthRenderer', 'fragmentGeometry', 'fragmentPerspectiveCamera'],
          properties: {
            fragmentDepthRenderer: { const: 'webgl-opaque' },
            fragmentGeometry: { enum: ['pyramid-quarter', 'rounded-cube'] },
            subdivisions: { const: 2 },
            fragmentDepthLayers: { const: 1 },
          },
        },
        observedFragmentMotionCues: {
          minItems: 1,
          items: {
            properties: {
              motion: {
                properties: {
                  particles: {
                    items: {
                      properties: {
                        keys: {
                          items: { prefixItems: [{}, {}, {}, {}, {}, {}, {}, {}, { const: 1 }] },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  ],
};
// Positive alternatives also work with the platform's structural schema checker,
// which intentionally does not implement JSON Schema if/not conditionals.
const plainBallisticDisplaySchema = {
  required: ['fragmentDisplayFps', 'motionModel', 'fragmentPhysics', 'fragmentGeometry'],
  properties: {
    motionModel: { const: 'ballistic' },
    fragmentGeometry: { enum: ['rounded-cube', 'rounded-polyhedron'] },
    fragmentPhysics: {
      properties: {
        sheetDetachSeconds: { type: 'null' },
        sheetDetachAfterReleaseSeconds: { type: 'null' },
      },
    },
    layeredCurve: { type: 'null' },
    fragmentDepthRenderer: { type: 'null' },
    fragmentPerspectiveCamera: { type: 'null' },
    fragmentDepthLayers: { const: 1 },
    prefractureRefineSeconds: { type: 'null' },
  },
};
const fragmentDisplayClockSchema = {
  anyOf: [
    { properties: { fragmentDisplayFps: { type: 'null' } } },
    {
      required: ['fragmentDisplayFps', 'motionModel', 'fragmentPhysics'],
      properties: {
        motionModel: { const: 'constrained-sheet' },
        fragmentPhysics: { required: ['sheetDetachAfterReleaseSeconds'] },
      },
    },
    plainBallisticDisplaySchema,
  ],
};
// New controls require the actual consumer path, including explicit legacy powers.
const ballisticPrefractureProfileSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'coarseSubdivisions',
    'coarseScale',
    'refineAfterReleaseSeconds',
    'retainedCoarseFraction',
  ],
  properties: {
    coarseSubdivisions: { type: 'integer', minimum: 1, maximum: 7 },
    coarseScale: numberSchema(0.5, 2),
    refineAfterReleaseSeconds: numberSchema(Number.MIN_VALUE, 2),
    retainedCoarseFraction: numberSchema(0, 0.25),
  },
};
const ballisticPrefractureLattices = Array.from({ length: 7 }, (_, i) => i + 2).flatMap((n) =>
  Array.from({ length: n - 1 }, (_, i) => i + 1)
    .filter((m) => n % m === 0)
    .map((m) => ({
      properties: {
        subdivisions: { const: n },
        ballisticPrefracture: { properties: { coarseSubdivisions: { const: m } } },
      },
    })),
);
const ballisticPrefractureSchema = {
  anyOf: [
    { properties: { ballisticPrefracture: { type: 'null' } } },
    {
      ...plainBallisticDisplaySchema,
      required: [...plainBallisticDisplaySchema.required, 'ballisticPrefracture', 'prefracture'],
      allOf: [{ anyOf: ballisticPrefractureLattices }],
      properties: {
        ...plainBallisticDisplaySchema.properties,
        prefracture: { const: false },
        fragmentSurface: { enum: ['tile', 'solid'] },
        ballisticPrefracture: ballisticPrefractureProfileSchema,
      },
    },
  ],
};
const sheetLiftFalloffSchema = {
  anyOf: [
    { properties: { sheetLiftFrontFalloffPower: { type: 'null' } } },
    {
      required: ['sheetLiftFrontFalloffPower', 'motionModel', 'fragmentPhysics'],
      properties: {
        motionModel: { const: 'constrained-sheet' },
        fragmentPhysics: { required: ['sheetDetachAfterReleaseSeconds'] },
      },
    },
  ],
};
const velocitySpreadPowerSchema = {
  anyOf: [
    {
      properties: {
        fragmentPhysics: {
          properties: {
            velocitySpreadPowerX: { type: 'null' },
            velocitySpreadPowerY: { type: 'null' },
          },
        },
      },
    },
    {
      ...plainBallisticDisplaySchema,
      properties: {
        ...plainBallisticDisplaySchema.properties,
        fragmentPhysics: {
          ...plainBallisticDisplaySchema.properties.fragmentPhysics,
          anyOf: [{ required: ['velocitySpreadPowerX'] }, { required: ['velocitySpreadPowerY'] }],
        },
      },
    },
  ],
};
// The parser also enforces the strict upper bound: the platform structural
// checker does not implement exclusiveMaximum, unlike full JSON Schema tools.
const fragmentDisplayPhaseSchema = {
  anyOf: [
    { properties: { fragmentDisplayPhaseSeconds: { type: 'null' } } },
    {
      required: ['fragmentDisplayPhaseSeconds', 'fragmentDisplayFps'],
      anyOf: Array.from({ length: 120 }, (_, i) => ({
        properties: {
          fragmentDisplayFps: { const: i + 1 },
          fragmentDisplayPhaseSeconds: {
            type: 'number',
            minimum: 0,
            exclusiveMaximum: 1 / (i + 1),
          },
        },
      })),
    },
  ],
};
const refinementLatticeAlternatives = Array.from({ length: 7 }, (_, i) => i + 2).flatMap((n) =>
  Array.from({ length: n - 1 }, (_, j) => j + 1)
    .filter((m) => n % m === 0)
    .map((m) => ({
      properties: { subdivisions: { const: n }, prefractureSubdivisions: { const: m } },
    })),
);
const prefractureRefinementSchema = {
  anyOf: [
    { properties: { prefractureRefineSeconds: { type: 'null' } } },
    {
      required: [
        'prefractureRefineSeconds',
        'prefracture',
        'prefractureSubdivisions',
        'motionModel',
        'fragmentPhysics',
      ],
      allOf: [{ anyOf: refinementLatticeAlternatives }],
      properties: {
        prefracture: { const: true },
        motionModel: { const: 'constrained-sheet' },
        fragmentPhysics: { required: ['sheetDetachAfterReleaseSeconds'] },
        fragmentSurface: { enum: ['tile', 'solid'] },
      },
    },
  ],
};
const localDetachClearSchema = {
  anyOf: [
    {
      properties: {
        fragmentPhysics: { properties: { sheetDetachAfterReleaseSeconds: { type: 'null' } } },
      },
    },
    {
      required: ['motionModel', 'fragmentPhysics'],
      allOf: [
        {
          anyOf: [
            ...Array.from({ length: 7 }, (_, i) => ({
              properties: {
                subdivisions: { const: i + 2 },
                prefractureSubdivisions: { const: i + 2 },
              },
            })),
            { required: ['prefractureRefineSeconds'], anyOf: refinementLatticeAlternatives },
          ],
        },
      ],
      properties: {
        motionModel: { const: 'constrained-sheet' },
        frontExponent: { const: 1 },
        fragmentDepthRenderer: { type: 'null' },
        fragmentPerspectiveCamera: { type: 'null' },
        fragmentGeometry: {
          enum: [
            'flat-shard',
            'faceted-chip',
            'faceted-rock',
            'rounded-rock',
            'textured-chip',
            'textured-cube',
            'rounded-cube',
            'rounded-polyhedron',
          ],
        },
        fragmentPhysics: {
          required: ['sheetDetachAfterReleaseSeconds'],
          properties: {
            initialVelocityX: { const: 0 },
            initialVelocityY: { const: 0 },
            velocitySpreadX: { const: 0 },
            velocitySpreadY: { const: 0 },
            sheetDetachSeconds: { type: 'null' },
          },
        },
      },
    },
  ],
};
export const DROP_REFERENCE_CALIBRATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'board',
    'background',
    'material',
    'tileColor',
    'hud',
    'queue',
    'bevel',
    'seam',
    'shadow',
  ],
  allOf: [
    {
      anyOf: [
        { properties: { clear: { properties: { followFieldRise: { const: false } } } } },
        {
          required: ['clear'],
          properties: {
            clear: {
              required: ['followFieldRise'],
              properties: { followFieldRise: { const: true } },
            },
            observedFragmentMotionCues: { maxItems: 0 },
          },
        },
      ],
    },
    {
      anyOf: [
        { properties: { clear: { properties: { fragmentMaterialTexture: { const: false } } } } },
        {
          required: ['clear'],
          properties: {
            clear: {
              required: ['fragmentMaterialTexture'],
              properties: { fragmentMaterialTexture: { const: true } },
            },
            observedFragmentMotionCues: {
              items: { properties: { motion: { properties: { version: { const: 1 } } } } },
            },
          },
        },
      ],
    },
    NATIVE_INERTIAL_CALIBRATION_SCHEMA,
    roundedPolyhedronSchema,
    partitionedSolidObservedSchema,
    pyramidPerspectiveObservedSchema,
    opaqueObservedDepthSchema,
    {
      anyOf: [
        { properties: { clear: { properties: { fragmentAgeOffsetSeconds: { const: 0 } } } } },
        {
          properties: {
            clear: {
              properties: {
                fragmentPhysics: {
                  properties: { sheetDetachAfterReleaseSeconds: { type: 'null' } },
                },
              },
            },
          },
        },
      ],
    },
    {
      anyOf: [
        { properties: { clear: { properties: { fragmentDisplayFps: { type: 'null' } } } } },
        {
          required: ['clear'],
          properties: {
            clear: { required: ['fragmentDisplayFps'] },
            observedFragmentMotionCues: { maxItems: 0 },
          },
        },
      ],
    },
    {
      anyOf: [
        {
          properties: {
            clear: {
              properties: {
                fragmentPhysics: {
                  properties: { sheetDetachAfterReleaseSeconds: { type: 'null' } },
                },
              },
            },
          },
        },
        {
          required: ['clear'],
          properties: {
            clear: {
              required: ['fragmentPhysics'],
              properties: { fragmentPhysics: { required: ['sheetDetachAfterReleaseSeconds'] } },
            },
            observedFragmentMotionCues: { maxItems: 0 },
          },
        },
      ],
    },
  ],
  properties: {
    impactBeamCues: DROP_IMPACT_BEAM_CUES_SCHEMA,
    landingSurfaceFlashCues: DROP_LANDING_SURFACE_FLASH_CUES_SCHEMA,
    encouragementGlyphCues: DROP_ENCOURAGEMENT_GLYPH_CUES_SCHEMA,
    observedFragmentMotionCues: {
      type: 'array',
      maxItems: 2048,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['actionIndex', 'cycleIndex', 'motion'],
        properties: {
          actionIndex: { type: 'integer', minimum: 0, maximum: 999 },
          cycleIndex: { type: 'integer', minimum: 0, maximum: 63 },
          motion: {
            oneOf: [
              DROP_OBSERVED_FRAGMENT_MOTION_V2_SCHEMA,
              {
                type: 'object',
                additionalProperties: false,
                required: [
                  'coordinateSpace',
                  'canonicalFps',
                  'gridX',
                  'gridTop',
                  'cellPitch',
                  'subColumns',
                  'minimumTracksPerSubColumn',
                  'frames',
                ],
                properties: {
                  coordinateSpace: { const: 'source-stage-pixels' },
                  canonicalFps: { type: 'integer', minimum: 1, maximum: 240 },
                  gridX: numberSchema(-1080, 2160),
                  gridTop: numberSchema(-1920, 3840),
                  cellPitch: numberSchema(1, 270),
                  subColumns: { type: 'integer', minimum: 1, maximum: 256 },
                  minimumTracksPerSubColumn: { type: 'integer', minimum: 1, maximum: 32 },
                  interpolationMinimumCoverage: numberSchema(0, 1),
                  frames: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 6000,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['frameOffset', 'tracks'],
                      properties: {
                        frameOffset: { type: 'integer', minimum: 0, maximum: 864000 },
                        tracks: {
                          type: 'array',
                          maxItems: 8192,
                          items: {
                            type: 'array',
                            minItems: 3,
                            maxItems: 3,
                            prefixItems: [
                              { type: 'integer', minimum: 0, maximum: 1048575 },
                              numberSchema(-1080, 2160),
                              numberSchema(-1920, 7680),
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
    fieldRiseOffsetKeys: {
      type: 'array',
      minItems: 2,
      maxItems: 4096,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['canonicalFrame', 'offsetCells'],
        properties: {
          canonicalFrame: numberSchema(0, 100_000_000),
          offsetCells: numberSchema(-1, 1),
        },
      },
    },
    sceneSaturationKeys: {
      type: 'array',
      minItems: 1,
      maxItems: 6000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['seconds', 'value'],
        properties: { seconds: numberSchema(0, 3600), value: numberSchema(0, 1) },
      },
    },
    tilePaletteLighting: {
      type: 'object',
      additionalProperties: false,
      required: ['rows', 'top', 'bottom'],
      properties: {
        rows: { type: 'integer', minimum: 2, maximum: 64 },
        top: numberSchema(-1920, 3840),
        bottom: numberSchema(-1920, 3840),
      },
    },
    paletteDepth: numberSchema(0, 0.5),
    airbornePaletteDepth: numberSchema(0, 0.5),
    paletteDepthColor: colorSchema,
    screenVignette: {
      type: 'object',
      additionalProperties: false,
      required: ['color', 'inset', 'samples'],
      properties: {
        color: colorSchema,
        inset: numberSchema(0.01, 0.49),
        samples: {
          type: 'array',
          minItems: 1,
          maxItems: 6000,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['seconds', 'opacity'],
            properties: { seconds: numberSchema(0, 3600), opacity: numberSchema(0, 1) },
          },
        },
      },
    },
    tilePaletteCropPixels: {
      type: 'object',
      additionalProperties: false,
      required: ['top', 'right', 'bottom', 'left'],
      properties: {
        top: numberSchema(0, 16),
        right: numberSchema(0, 16),
        bottom: numberSchema(0, 16),
        left: numberSchema(0, 16),
      },
    },
    spriteCues: {
      type: 'array',
      maxItems: 1000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'startSeconds',
          'endSeconds',
          'x',
          'y',
          'width',
          'height',
          'sourceX',
          'sourceY',
          'sourceWidth',
          'sourceHeight',
          'fadeInSeconds',
          'fadeOutSeconds',
        ],
        properties: {
          atlasSlot: { enum: [...DROP_UI_ATLAS_SLOTS] },
          layer: { enum: ['background', 'overlay'] },
          preserveColor: { type: 'boolean' },
          animation: {
            type: 'object',
            additionalProperties: false,
            required: ['frames', 'columns', 'frameSeconds', 'loop'],
            properties: {
              frames: { type: 'integer', minimum: 1, maximum: 1000 },
              columns: { type: 'integer', minimum: 1, maximum: 1000 },
              frameSeconds: numberSchema(1 / 240, 10),
              loop: { type: 'boolean' },
            },
          },
          clipToBoard: { type: 'boolean' },
          id: { type: 'string', maxLength: 80 },
          startSeconds: numberSchema(0, 3600),
          endSeconds: numberSchema(0, 3600),
          x: numberSchema(-1080, 2160),
          y: numberSchema(-1920, 3840),
          width: numberSchema(1, 1080),
          height: numberSchema(1, 1920),
          sourceX: numberSchema(0, 16384),
          sourceY: numberSchema(0, 16384),
          sourceWidth: numberSchema(1, 4096),
          sourceHeight: numberSchema(1, 4096),
          fadeInSeconds: numberSchema(0, 3),
          fadeOutSeconds: numberSchema(0, 3),
        },
      },
    },
    cellColorKeys: {
      type: 'array',
      minItems: 1,
      maxItems: 10000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'seconds', 'color'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 160 },
          seconds: numberSchema(0, 3600),
          color: colorSchema,
        },
      },
    },
    boardColorKeys: {
      type: 'array',
      minItems: 1,
      maxItems: 6000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['seconds', 'color'],
        properties: { seconds: numberSchema(0, 3600), color: colorSchema },
      },
    },
    counterTracks: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'x', 'y', 'iconSize', 'fontSize', 'color', 'samples'],
        properties: {
          textColorKeys: {
            type: 'array',
            minItems: 1,
            maxItems: 1000,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['seconds', 'color'],
              properties: { seconds: numberSchema(0, 3600), color: colorSchema },
            },
          },
          format: { enum: ['integer', 'centiseconds', 'seconds-sixtieths'] },
          font: { enum: ['sans-serif', 'serif'] },
          align: { enum: ['left', 'center', 'right'] },
          id: { type: 'string', maxLength: 80 },
          x: numberSchema(-1080, 2160),
          y: numberSchema(-1920, 3840),
          iconSize: numberSchema(0, 240),
          fontSize: numberSchema(8, 120),
          color: colorSchema,
          samples: {
            type: 'array',
            minItems: 1,
            maxItems: 10000,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['seconds', 'value'],
              properties: { seconds: numberSchema(0, 3600), value: numberSchema(0, 1e12) },
            },
          },
        },
      },
    },
    tilePaletteColors: { type: 'array', minItems: 1, maxItems: 32, items: colorSchema },
    landingColorSeconds: numberSchema(0, 0.5),
    version: { const: 1 },
    background: colorSchema,
    tileColor: colorSchema,
    material: { enum: ['bevel', 'pyramid', 'wood-star', 'ice'] },
    colorMode: { enum: ['identity', 'columns'] },
    incomingCellColors: {
      type: 'array',
      minItems: 1,
      maxItems: 256,
      items: { type: 'array', minItems: 1, maxItems: 64, items: colorSchema },
    },
    incomingRowColors: { type: 'array', minItems: 1, maxItems: 256, items: colorSchema },
    columnColors: { type: 'array', maxItems: 64, items: colorSchema },
    bevel: numberSchema(0, 0.45),
    seam: numberSchema(0, 0.1),
    shadow: numberSchema(0, 2),
    board: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y', 'cell', 'background', 'line', 'horizontalLines'],
      properties: {
        x: numberSchema(-1080, 1080),
        y: numberSchema(-1920, 1920),
        cell: numberSchema(8, 270),
        verticalScale: numberSchema(0.5, 2),
        verticalLines: { type: 'boolean' },
        gridY: numberSchema(-1920, 1920),
        height: numberSchema(1, 1920),
        lineWidth: numberSchema(0.1, 12),
        background: colorSchema,
        line: colorSchema,
        horizontalLines: { type: 'boolean' },
      },
    },
    hud: {
      type: 'object',
      additionalProperties: false,
      required: [
        'kind',
        'height',
        'background',
        'color',
        'levelLabel',
        'level',
        'scoreLabel',
        'initialScore',
        'countdown',
      ],
      properties: {
        kind: { enum: ['level-score', 'timer-score', 'score', 'none', 'queue-panel'] },
        scoreLabelSize: numberSchema(8, 100),
        height: numberSchema(0, 500),
        background: colorSchema,
        color: colorSchema,
        levelLabel: { type: 'string', maxLength: 80 },
        level: { type: 'string', maxLength: 80 },
        scoreLabel: { type: 'string', maxLength: 80 },
        initialScore: numberSchema(0, 1e12),
        scoreCeiling: numberSchema(0, 1e12),
        countdown: numberSchema(0, 86400),
      },
    },
    queue: {
      type: 'object',
      additionalProperties: false,
      required: ['visible', 'y', 'scale'],
      properties: {
        visible: { type: 'boolean' },
        y: numberSchema(0, 1920),
        scale: numberSchema(0.1, 2),
      },
    },
    introCellCues: {
      type: 'array',
      maxItems: 2048,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'x', 'y', 'color', 'startSeconds', 'endSeconds', 'shatterSeconds'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 80 },
          x: { type: 'integer', minimum: 0, maximum: 31 },
          y: { type: 'integer', minimum: -32, maximum: 96 },
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          startSeconds: numberSchema(0, 3600),
          endSeconds: numberSchema(0, 3600),
          shatterSeconds: numberSchema(0, 4),
        },
      },
    },
    fallTrail: {
      type: 'object',
      additionalProperties: false,
      required: ['color', 'opacity', 'lengthPixels', 'minSpeedPixelsPerSecond'],
      properties: {
        color: colorSchema,
        opacity: numberSchema(0, 1),
        lengthPixels: numberSchema(0, 1000),
        minSpeedPixelsPerSecond: numberSchema(0, 10000),
      },
    },
    clear: {
      type: 'object',
      additionalProperties: false,
      required: [
        'style',
        'subdivisions',
        'frontSeconds',
        'fallPixels',
        'scatterPixels',
        'lifetimeSeconds',
      ],
      allOf: [
        {
          anyOf: [
            { properties: { followFieldRise: { const: false } } },
            {
              required: ['followFieldRise'],
              properties: {
                followFieldRise: { const: true },
                nativeInertial: { const: false },
                fragmentDisplayFps: { type: 'null' },
                fragmentPhysics: {
                  properties: { sheetDetachAfterReleaseSeconds: { type: 'null' } },
                },
              },
              anyOf: [
                { required: ['fragmentPhysics'] },
                {
                  required: ['motionModel'],
                  properties: { motionModel: { const: 'layered-curve' } },
                },
              ],
            },
          ],
        },
        {
          anyOf: [
            { properties: { fragmentMaterialTexture: { const: false } } },
            {
              required: ['fragmentMaterialTexture', 'fragmentGeometry'],
              properties: {
                fragmentMaterialTexture: { const: true },
                fragmentGeometry: { enum: ['faceted-chip', 'faceted-rock', 'rounded-rock'] },
                nativeInertial: { const: false },
                fragmentDepthRenderer: { type: 'null' },
                fragmentPerspectiveCamera: { type: 'null' },
              },
            },
          ],
        },
        fragmentDisplayClockSchema,
        fragmentDisplayPhaseSchema,
        ballisticPrefractureSchema,
        sheetLiftFalloffSchema,
        velocitySpreadPowerSchema,
        localDetachClearSchema,
        prefractureRefinementSchema,
        {
          anyOf: [
            {
              properties: {
                fragmentPartitionProfile: { type: 'null' },
                fragmentGeometry: {
                  enum: [
                    'flat-shard',
                    'faceted-chip',
                    'faceted-rock',
                    'rounded-rock',
                    'textured-chip',
                    'textured-cube',
                    'rounded-cube',
                    'rounded-polyhedron',
                    'fractured-block',
                    'fractured-volume',
                    'relief-cube',
                    'pyramid-quarter',
                  ],
                },
              },
            },
            {
              required: ['fragmentGeometry', 'fragmentPartitionProfile'],
              properties: {
                fragmentGeometry: { const: 'partitioned-solid' },
                subdivisions: { const: 2 },
                prefractureSubdivisions: { const: 2 },
                fragmentDepthLayers: { const: 1 },
                motionModel: { const: 'ballistic' },
                fragmentSurface: { enum: ['tile', 'solid'] },
                layeredCurve: { type: 'null' },
              },
            },
          ],
        },
        {
          anyOf: [
            { properties: { fragmentCubeFrontUvMapping: { const: 'flat-patch' } } },
            {
              required: ['fragmentCubeFrontUvMapping', 'fragmentGeometry'],
              properties: {
                fragmentCubeFrontUvMapping: { const: 'mother-plane' },
                fragmentGeometry: { const: 'rounded-cube' },
                fragmentSurface: { enum: ['tile', 'solid'] },
              },
            },
          ],
        },
        {
          anyOf: [
            { properties: { fragmentVolumeSeedPattern: { const: 'grid' } } },
            {
              required: [
                'fragmentVolumeSeedPattern',
                'fragmentGeometry',
                'subdivisions',
                'fragmentDepthLayers',
              ],
              properties: {
                fragmentVolumeSeedPattern: { const: 'center-three' },
                fragmentGeometry: { const: 'fractured-volume' },
                subdivisions: { const: 2 },
                fragmentDepthLayers: { const: 2 },
                prefractureSubdivisions: { const: 2 },
              },
            },
          ],
        },
        {
          anyOf: [
            { properties: { fragmentDepthLayers: { type: 'null' } } },
            {
              required: ['fragmentDepthLayers', 'fragmentGeometry'],
              properties: {
                fragmentDepthLayers: { type: 'integer', enum: [1, 2] },
                fragmentGeometry: { const: 'fractured-volume' },
              },
            },
            {
              required: ['fragmentGeometry', 'fragmentDepthLayers'],
              properties: {
                fragmentGeometry: { enum: ['relief-cube', 'pyramid-quarter', 'partitioned-solid'] },
                fragmentDepthLayers: { const: 1 },
              },
            },
            {
              required: ['fragmentGeometry', 'fragmentDepthLayers', 'fragmentDepthRenderer'],
              properties: {
                fragmentGeometry: { const: 'rounded-cube' },
                fragmentDepthLayers: { const: 1 },
                fragmentDepthRenderer: { const: 'webgl-opaque' },
              },
            },
          ],
        },
        {
          if: {
            properties: { motionModel: { const: 'layered-curve' } },
            required: ['motionModel'],
          },
          then: { required: ['layeredCurve'], properties: { subdivisions: { minimum: 2 } } },
          else: { not: { required: ['layeredCurve'] } },
        },
        {
          anyOf: [
            {
              properties: {
                fragmentGeometry: {
                  enum: [
                    'flat-shard',
                    'faceted-chip',
                    'faceted-rock',
                    'rounded-rock',
                    'textured-chip',
                    'textured-cube',
                    'rounded-cube',
                    'rounded-polyhedron',
                    'fractured-block',
                    'fractured-volume',
                  ],
                },
              },
            },
            {
              required: ['fragmentGeometry'],
              properties: {
                fragmentGeometry: { enum: ['relief-cube', 'pyramid-quarter', 'partitioned-solid'] },
                subdivisions: { const: 2 },
                prefractureSubdivisions: { const: 2 },
                fragmentSurface: { enum: ['tile', 'solid'] },
                layeredCurve: { properties: { depthLayers: { const: 1 } } },
              },
            },
          ],
        },
      ],
      properties: {
        followFieldRise: {
          type: 'boolean',
          description:
            'Optional board-space advection for legacy screen-anchored physical/layered clear effects. Absence/false preserves historical motion.',
        },
        fragmentMaterialTexture: {
          type: 'boolean',
          description:
            'Optional palette texture on existing faceted-chip, faceted-rock and rounded-rock. Absent/false preserves legacy solid paint. Requires actual tile.palette image and tilePaletteColors at render time; excludes native/depth/observed-V2 consumers. Geometry, motion, culling and lights stay unchanged.',
        },
        nativeInertial: {
          type: 'boolean',
          description:
            'Opt-in native120Hz shared two-depth physics; solid rounded mesh/orthographic affine projection. Legacy required clear numerics are retained, not native pose controls.',
        },
        ballisticPrefracture: ballisticPrefractureProfileSchema,
        prefractureRefineSeconds: numberSchema(Number.MIN_VALUE, 2),
        fragmentDisplayFps: { type: 'integer', minimum: 1, maximum: 120 },
        fragmentDisplayPhaseSeconds: numberSchema(0, 1),
        fragmentDepthRenderer: { const: 'webgl-opaque' },
        fragmentPerspectiveCamera: fragmentPerspectiveCameraSchema,
        fragmentPartitionProfile: PARTITIONED_SOLID_PROFILE_SCHEMA,
        fragmentCubeFrontUvMapping: { enum: ['flat-patch', 'mother-plane'] },
        fragmentVolumeSeedPattern: { enum: ['grid', 'center-three'] },
        fragmentDepthLayers: { type: 'integer', enum: [1, 2] },
        fragmentFaceColors: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            front: colorSchema,
            back: colorSchema,
            left: colorSchema,
            right: colorSchema,
            top: colorSchema,
            bottom: colorSchema,
          },
        },
        fragmentCastShadow: {
          type: 'object',
          additionalProperties: false,
          required: ['offsetX', 'offsetY', 'blur', 'opacity'],
          properties: {
            offsetX: numberSchema(-2, 2),
            offsetY: numberSchema(-2, 2),
            blur: numberSchema(0, 2),
            opacity: numberSchema(0, 1),
            color: colorSchema,
          },
        },
        fragmentAmbientFloor: numberSchema(0, 0.55),
        fragmentSpecularStrength: numberSchema(0, 2),
        fragmentSpecularPower: numberSchema(4, 128),
        fragmentCubePitchStart: numberSchema(-Math.PI, Math.PI),
        fragmentCubePitchRate: numberSchema(0, 8),
        fragmentDiffuse: numberSchema(0, 0.8),
        fragmentLightDirection: fragmentLightDirectionSchema,
        fragmentRotationSpreadRampSeconds: numberSchema(0, 2),
        fragmentCubeCornerRadius: numberSchema(0.015, 0.22),
        layeredCurve: {
          type: 'object',
          additionalProperties: false,
          required: [
            'keys',
            'frontSeconds',
            'thicknessGrowth',
            'horizontalCompression',
            'scatterPixels',
          ],
          properties: {
            keys: layeredCurveKeysSchema,
            depthLayers: { type: 'integer', enum: [1, 2] },
            referenceBandRows: { type: 'integer', minimum: 1, maximum: 28 },
            depthStaggerPixels: numberSchema(0, 150),
            depthRotationSpread: numberSchema(0, 1),
            rowStagger: numberSchema(0, 0.45),
            sizeGrowth: numberSchema(0, 0.3),
            waveOriginOffsets: {
              type: 'array',
              maxItems: 2048,
              uniqueItems: true,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['actionIndex', 'cycleIndex', 'offsetY'],
                properties: {
                  actionIndex: { type: 'integer', minimum: 0, maximum: 999 },
                  cycleIndex: { type: 'integer', minimum: 0, maximum: 63 },
                  offsetY: numberSchema(-1920, 1920),
                },
              },
            },
            frontSeconds: numberSchema(0, 5),
            thicknessGrowth: numberSchema(0, 20),
            horizontalCompression: numberSchema(0, 5),
            scatterPixels: numberSchema(0, 1080),
          },
        },
        fragmentPhysics: {
          type: 'object',
          additionalProperties: false,
          required: ['gravityPixelsPerSecondSquared', 'initialVelocityY', 'initialVelocityX'],
          properties: {
            gravityPixelsPerSecondSquared: numberSchema(100, 20000),
            initialVelocityY: numberSchema(-2000, 2000),
            initialVelocityX: numberSchema(-1200, 1200),
            velocitySpreadX: numberSchema(0, 1200),
            velocitySpreadY: numberSchema(0, 1200),
            velocitySpreadPowerX: numberSchema(1, 8),
            velocitySpreadPowerY: numberSchema(1, 8),
            exitY: numberSchema(0, 3840),
            sheetDetachSeconds: numberSchema(0, 2),
            sheetDetachAfterReleaseSeconds: numberSchema(0, 2),
          },
        },
        fragmentShading: { enum: ['legacy', 'material'] },
        sheetLiftPixels: numberSchema(0, 800),
        sheetLiftFrontFalloffPower: numberSchema(0, 4),
        sheetLiftSeconds: numberSchema(0.01, 2),
        sheetThicknessScale: numberSchema(0.5, 4),
        fragmentLightColor: colorSchema,
        fragmentPalette: { type: 'array', minItems: 1, maxItems: 32, items: colorSchema },
        prefractureScale: numberSchema(0.5, 1),
        prefractureSubdivisions: { type: 'integer', minimum: 1, maximum: 8 },
        colorByAction: {
          type: 'array',
          maxItems: 1000,
          items: { type: 'array', maxItems: 64, items: colorSchema },
        },
        colorSource: { enum: ['cell', 'action-piece'] },
        fragmentSurface: { enum: ['tile', 'solid', 'tile-repeat'] },
        scatterVerticalRatio: numberSchema(0, 2),
        scatterHorizontalRatio: numberSchema(0, 2),
        prefracture: { type: 'boolean' },
        fragmentAmbient: numberSchema(0, 1.5),
        fragmentRotationSpread: numberSchema(0, 1),
        fragmentCubeRotationAgeScale: numberSchema(0, 2),
        fragmentColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        sheetTearSeconds: numberSchema(0, 2),
        sheetMotionRate: numberSchema(0.25, 4),
        motionModel: { enum: ['ballistic', 'constrained-sheet', 'layered-curve'] },
        frontOrigin: { enum: ['left', 'right', 'center', 'edges'] },
        freezeColorAtRelease: { type: 'boolean' },
        frontExponent: numberSchema(0.25, 4),
        fragmentAgeOffsetSeconds: numberSchema(-0.25, 0.25),
        fallSpread: numberSchema(0, 1),
        sizeSpread: numberSchema(0, 1),
        overlap: { type: 'boolean' },
        style: { enum: ['granular-sweep', 'fold-sheet'] },
        subdivisions: { type: 'integer', minimum: 1, maximum: 8 },
        frontSeconds: numberSchema(0, 2),
        fallPixels: numberSchema(0, 2500),
        scatterPixels: numberSchema(0, 1080),
        lifetimeSeconds: numberSchema(0.1, 5),
        highlight: numberSchema(0, 1),
        fragmentScale: numberSchema(0.5, 6),
        fragmentGeometry: {
          enum: [
            'flat-shard',
            'faceted-chip',
            'faceted-rock',
            'rounded-rock',
            'textured-chip',
            'textured-cube',
            'rounded-cube',
            'rounded-polyhedron',
            'fractured-block',
            'fractured-volume',
            'relief-cube',
            'pyramid-quarter',
            'partitioned-solid',
          ],
        },
        shadow: numberSchema(0, 1),
      },
    },

    faceShading: {
      type: 'object',
      additionalProperties: false,
      required: ['top', 'left', 'right', 'bottom'],
      properties: {
        top: numberSchema(0.1, 2),
        left: numberSchema(0.1, 2),
        right: numberSchema(0.1, 2),
        bottom: numberSchema(0.1, 2),
      },
    },
    guidance: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'text',
          'startSeconds',
          'endSeconds',
          'x',
          'y',
          'size',
          'color',
          'outline',
          'outlineWidth',
          'align',
          'weight',
          'fadeSeconds',
        ],
        properties: {
          id: { type: 'string', maxLength: 80 },
          text: { type: 'string', minLength: 1, maxLength: 500 },
          startSeconds: numberSchema(0, 3600),
          endSeconds: numberSchema(0, 3600),
          x: numberSchema(-1080, 2160),
          y: numberSchema(-1920, 3840),
          size: numberSchema(8, 240),
          color: colorSchema,
          outline: colorSchema,
          outlineWidth: numberSchema(0, 30),
          align: { enum: ['left', 'center', 'right'] },
          weight: { enum: ['normal', 'bold'] },
          fadeSeconds: numberSchema(0, 3),
        },
      },
    },
    queuePreviews: {
      type: 'array',
      maxItems: 1000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pieceId', 'startSeconds', 'endSeconds', 'x', 'y', 'scale', 'quarterTurns'],
        properties: {
          pieceId: { type: 'string', maxLength: 80 },
          startSeconds: numberSchema(0, 3600),
          endSeconds: numberSchema(0, 3600),
          x: numberSchema(-1080, 2160),
          y: numberSchema(-1920, 3840),
          scale: numberSchema(0.1, 2),
          quarterTurns: { type: 'integer', minimum: 0, maximum: 3 },
        },
      },
    },
    respectPieceTrackWindows: { type: 'boolean' },
    pieceTracks: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['actionIndex', 'samples'],
        properties: {
          actionIndex: { type: 'integer', minimum: 0, maximum: 499 },
          pieceId: { type: 'string', maxLength: 80 },
          uncommitted: { const: true },
          previewOnly: { const: true },
          surfaceOrientation: { enum: ['piece', 'world'] },
          samples: {
            type: 'array',
            minItems: 2,
            maxItems: 6000,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['seconds', 'x', 'y', 'angle'],
              properties: {
                seconds: numberSchema(0, 3600),
                x: numberSchema(-1080, 2160),
                y: numberSchema(-1920, 3840),
                angle: numberSchema(-36000, 36000),
                scaleX: numberSchema(-2, 2),
                scaleY: numberSchema(-2, 2),
              },
            },
          },
        },
      },
    },
  },
};
