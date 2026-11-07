import type { ClearSequenceReference } from './clearSequence';
import type {
  EliminationResolutionPhase,
  EliminationResolutionStep,
} from '../../../game-runtime/eliminationResolutionTrace';
import type {
  CompiledFrameSource,
  PresentationCompilerAdapter,
} from '../../../game-runtime/frameSource';
import type { InteractionRecord } from '../../../game-runtime/replayEnvelope';
import {
  PRESENTATION_PACKET_CONTRACT,
  PRESENTATION_PACKET_CONTRACT_VERSION,
  presentationHashIdentity,
  type PresentationPacket,
  type SemanticGameEvent,
} from '../../../game-runtime/presentationPacket';
import { stableHash } from '../../../headless/stableHash';
import { blockCrushDropRuntime } from '../runtime';
import { blockCrushFieldClock } from '../fieldClock';
import { blockCrushDropActionSchema, blockCrushDropStateSchema } from '../schemas';
import type {
  BlockCrushDropAction,
  BlockCrushDropCell,
  BlockCrushDropResolution,
  BlockCrushDropState,
} from '../types';
import { BLOCK_CRUSH_DROP_GAME_ID, BLOCK_CRUSH_DROP_MODULE_VERSION } from '../manifest';
import { calibratedFragmentFlightSeconds } from '../profiles/fragmentPhysics';
import { calibratedLocalDetachLifetimeSeconds } from '../profiles/localFragmentSupport';
import { calibratedFragmentDisplayMaximumLag } from '../profiles/localFragmentDetach';
import {
  dropObservedFragmentFirstFrame,
  dropObservedFragmentLastFrame,
  isDropObservedFragmentMotionV2,
  type DropObservedFragmentMotionV2,
} from '../profiles/observedFragmentMotion';
import { validateDropImpactBeamBindings } from '../profiles/impactBeam';
import {
  bindDropLandingSurfaceFlashCues,
  type DropLandingSurfaceFlashFrame,
} from '../profiles/landingSurfaceFlash';
import {
  bindDropEncouragementGlyphCues,
  type DropEncouragementGlyphWave,
} from '../profiles/encouragementGlyphCues';
import { calibratedBallisticFragmentAgeMaximumDelay } from '../profiles/ballisticFragmentAgeOffset';

export const BLOCK_CRUSH_DROP_PRESENTATION_SCHEMA_ID = 'bcs.block-crush-drop.presentation-frame.v1';

/**
 * Presentation-only residual motion measured from an authored clear. Values
 * are expressed in logical cells and canonical 30 fps frames so the same
 * director profile remains time-equivalent at other export frame rates.
 */
export interface BlockCrushDropClearResidualMotionProfile {
  startLifetimeProgress: number;
  rampLifetimeProgress: number;
  horizontalAmplitudeCells: number;
  verticalAmplitudeCells: number;
  horizontalAngularVelocityRadiansPerCanonicalFrame: number;
  verticalAngularVelocityRadiansPerCanonicalFrame: number;
  horizontalPhaseOffsetRadians: number;
  verticalZeroCrossingCanonicalFrame: number;
}

export interface BlockCrushDropFragmentMotionBlurProfile {
  scale: number;
  startLifetimeProgress: number;
  endLifetimeProgress: number;
  rampLifetimeProgress: number;
}

export interface BlockCrushDropObservedFragmentMotionProfile {
  /** Motion evidence is authored in the 1080x1920 source stage coordinate system. */
  coordinateSpace: 'source-stage-pixels';
  canonicalFps: number;
  gridX: number;
  gridTop: number;
  cellPitch: number;
  subColumns: number;
  minimumTracksPerSubColumn: number;
  /** Minimum same-frame tracked-fragment share before local displacement interpolation is safe. */
  interpolationMinimumCoverage?: number;
  frames: Array<{
    frameOffset: number;
    /** Compact tuples: lattice id, source x center, source y center. */
    tracks: Array<[number, number, number]>;
  }>;
}

export interface BlockCrushDropInertialPhysicsProfile {
  gravity: number;
  gravityEnvelope?: { startFrame: number; transitionFrames: number; targetGravity: number };
  damping: number;
  releaseFrontFrames: number;
  bondLifetimeFrames: number;
  radius: number;
  restitution: number;
  observationStrength: number;
  /** Normalized column coordinate, absolute canonical 30 fps cue offsets. */
  releaseSegments?: Array<{ at: number; releaseFrame: number; detachFrame: number }>;
  bondReleaseDurationFrames?: number;
  bondCompliance?: number;
  separationSpeed?: number;
  separationVariation?: number;
  meshBendCompliance?: number;
  meshBreakStrain?: number;
  meshBreakFrames?: number;
  /** Minimum canonical frames after both nodes release before strain tearing. */
  meshTearDelayFrames?: number;
  meshAngularStiffness?: number;
  /** Canonical local release-age spring softening; never changes angular state directly. */
  meshAngularRelease?: { holdFrames: number; fadeFrames: number; targetStiffness: number };
  /** Elastic support fades between local visible release and complete detach. */
  meshAnchorStiffness?: number;
  meshAttachmentStiffness?: number;
  meshFractureEnergyRetention?: number;
  sharedContact?: boolean;
  depthLayers?: 1 | 2;
  releaseSpinScale?: [number, number, number];
  fractureSpinSpeed?: number;
  materialSeed?: number;
  contactShape?: 'sphere' | 'box';
  /** Permit existing bounded contacts between released connected box fragments. */
  bondedContact?: boolean;
}

export interface BlockCrushDropFragmentAppearanceProfile {
  /** Opt-in fade toward the exclusive cue end, in canonical30fps frames. */
  exitFadeFrames?: number;
  /** Debris-only cut-face material; omitted fields preserve the bound look. */
  cutFaceAmbient?: number;
  topFaceAmbient?: number;
  cutFaceTint?: number;

  /** Opt-in causal fixed-step motion; ignores pose/scatter/fold choreography. */
  inertialPhysics?: BlockCrushDropInertialPhysicsProfile;
  /** Fragment edge length in logical cell units at release. */
  baseScale: number;
  /** Additional edge-length scale reached over the release lifetime. */
  releaseGrowthScale: number;
  /** Optional visual-lifetime point at which release growth starts fading. */
  releaseGrowthEndLifetimeProgress?: number;
  /** Optional visual-lifetime duration used to fade release growth back out. */
  releaseGrowthFadeLifetimeProgress?: number;
  /** Correlated displacement shared by the four children of a logical cell. */
  clusterScatterCells: number;
  /** Independent displacement within a logical-cell cluster. */
  fragmentScatterCells: number;
  /** Release-age point at which collision scatter begins. */
  scatterStartReleaseAge: number;
  /** Final contribution of the original tile texture on the exposed front face. */
  frontTextureEndBlend?: number;
  /** Visual-lifetime point at which the front texture begins fading to the cut face. */
  frontTextureFadeStartLifetimeProgress?: number;
  /** Visual-lifetime duration used for the front-texture fade. */
  frontTextureFadeLifetimeProgress?: number;
  /** Canonical sheet-solver step after which collision constraints may relax. */
  relaxConstraintsAfterMotionStep?: number;
  /** Constraint iterations retained after the authored relaxation point. */
  relaxedConstraintIterations?: number;
}

/** Shared legacy renderer defaults, also inherited by cycle-only overrides. */
export const BLOCK_CRUSH_DROP_DEFAULT_FRAGMENT_APPEARANCE: BlockCrushDropFragmentAppearanceProfile =
  {
    baseScale: 0.52,
    releaseGrowthScale: 0.28,
    clusterScatterCells: 2.1,
    fragmentScatterCells: 1.05,
    scatterStartReleaseAge: 0.22,
  };

export interface BlockCrushDropFragmentFoldSpreadProfile {
  /** Motion-clock point at which the post-collision sheet begins to open. */
  startMotionProgress: number;
  /** Normalized motion-clock span used to ease into the final spread. */
  rampMotionProgress: number;
  /** Final horizontal scale around the director-authored fold pivot. */
  horizontalScale: number;
  /** Final vertical scale around the director-authored fold pivot. */
  verticalScale: number;
  /** Fold pivot across the board: 0 is left edge and 1 is right edge. */
  pivotXNormalized: number;
  /** Fold pivot relative to the last cleared logical row. */
  pivotYOffsetCells: number;
}

export interface BlockCrushDropPresentationFrame {
  /** Opt-in fixed-seconds historical shutter, native textured fixed camera only. */
  clearExposureSeconds?: number;
  frameIndex: number;
  fps: number;
  totalFrames: number;
  /** Canonical gameplay tick represented by this video frame. */
  canonicalTick: number;
  /** Continuous rise relative to the integer-y basis used by the active cell snapshot. */
  fieldRiseOffsetCells: number;
  /** Whole rows crossed since the active semantic snapshot. */
  fieldPreviewRows: number;
  /** First authored incoming row not yet committed into the semantic snapshot. */
  fieldIncomingRowIndex: number;
  phase: EliminationResolutionPhase | 'idle';
  progress: number;
  step?: EliminationResolutionStep;
  action?: BlockCrushDropAction;
  interaction?: InteractionRecord;
  /** A long-running clear/debris effect may overlap the next semantic action. */
  lingeringClear?: {
    actionIndex?: number;
    cycleIndex?: number;
    pieceKind?: string;
    progress: number;
    /** Video frames since the native observation origin; negative only for explicit V2 pre-roll. */
    elapsedFrames: number;
    /** Original native visual origin, retained when explicit measured keys begin earlier. */
    originFrame?: number;
    /** Future native mothers omitted from a pre-roll frame, rather than painted early. */
    preRollOmittedCellIds?: string[];
    durationFrames: number;
    /** Motion clock is separate from the effect's visible lifetime. */
    motionProgress: number;
    rowStaggerProgress: number;
    eliminatedCells: BlockCrushDropCell[];
    /** Actual resolution depth and cumulative clear count, safe for random-access rendering. */
    chainDepth?: number;
    clearOrdinal?: number;
    /** Source-authored out-of-plane tumble scale; never changes rule state. */
    fragmentTiltScale?: number;
    /** Source-authored shutter-trail scale; never changes rule state. */
    fragmentMotionBlurScale?: number;
    /** Source-observed screen motion used to calibrate the generated 3D sheet. */
    observedFragmentMotion?: BlockCrushDropObservedFragmentMotionProfile;
    /** Explicit per-particle stage poses; distinct from the legacy xy lattice. */
    observedFragmentMotionV2?: DropObservedFragmentMotionV2;
    /** Source-authored fragment size and collision scatter. */
    fragmentAppearance?: BlockCrushDropFragmentAppearanceProfile;
    sequence?: ClearSequenceReference;
    /** Source-authored post-collision sheet spread; never changes rule state. */
    fragmentFoldSpread?: BlockCrushDropFragmentFoldSpreadProfile;
    /** Optional director-authored collision tail; never changes rule state. */
    residualMotion?: BlockCrushDropClearResidualMotionProfile;
  };
  /** Complete immutable schedule, including future cues, for causal shared contact. */
  sequenceCueSchedule?: Array<{
    startSeconds: number;
    endSeconds: number;
    sequence: ClearSequenceReference;
  }>;
  physicsCueSchedule?: Array<{
    startSeconds: number;
    endSeconds: number;
    /** Presentation replacement only; keep original world interactions for other native cues. */
    sequence?: ClearSequenceReference;
    /** Only emitted with exposure enabled; never enters physics cache identity. */
    clearOrdinal?: number;
    eliminatedCells: BlockCrushDropCell[];
    riseAtStartCells: number;
    fragmentAppearance: BlockCrushDropFragmentAppearanceProfile;
    observedFragmentMotion?: BlockCrushDropObservedFragmentMotionProfile;
  }>;
  /** Concurrent clear tails, oldest first; lingeringClear remains the latest cue. */
  lingeringClears?: Array<NonNullable<BlockCrushDropPresentationFrame['lingeringClear']>>;
  /** Light ownership is independent of the fragment overlap policy. */
  impactBeamWaves?: Array<{ actionIndex: number; cycleIndex: number; elapsedFrames: number }>;
  /** Native landed IDs only; the stage applies this material to currently visible cells. */
  landingSurfaceFlashes?: DropLandingSurfaceFlashFrame[];
  /** Independent UI ages; native fragment lifetime and semantic events stay intact. */
  encouragementGlyphWaves?: DropEncouragementGlyphWave[];
  /** Exact intermediate cells before and after the active semantic step. */
  stepBeforeCells?: BlockCrushDropCell[];
  stepAfterCells?: BlockCrushDropCell[];
  /** Cleared row cells retained as transient debris during collapse. */
  eliminatedCells?: BlockCrushDropCell[];
  /** Presentation-only counter value; semantic score remains in before/after state. */
  displayScore?: number;
  /** Source-timed HUD countdown; the short clip does not prove timeout semantics. */
  displayCountdownSeconds?: number;
  /** Presentation-only row-compaction clock; semantic endpoints stay in the trace. */
  reconfigureProgress?: number;
  /** Native gravity deltas that begin during the preceding compaction, before their logical step. */
  earlyGravityOffsets?: Array<{ id: string; x: number; y: number }>;
  lateMovementOffsets?: Array<{ id: string; x: number; y: number }>;
  /** Presentation-only grid bounce amplitude; zero is a valid source-observed hold. */
  settleBounceCells?: number;
  before: BlockCrushDropState;
  after: BlockCrushDropState;
}

const PHASE_SECONDS: Record<EliminationResolutionPhase, number> = {
  commit: 36 / 30,
  detect: 1 / 30,
  resolve: 3 / 30,
  reconfigure: 44 / 30,
  settle: 4 / 30,
  outcome: 1 / 30,
};

const EVENT_TYPES: Record<EliminationResolutionPhase, string> = {
  commit: 'block-crush-drop.piece-committed',
  detect: 'block-crush-drop.elimination-detected',
  resolve: 'block-crush-drop.blocks-eliminated',
  reconfigure: 'block-crush-drop.rows-compacted',
  settle: 'block-crush-drop.settled',
  outcome: 'block-crush-drop.outcome',
};

interface TimelineStep {
  startFrame: number;
  endFrame: number;
  resolution: BlockCrushDropResolution;
  step: EliminationResolutionStep;
  stepBeforeCells: BlockCrushDropCell[];
  stepAfterCells: BlockCrushDropCell[];
  eliminatedCells: BlockCrushDropCell[];
  interaction?: InteractionRecord;
  reconfigureProgressCurve?: number[];
  gravityLeadFrames?: number;
  stepTailFrames?: number;
  fieldBasisBefore?: Pick<BlockCrushDropState, 'tick' | 'riseOffsetTicks' | 'incomingRowIndex'>;
  fieldBasisAfter?: Pick<BlockCrushDropState, 'tick' | 'riseOffsetTicks' | 'incomingRowIndex'>;
  settleBounceCells?: number;
  scoreBefore?: number;
  scoreAfter?: number;
}

function applyStepDeltas(
  cells: BlockCrushDropCell[],
  step: EliminationResolutionStep,
  spawnedKind: string,
): BlockCrushDropCell[] {
  const byId = new Map(cells.map((cell) => [cell.id, { ...cell }]));
  for (const delta of step.deltas) {
    if (delta.kind === 'spawn') {
      byId.set(delta.entityId, {
        id: delta.entityId,
        kind: spawnedKind,
        x: delta.to.x,
        y: delta.to.y,
      });
    } else if (delta.kind === 'remove') {
      byId.delete(delta.entityId);
    } else if (delta.kind === 'move') {
      const cell = byId.get(delta.entityId);
      if (cell) byId.set(delta.entityId, { ...cell, x: delta.to.x, y: delta.to.y });
    }
  }
  return [...byId.values()].sort(
    (left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id),
  );
}

export type BlockCrushDropFragmentAppearanceOverride = Partial<
  Omit<BlockCrushDropFragmentAppearanceProfile, 'inertialPhysics'>
> & {
  inertialPhysics?: Partial<BlockCrushDropInertialPhysicsProfile>;
};

export interface BlockCrushDropCycleTiming {
  /** Internal validated effect-library selection, never authored director JSON. */
  sequence?: ClearSequenceReference;
  /** Per-cycle fields inherit the action appearance; physics fields merge too. */
  fragmentAppearance?: BlockCrushDropFragmentAppearanceOverride | undefined;

  phaseFrames?: Partial<Record<EliminationResolutionPhase, number>>;
  gravityFrames?: number | undefined;
  reconfigureProgress?: number[] | undefined;
  clearEffectFrames?: number | undefined;
  clearMotionFrames?: number | undefined;
  /** Signed offset from this cycle's resolve phase. */
  clearEffectStartOffsetFrames?: number | undefined;
  clearMotionStartOffsetFrames?: number | undefined;
}

export interface BlockCrushDropDirectorProfile {
  clearExposureSeconds?: number;
  cycleTimingsByAction?: Array<Array<BlockCrushDropCycleTiming> | undefined>;
  /** Static source-alignment hold before the first diagnostic action. */
  leadInSeconds?: number;
  /** State-preserving hold between actions. */
  betweenActionsSeconds?: number;
  /** State-preserving hold after the final action. */
  tailSeconds?: number;
  /** Source-aligned semantic phase durations for individual actions. */
  phaseFramesByAction?: Array<Partial<Record<EliminationResolutionPhase, number>>>;
  /** Per-resolution-step canonical durations; keys are trace suffixes such as resolve:1. */
  stepFramesByAction?: Array<Record<string, number>>;
  /** Independent per-step movement curves; row compaction never owns active gravity. */
  stepProgressByAction?: Array<Record<string, number[]>>;
  gravityLeadFramesByAction?: Array<Record<string, number>>;
  stepTailFramesByAction?: Array<Record<string, number>>;
  /** Canonical 30 Hz duration of released-piece gravity, separate from row compaction. */
  pieceSettleFramesByAction?: Array<number | undefined>;
  /** Visual clear tails are independent of, and may outlive, semantic settlement. */
  clearEffectFramesByAction?: Array<number | undefined>;
  /** Duration of the physical clear motion; defaults to the visual lifetime. */
  clearMotionFramesByAction?: Array<number | undefined>;
  /** Hold after visual fragmentation before the physical clear motion starts. */
  clearMotionStartOffsetFramesByAction?: Array<number | undefined>;
  /** Sampled normalized motion response, used for collision/settling art direction. */
  clearMotionProgressByAction?: Array<number[] | undefined>;
  /** Per-action out-of-plane fragment tumble scale. */
  clearFragmentTiltScaleByAction?: Array<number | undefined>;
  /** Per-action shutter-trail window in visual-effect lifetime coordinates. */
  clearFragmentMotionBlurByAction?: Array<BlockCrushDropFragmentMotionBlurProfile | undefined>;
  /** Per-action optical-flow evidence; presentation only and never rule input. */
  clearObservedFragmentMotionByAction?: Array<
    BlockCrushDropObservedFragmentMotionProfile | undefined
  >;
  /** Per-action fragment size and collision scatter; never inferred from clear count. */
  clearFragmentAppearanceByAction?: Array<BlockCrushDropFragmentAppearanceProfile | undefined>;
  /** Per-action post-collision sheet spread in visual-effect coordinates. */
  clearFragmentFoldSpreadByAction?: Array<BlockCrushDropFragmentFoldSpreadProfile | undefined>;
  /** Source-specific residual collision motion after the sampled clear curve. */
  clearResidualMotionByAction?: Array<BlockCrushDropClearResidualMotionProfile | undefined>;
  /** Sampled row-compaction response; permits staged shifts between semantic endpoints. */
  reconfigureProgressByAction?: Array<number[] | undefined>;
  /** Per-action settle bounce amplitude in logical cells. */
  settleBounceCellsByAction?: Array<number | undefined>;
  /** Source-relative start offset from the semantic impact. */
  clearEffectStartOffsetFramesByAction?: Array<number | undefined>;
  /** Delay between successive cleared rows within one semantic clear set. */
  clearRowStaggerFramesByAction?: Array<number | undefined>;
  /** Source-observed score-counter easing, normalized independently from score rules. */
  scoreRevealByAction?: Array<
    | {
        startOffsetFromImpactFrames: number;
        normalizedProgress: number[];
      }
    | undefined
  >;
  /** Visible countdown start value for source matching, independent of game-over rules. */
  countdownStartSeconds?: number;
  /** Source frame indices on which the visible countdown decrements. */
  countdownTickFrames?: number[];
}

interface ResolvedDirectorTiming {
  clearExposureSeconds?: number;
  cycleTimingsByAction: Array<Array<BlockCrushDropCycleTiming> | undefined>;
  leadInFrames: number;
  betweenActionsFrames: number;
  tailFrames: number;
  phaseFramesByAction: Array<Partial<Record<EliminationResolutionPhase, number>>>;
  stepFramesByAction: Array<Record<string, number>>;
  stepProgressByAction: Array<Record<string, number[]>>;
  gravityLeadFramesByAction: Array<Record<string, number>>;
  stepTailFramesByAction: Array<Record<string, number>>;
  pieceSettleFramesByAction: Array<number | undefined>;
  clearEffectFramesByAction: Array<number | undefined>;
  clearMotionFramesByAction: Array<number | undefined>;
  clearMotionStartOffsetFramesByAction: Array<number | undefined>;
  clearMotionProgressByAction: Array<number[] | undefined>;
  clearFragmentTiltScaleByAction: Array<number | undefined>;
  clearFragmentMotionBlurByAction: Array<BlockCrushDropFragmentMotionBlurProfile | undefined>;
  clearObservedFragmentMotionByAction: Array<
    BlockCrushDropObservedFragmentMotionProfile | undefined
  >;
  clearFragmentAppearanceByAction: Array<BlockCrushDropFragmentAppearanceProfile | undefined>;
  clearFragmentFoldSpreadByAction: Array<BlockCrushDropFragmentFoldSpreadProfile | undefined>;
  clearResidualMotionByAction: Array<BlockCrushDropClearResidualMotionProfile | undefined>;
  reconfigureProgressByAction: Array<number[] | undefined>;
  settleBounceCellsByAction: Array<number | undefined>;
  clearEffectStartOffsetFramesByAction: Array<number | undefined>;
  clearRowStaggerFramesByAction: Array<number | undefined>;
  scoreRevealByAction: Array<
    | {
        startOffsetFromImpactFrames: number;
        normalizedProgress: number[];
      }
    | undefined
  >;
  countdownStartSeconds?: number;
  countdownTickFrames: number[];
}

interface ClearVisualCue {
  actionIndex: number;
  cycleIndex: number;
  pieceKind: string;
  sequence?: ClearSequenceReference;
  startFrame: number;
  /** Set only when V2 pre-roll extends startFrame; all observed offsets retain this origin. */
  originFrame?: number;
  endFrame: number;
  motionStartFrame: number;
  motionFrames: number;
  motionProgressCurve?: number[];
  fragmentTiltScale?: number;
  fragmentMotionBlur?: BlockCrushDropFragmentMotionBlurProfile;
  observedFragmentMotion?: BlockCrushDropObservedFragmentMotionProfile;
  observedFragmentMotionV2?: DropObservedFragmentMotionV2;
  fragmentAppearance?: BlockCrushDropFragmentAppearanceProfile;
  fragmentFoldSpread?: BlockCrushDropFragmentFoldSpreadProfile;
  residualMotion?: BlockCrushDropClearResidualMotionProfile;
  rowStaggerProgress: number;
  eliminatedCells: BlockCrushDropCell[];
  chainDepth?: number;
  clearOrdinal?: number;
  riseOriginTick?: number;
}

interface ScoreVisualCue {
  ownershipStartFrame: number;
  startFrame: number;
  values: number[];
  beforeScore: number;
  afterScore: number;
}

function boundedSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(10, Math.max(0, value)) : 0;
}

function sampleProgressCurve(curve: number[] | undefined, linear: number): number {
  const clamped = Math.max(0, Math.min(1, linear));
  if (!curve || curve.length < 2) return clamped;
  const position = clamped * (curve.length - 1);
  const left = Math.floor(position);
  const right = Math.min(curve.length - 1, left + 1);
  const fraction = position - left;
  return curve[left]! + (curve[right]! - curve[left]!) * fraction;
}

function resolvedResidualMotionProfiles(
  value: unknown,
): Array<BlockCrushDropClearResidualMotionProfile | undefined> {
  if (!Array.isArray(value)) return [];
  const finite = (source: Record<string, unknown>, key: string): number | undefined => {
    const candidate = source[key];
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
  };
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const source = entry as Record<string, unknown>;
    const startLifetimeProgress = finite(source, 'startLifetimeProgress');
    const rampLifetimeProgress = finite(source, 'rampLifetimeProgress');
    const horizontalAmplitudeCells = finite(source, 'horizontalAmplitudeCells');
    const verticalAmplitudeCells = finite(source, 'verticalAmplitudeCells');
    const horizontalAngularVelocity = finite(
      source,
      'horizontalAngularVelocityRadiansPerCanonicalFrame',
    );
    const verticalAngularVelocity = finite(
      source,
      'verticalAngularVelocityRadiansPerCanonicalFrame',
    );
    const horizontalPhaseOffsetRadians = finite(source, 'horizontalPhaseOffsetRadians');
    const verticalZeroCrossingCanonicalFrame = finite(source, 'verticalZeroCrossingCanonicalFrame');
    if (
      startLifetimeProgress === undefined ||
      rampLifetimeProgress === undefined ||
      horizontalAmplitudeCells === undefined ||
      verticalAmplitudeCells === undefined ||
      horizontalAngularVelocity === undefined ||
      verticalAngularVelocity === undefined ||
      horizontalPhaseOffsetRadians === undefined ||
      verticalZeroCrossingCanonicalFrame === undefined
    )
      return undefined;
    return {
      startLifetimeProgress: Math.max(0, Math.min(1, startLifetimeProgress)),
      rampLifetimeProgress: Math.max(0.001, Math.min(1, rampLifetimeProgress)),
      horizontalAmplitudeCells: Math.max(0, Math.min(4, horizontalAmplitudeCells)),
      verticalAmplitudeCells: Math.max(0, Math.min(4, verticalAmplitudeCells)),
      horizontalAngularVelocityRadiansPerCanonicalFrame: Math.max(
        -Math.PI,
        Math.min(Math.PI, horizontalAngularVelocity),
      ),
      verticalAngularVelocityRadiansPerCanonicalFrame: Math.max(
        -Math.PI,
        Math.min(Math.PI, verticalAngularVelocity),
      ),
      horizontalPhaseOffsetRadians: Math.max(-1_000, Math.min(1_000, horizontalPhaseOffsetRadians)),
      verticalZeroCrossingCanonicalFrame: Math.max(
        -10_000,
        Math.min(10_000, verticalZeroCrossingCanonicalFrame),
      ),
    };
  });
}

function resolvedFragmentAppearanceProfiles(
  value: unknown,
): Array<BlockCrushDropFragmentAppearanceProfile | undefined> {
  if (!Array.isArray(value)) return [];
  const finite = (source: Record<string, unknown>, key: string): number | undefined => {
    const candidate = source[key];
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
  };
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const source = entry as Record<string, unknown>;
    const baseScale = finite(source, 'baseScale');
    const releaseGrowthScale = finite(source, 'releaseGrowthScale');
    const releaseGrowthEnd = finite(source, 'releaseGrowthEndLifetimeProgress');
    const releaseGrowthFade = finite(source, 'releaseGrowthFadeLifetimeProgress');
    const clusterScatterCells = finite(source, 'clusterScatterCells');
    const fragmentScatterCells = finite(source, 'fragmentScatterCells');
    const scatterStartReleaseAge = finite(source, 'scatterStartReleaseAge');
    const frontTextureEndBlend = finite(source, 'frontTextureEndBlend');
    const frontTextureFadeStart = finite(source, 'frontTextureFadeStartLifetimeProgress');
    const frontTextureFade = finite(source, 'frontTextureFadeLifetimeProgress');
    const relaxConstraintsAfter = finite(source, 'relaxConstraintsAfterMotionStep');
    const relaxedConstraintIterations = finite(source, 'relaxedConstraintIterations');
    if (
      baseScale === undefined ||
      releaseGrowthScale === undefined ||
      clusterScatterCells === undefined ||
      fragmentScatterCells === undefined ||
      scatterStartReleaseAge === undefined
    )
      return undefined;
    const physics =
      source.inertialPhysics && typeof source.inertialPhysics === 'object'
        ? (source.inertialPhysics as Record<string, unknown>)
        : undefined;
    const physical = (key: string, fallback: number, min: number, max: number) =>
      Math.max(min, Math.min(max, physics ? (finite(physics, key) ?? fallback) : fallback));
    return {
      ...(physics
        ? {
            inertialPhysics: {
              ...(physics.gravityEnvelope && typeof physics.gravityEnvelope === 'object'
                ? {
                    gravityEnvelope: {
                      ...(physics.gravityEnvelope as {
                        startFrame: number;
                        transitionFrames: number;
                        targetGravity: number;
                      }),
                    },
                  }
                : {}),
              ...(physics.meshAngularRelease && typeof physics.meshAngularRelease === 'object'
                ? {
                    meshAngularRelease: {
                      ...(physics.meshAngularRelease as {
                        holdFrames: number;
                        fadeFrames: number;
                        targetStiffness: number;
                      }),
                    },
                  }
                : {}),
              gravity: physical('gravity', 24, 0, 100),
              damping: physical('damping', 0.35, 0, 10),
              releaseFrontFrames: physical('releaseFrontFrames', 25, 0, 120),
              bondLifetimeFrames: physical('bondLifetimeFrames', 22, 0, 120),
              radius: physical('radius', 0.25, 0.05, 0.75),
              restitution: physical('restitution', 0.1, 0, 1),
              observationStrength: physical('observationStrength', 80, 0, 400),
              ...(Array.isArray(physics.releaseSegments)
                ? {
                    releaseSegments: (physics.releaseSegments as Array<Record<string, unknown>>)
                      .filter(
                        (segment) =>
                          segment &&
                          ['at', 'releaseFrame', 'detachFrame'].every(
                            (key) => finite(segment, key) !== undefined,
                          ),
                      )
                      .map((segment) => ({
                        at: Math.max(0, Math.min(1, finite(segment, 'at')!)),
                        releaseFrame: Math.max(0, Math.min(900, finite(segment, 'releaseFrame')!)),
                        detachFrame: Math.max(0, Math.min(900, finite(segment, 'detachFrame')!)),
                      })),
                  }
                : {}),
              ...(finite(physics, 'bondReleaseDurationFrames') !== undefined
                ? {
                    bondReleaseDurationFrames: physical(
                      'bondReleaseDurationFrames',
                      5.4,
                      0.25,
                      120,
                    ),
                  }
                : {}),
              ...(finite(physics, 'bondCompliance') !== undefined
                ? { bondCompliance: physical('bondCompliance', 0, 0, 0.1) }
                : {}),
              ...(physics.sharedContact === true ? { sharedContact: true } : {}),
              ...(physics.contactShape === 'box' ? { contactShape: 'box' as const } : {}),
              ...(physics.bondedContact === true ? { bondedContact: true } : {}),
              ...(physics.depthLayers === 2 ? { depthLayers: 2 as const } : {}),
              ...(Array.isArray(physics.releaseSpinScale) && physics.releaseSpinScale.length === 3
                ? {
                    releaseSpinScale: physics.releaseSpinScale.map((v) =>
                      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(4, v)) : 1,
                    ) as [number, number, number],
                  }
                : {}),
              ...Object.fromEntries(
                [
                  ['meshBendCompliance', 0, 0.1],
                  ['meshBreakStrain', 0.01, 10],
                  ['meshBreakFrames', 0.25, 120],
                  ['meshTearDelayFrames', 0, 120],
                  ['meshAngularStiffness', 0, 400],
                  ['meshAnchorStiffness', 0, 400],
                  ['meshAttachmentStiffness', 0, 400],
                  ['meshFractureEnergyRetention', 0, 1],
                  ['fractureSpinSpeed', 0, 8],
                  ['materialSeed', 0, 4294967295],
                ].flatMap(([key, min, max]) =>
                  finite(physics, key as string) === undefined
                    ? []
                    : [[key, physical(key as string, 0, min as number, max as number)]],
                ),
              ),
              ...(finite(physics, 'separationVariation') !== undefined
                ? { separationVariation: physical('separationVariation', 0, 0, 1) }
                : {}),
              ...(finite(physics, 'separationSpeed') !== undefined
                ? { separationSpeed: physical('separationSpeed', 0, 0, 12) }
                : {}),
            },
          }
        : {}),
      ...Object.fromEntries(
        ['exitFadeFrames', 'cutFaceAmbient', 'topFaceAmbient', 'cutFaceTint'].flatMap((key) =>
          finite(source, key) === undefined ? [] : [[key, finite(source, key)!]],
        ),
      ),
      baseScale: Math.max(0.1, Math.min(1.5, baseScale)),
      releaseGrowthScale: Math.max(0, Math.min(1, releaseGrowthScale)),
      ...(releaseGrowthEnd !== undefined
        ? {
            releaseGrowthEndLifetimeProgress: Math.max(0, Math.min(1, releaseGrowthEnd)),
          }
        : {}),
      ...(releaseGrowthFade !== undefined
        ? {
            releaseGrowthFadeLifetimeProgress: Math.max(0.001, Math.min(1, releaseGrowthFade)),
          }
        : {}),
      clusterScatterCells: Math.max(0, Math.min(8, clusterScatterCells)),
      fragmentScatterCells: Math.max(0, Math.min(8, fragmentScatterCells)),
      scatterStartReleaseAge: Math.max(0, Math.min(0.99, scatterStartReleaseAge)),
      ...(frontTextureEndBlend !== undefined
        ? {
            frontTextureEndBlend: Math.max(0, Math.min(1, frontTextureEndBlend)),
          }
        : {}),
      ...(frontTextureFadeStart !== undefined
        ? {
            frontTextureFadeStartLifetimeProgress: Math.max(0, Math.min(1, frontTextureFadeStart)),
          }
        : {}),
      ...(frontTextureFade !== undefined
        ? {
            frontTextureFadeLifetimeProgress: Math.max(0.001, Math.min(1, frontTextureFade)),
          }
        : {}),
      ...(relaxConstraintsAfter !== undefined
        ? {
            relaxConstraintsAfterMotionStep: Math.max(
              0,
              Math.min(120, Math.round(relaxConstraintsAfter)),
            ),
          }
        : {}),
      ...(relaxedConstraintIterations !== undefined
        ? {
            relaxedConstraintIterations: Math.max(
              1,
              Math.min(12, Math.round(relaxedConstraintIterations)),
            ),
          }
        : {}),
    };
  });
}

function resolvedObservedFragmentMotionProfiles(
  value: unknown,
): Array<BlockCrushDropObservedFragmentMotionProfile | undefined> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const source = entry as Record<string, unknown>;
    const finite = (key: string): number | undefined => {
      const candidate = source[key];
      return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
    };
    const canonicalFps = finite('canonicalFps');
    const gridX = finite('gridX');
    const gridTop = finite('gridTop');
    const cellPitch = finite('cellPitch');
    const subColumns = finite('subColumns');
    const minimumTracks = finite('minimumTracksPerSubColumn');
    const interpolationMinimumCoverage = finite('interpolationMinimumCoverage');
    if (
      source.coordinateSpace !== 'source-stage-pixels' ||
      canonicalFps === undefined ||
      canonicalFps <= 0 ||
      gridX === undefined ||
      gridTop === undefined ||
      cellPitch === undefined ||
      cellPitch <= 0 ||
      subColumns === undefined ||
      subColumns < 1 ||
      minimumTracks === undefined ||
      minimumTracks < 1 ||
      !Array.isArray(source.frames)
    )
      return undefined;
    const frames = source.frames
      .flatMap((frame): BlockCrushDropObservedFragmentMotionProfile['frames'] => {
        if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return [];
        const frameSource = frame as Record<string, unknown>;
        const frameOffset = frameSource.frameOffset;
        if (
          typeof frameOffset !== 'number' ||
          !Number.isFinite(frameOffset) ||
          frameOffset < 0 ||
          !Array.isArray(frameSource.tracks)
        )
          return [];
        const tracks = frameSource.tracks.flatMap((track): Array<[number, number, number]> => {
          if (!Array.isArray(track) || track.length !== 3) return [];
          const [id, x, y] = track;
          if (
            typeof id !== 'number' ||
            !Number.isInteger(id) ||
            id < 0 ||
            typeof x !== 'number' ||
            !Number.isFinite(x) ||
            typeof y !== 'number' ||
            !Number.isFinite(y)
          )
            return [];
          return [[id, x, y]];
        });
        return [{ frameOffset: Math.round(frameOffset), tracks }];
      })
      .sort((left, right) => left.frameOffset - right.frameOffset);
    if (frames.length === 0) return undefined;
    return {
      coordinateSpace: 'source-stage-pixels',
      canonicalFps: Math.max(1, Math.min(240, canonicalFps)),
      gridX,
      gridTop,
      cellPitch,
      subColumns: Math.max(1, Math.min(256, Math.round(subColumns))),
      minimumTracksPerSubColumn: Math.max(1, Math.min(32, Math.round(minimumTracks))),
      ...(interpolationMinimumCoverage !== undefined
        ? {
            interpolationMinimumCoverage: Math.max(0, Math.min(1, interpolationMinimumCoverage)),
          }
        : {}),
      frames,
    };
  });
}

function resolveDirectorTiming(profile: unknown, fps: number): ResolvedDirectorTiming {
  const source =
    profile && typeof profile === 'object' && !Array.isArray(profile)
      ? (profile as Record<string, unknown>)
      : {};
  if (source.stepFramesByAction !== undefined && !Array.isArray(source.stepFramesByAction))
    throw new Error('stepFramesByAction must be an array.');
  const stepFramesByAction = ((source.stepFramesByAction ?? []) as unknown[]).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('Step timing must be an object.');
    return Object.fromEntries(
      Object.entries(entry).map(([key, value]) => {
        if (
          !/^(?:detect|resolve|reconfigure|active-gravity|settle|field-advance):\d+$|^contact-stack:\d+:\d+$|^outcome$/.test(
            key,
          ) ||
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < (/^(?:detect|settle|field-advance):/.test(key) ? 0 : 1) ||
          value > 300
        )
          throw new Error(`Invalid step timing ${key}.`);
        return [key, Math.max(value === 0 ? 0 : 1, Math.round((value * fps) / 30))];
      }),
    );
  });
  if (
    source.stepProgressByAction !== undefined &&
    (!Array.isArray(source.stepProgressByAction) || source.stepProgressByAction.length > 500)
  )
    throw new Error('stepProgressByAction must be an array of at most 500 step maps.');
  const stepProgressByAction = ((source.stepProgressByAction ?? []) as unknown[]).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('Step progress must be an object.');
    return Object.fromEntries(
      Object.entries(entry).map(([key, curve]) => {
        if (
          !/^(?:reconfigure|active-gravity):\d+$|^contact-stack:\d+:\d+$/.test(key) ||
          !Array.isArray(curve) ||
          curve.length < 2 ||
          curve.length > 301 ||
          curve[0] !== 0 ||
          curve.at(-1) !== 1 ||
          curve.some(
            (v, i) =>
              typeof v !== 'number' ||
              !Number.isFinite(v) ||
              v < 0 ||
              v > 1 ||
              (i > 0 && v < curve[i - 1]),
          )
        )
          throw new Error(`Invalid movement curve ${key}.`);
        return [key, [...curve] as number[]];
      }),
    );
  });
  if (
    source.gravityLeadFramesByAction !== undefined &&
    (!Array.isArray(source.gravityLeadFramesByAction) ||
      source.gravityLeadFramesByAction.length > 500)
  )
    throw new Error('gravityLeadFramesByAction must be an array of at most 500 step maps.');
  const gravityLeadFramesByAction = ((source.gravityLeadFramesByAction ?? []) as unknown[]).map(
    (entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        throw new Error('Gravity lead must be an object.');
      return Object.fromEntries(
        Object.entries(entry).map(([key, value]) => {
          if (
            !/^(?:reconfigure|active-gravity):\d+$|^contact-stack:\d+:\d+$/.test(key) ||
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < 0 ||
            value > 90
          )
            throw new Error(`Invalid gravity lead ${key}.`);
          return [key, Math.round((value * fps) / 30)];
        }),
      );
    },
  );
  if (
    source.stepTailFramesByAction !== undefined &&
    (!Array.isArray(source.stepTailFramesByAction) || source.stepTailFramesByAction.length > 500)
  )
    throw new Error('stepTailFramesByAction must be an array of at most 500 step maps.');
  const stepTailFramesByAction = ((source.stepTailFramesByAction ?? []) as unknown[]).map(
    (entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        throw new Error('Movement tail must be an object.');
      return Object.fromEntries(
        Object.entries(entry).map(([key, value]) => {
          if (
            !/^(?:reconfigure|active-gravity):\d+$/.test(key) ||
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < 0 ||
            value > 15
          )
            throw new Error(`Invalid movement tail ${key}.`);
          return [key, Math.round((value * fps) / 30)];
        }),
      );
    },
  );
  const phaseFramesByAction = Array.isArray(source.phaseFramesByAction)
    ? source.phaseFramesByAction.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return {};
        return Object.fromEntries(
          Object.entries(entry as Record<string, unknown>).flatMap(([phase, value]) =>
            typeof value === 'number' && Number.isFinite(value) && value >= 1
              ? [[phase, Math.round((value * fps) / 30)]]
              : [],
          ),
        ) as Partial<Record<EliminationResolutionPhase, number>>;
      })
    : [];
  const clearEffectFramesByAction = Array.isArray(source.clearEffectFramesByAction)
    ? source.clearEffectFramesByAction.map((value) =>
        typeof value === 'number' && Number.isFinite(value) && value >= 1
          ? Math.round((value * fps) / 30)
          : undefined,
      )
    : [];
  const pieceSettleFramesByAction = Array.isArray(source.pieceSettleFramesByAction)
    ? source.pieceSettleFramesByAction.map((value) =>
        typeof value === 'number' && Number.isFinite(value) && value >= 1
          ? Math.max(1, Math.round((value * fps) / 30))
          : undefined,
      )
    : [];
  const clearMotionFramesByAction = Array.isArray(source.clearMotionFramesByAction)
    ? source.clearMotionFramesByAction.map((value) =>
        typeof value === 'number' && Number.isFinite(value) && value >= 1
          ? Math.round((value * fps) / 30)
          : undefined,
      )
    : [];
  const normalizedProgressCurves = (value: unknown): Array<number[] | undefined> =>
    Array.isArray(value)
      ? value.map((entry) =>
          Array.isArray(entry) && entry.length >= 2
            ? entry
                .filter(
                  (sample): sample is number =>
                    typeof sample === 'number' && Number.isFinite(sample),
                )
                .map((sample) => Math.max(0, Math.min(1, sample)))
            : undefined,
        )
      : [];
  const clearMotionProgressByAction = normalizedProgressCurves(source.clearMotionProgressByAction);
  const clearFragmentTiltScaleByAction = Array.isArray(source.clearFragmentTiltScaleByAction)
    ? source.clearFragmentTiltScaleByAction.map((value) =>
        typeof value === 'number' && Number.isFinite(value)
          ? Math.max(0, Math.min(2, value))
          : undefined,
      )
    : [];
  const clearFragmentMotionBlurByAction = Array.isArray(source.clearFragmentMotionBlurByAction)
    ? source.clearFragmentMotionBlurByAction.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
        const candidate = entry as Record<string, unknown>;
        const scale = candidate.scale;
        const start = candidate.startLifetimeProgress;
        const end = candidate.endLifetimeProgress;
        const ramp = candidate.rampLifetimeProgress;
        if (
          typeof scale !== 'number' ||
          !Number.isFinite(scale) ||
          typeof start !== 'number' ||
          !Number.isFinite(start) ||
          typeof end !== 'number' ||
          !Number.isFinite(end) ||
          typeof ramp !== 'number' ||
          !Number.isFinite(ramp)
        )
          return undefined;
        const startLifetimeProgress = Math.max(0, Math.min(1, start));
        const endLifetimeProgress = Math.max(startLifetimeProgress, Math.min(1, end));
        return {
          scale: Math.max(0, Math.min(2, scale)),
          startLifetimeProgress,
          endLifetimeProgress,
          rampLifetimeProgress: Math.max(0.001, Math.min(1, ramp)),
        };
      })
    : [];
  const clearObservedFragmentMotionByAction = resolvedObservedFragmentMotionProfiles(
    source.clearObservedFragmentMotionByAction,
  );
  const clearFragmentAppearanceByAction = resolvedFragmentAppearanceProfiles(
    source.clearFragmentAppearanceByAction,
  );
  const clearFragmentFoldSpreadByAction = Array.isArray(source.clearFragmentFoldSpreadByAction)
    ? source.clearFragmentFoldSpreadByAction.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
        const candidate = entry as Record<string, unknown>;
        const start = candidate.startMotionProgress;
        const ramp = candidate.rampMotionProgress;
        const horizontalScale = candidate.horizontalScale;
        const verticalScale = candidate.verticalScale;
        const pivotXNormalized = candidate.pivotXNormalized;
        const pivotYOffsetCells = candidate.pivotYOffsetCells;
        if (
          typeof start !== 'number' ||
          !Number.isFinite(start) ||
          typeof ramp !== 'number' ||
          !Number.isFinite(ramp) ||
          typeof horizontalScale !== 'number' ||
          !Number.isFinite(horizontalScale) ||
          typeof verticalScale !== 'number' ||
          !Number.isFinite(verticalScale) ||
          typeof pivotXNormalized !== 'number' ||
          !Number.isFinite(pivotXNormalized) ||
          typeof pivotYOffsetCells !== 'number' ||
          !Number.isFinite(pivotYOffsetCells)
        )
          return undefined;
        return {
          startMotionProgress: Math.max(0, Math.min(1, start)),
          rampMotionProgress: Math.max(0.001, Math.min(1, ramp)),
          horizontalScale: Math.max(0.5, Math.min(2, horizontalScale)),
          verticalScale: Math.max(0.5, Math.min(2, verticalScale)),
          pivotXNormalized: Math.max(0, Math.min(1, pivotXNormalized)),
          pivotYOffsetCells: Math.max(-30, Math.min(30, pivotYOffsetCells)),
        };
      })
    : [];
  const clearResidualMotionByAction = resolvedResidualMotionProfiles(
    source.clearResidualMotionByAction,
  );
  const cycleTimingsByAction = Array.isArray(source.cycleTimingsByAction)
    ? (source.cycleTimingsByAction as Array<Array<BlockCrushDropCycleTiming> | undefined>).map(
        (cycles, actionIndex) =>
          Array.isArray(cycles)
            ? cycles.map((cycle) => {
                const scaled = (n: number | undefined) =>
                  typeof n === 'number' && Number.isFinite(n)
                    ? Math.round((n * fps) / 30)
                    : undefined;
                const actionAppearance = clearFragmentAppearanceByAction[actionIndex];
                const override = cycle.fragmentAppearance;
                const mergedAppearance = override
                  ? resolvedFragmentAppearanceProfiles([
                      {
                        ...BLOCK_CRUSH_DROP_DEFAULT_FRAGMENT_APPEARANCE,
                        ...actionAppearance,
                        ...override,
                        ...(actionAppearance?.inertialPhysics || override.inertialPhysics
                          ? {
                              inertialPhysics: {
                                ...actionAppearance?.inertialPhysics,
                                ...override.inertialPhysics,
                              },
                            }
                          : {}),
                      },
                    ])[0]
                  : undefined;
                return {
                  ...cycle,
                  fragmentAppearance: mergedAppearance,
                  phaseFrames: Object.fromEntries(
                    Object.entries(cycle.phaseFrames ?? {}).map(([phase, frames]) => [
                      phase,
                      Math.max(1, scaled(frames) ?? 1),
                    ]),
                  ),
                  gravityFrames: scaled(cycle.gravityFrames),
                  clearEffectFrames: scaled(cycle.clearEffectFrames),
                  clearMotionFrames: scaled(cycle.clearMotionFrames),
                  clearEffectStartOffsetFrames: scaled(cycle.clearEffectStartOffsetFrames),
                  clearMotionStartOffsetFrames: scaled(cycle.clearMotionStartOffsetFrames),
                  reconfigureProgress: normalizedProgressCurves([cycle.reconfigureProgress])[0],
                };
              })
            : undefined,
      )
    : [];
  const reconfigureProgressByAction = normalizedProgressCurves(source.reconfigureProgressByAction);
  const settleBounceCellsByAction = Array.isArray(source.settleBounceCellsByAction)
    ? source.settleBounceCellsByAction.map((value) =>
        typeof value === 'number' && Number.isFinite(value)
          ? Math.max(0, Math.min(1, value))
          : undefined,
      )
    : [];
  const frameOffsets = (value: unknown): Array<number | undefined> =>
    Array.isArray(value)
      ? value.map((entry) =>
          typeof entry === 'number' && Number.isFinite(entry) && entry >= 0
            ? Math.round((entry * fps) / 30)
            : undefined,
        )
      : [];
  const clearEffectStartOffsetFramesByAction = frameOffsets(
    source.clearEffectStartOffsetFramesByAction,
  );
  const clearMotionStartOffsetFramesByAction = frameOffsets(
    source.clearMotionStartOffsetFramesByAction,
  );
  const clearRowStaggerFramesByAction = frameOffsets(source.clearRowStaggerFramesByAction);
  const scoreRevealByAction = Array.isArray(source.scoreRevealByAction)
    ? source.scoreRevealByAction.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
        const candidate = entry as Record<string, unknown>;
        const rawProgress = Array.isArray(candidate.normalizedProgress)
          ? candidate.normalizedProgress
              .filter(
                (value): value is number => typeof value === 'number' && Number.isFinite(value),
              )
              .map((value) => Math.max(0, Math.min(1, value)))
          : [];
        if (rawProgress.length === 0) return undefined;
        const outputLength = Math.max(1, Math.round(((rawProgress.length - 1) * fps) / 30) + 1);
        const normalizedProgress = Array.from({ length: outputLength }, (_, index) => {
          if (outputLength === 1 || rawProgress.length === 1) return rawProgress[0]!;
          const sourcePosition = (index * (rawProgress.length - 1)) / (outputLength - 1);
          const left = Math.floor(sourcePosition);
          const right = Math.min(rawProgress.length - 1, left + 1);
          const fraction = sourcePosition - left;
          return rawProgress[left]! + (rawProgress[right]! - rawProgress[left]!) * fraction;
        });
        const startOffset =
          typeof candidate.startOffsetFromImpactFrames === 'number' &&
          Number.isFinite(candidate.startOffsetFromImpactFrames)
            ? Math.round((candidate.startOffsetFromImpactFrames * fps) / 30)
            : 0;
        return { startOffsetFromImpactFrames: startOffset, normalizedProgress };
      })
    : [];
  const countdownStartSeconds =
    typeof source.countdownStartSeconds === 'number' &&
    Number.isFinite(source.countdownStartSeconds)
      ? Math.max(0, Math.round(source.countdownStartSeconds))
      : undefined;
  const countdownTickFrames = Array.isArray(source.countdownTickFrames)
    ? [
        ...new Set(
          source.countdownTickFrames.flatMap((value) =>
            typeof value === 'number' && Number.isFinite(value) && value >= 0
              ? [Math.round((value * fps) / 30)]
              : [],
          ),
        ),
      ].sort((left, right) => left - right)
    : [];
  return {
    ...(typeof source.clearExposureSeconds === 'number' && source.clearExposureSeconds > 0
      ? { clearExposureSeconds: source.clearExposureSeconds }
      : {}),
    leadInFrames: Math.round(boundedSeconds(source.leadInSeconds) * fps),
    betweenActionsFrames: Math.round(boundedSeconds(source.betweenActionsSeconds) * fps),
    tailFrames: Math.round(boundedSeconds(source.tailSeconds) * fps),
    phaseFramesByAction,
    stepFramesByAction,
    stepProgressByAction,
    gravityLeadFramesByAction,
    stepTailFramesByAction,
    pieceSettleFramesByAction,
    clearEffectFramesByAction,
    clearMotionFramesByAction,
    clearMotionStartOffsetFramesByAction,
    clearMotionProgressByAction,
    clearFragmentTiltScaleByAction,
    clearFragmentMotionBlurByAction,
    clearObservedFragmentMotionByAction,
    clearFragmentAppearanceByAction,
    clearFragmentFoldSpreadByAction,
    clearResidualMotionByAction,
    cycleTimingsByAction,
    reconfigureProgressByAction,
    settleBounceCellsByAction,
    clearEffectStartOffsetFramesByAction,
    clearRowStaggerFramesByAction,
    scoreRevealByAction,
    ...(countdownStartSeconds !== undefined ? { countdownStartSeconds } : {}),
    countdownTickFrames,
  };
}

function phaseFrames(
  phase: EliminationResolutionPhase,
  fps: number,
  frameCursor: number,
  action?: BlockCrushDropAction,
  actionIndex?: number,
  timing?: ResolvedDirectorTiming,
): number {
  if (phase === 'commit' && action) {
    const impactFrame = Math.round((action.impactTick * fps) / 30);
    return Math.max(1, impactFrame - frameCursor);
  }
  const override =
    actionIndex === undefined ? undefined : timing?.phaseFramesByAction[actionIndex]?.[phase];
  if (override !== undefined) return Math.max(1, override);
  return Math.max(1, Math.round(PHASE_SECONDS[phase] * fps));
}

function feedbackForPhase(
  phase: EliminationResolutionPhase | 'idle',
): PresentationPacket['feedback'] {
  switch (phase) {
    case 'commit':
      return { cameraPunch: 0.28, screenShake: { x: 0, y: 0.08 } };
    case 'resolve':
      return { cameraPunch: 0.48, exposurePulse: 0.18 };
    case 'reconfigure':
      return { cameraPunch: 0.12, screenShake: { x: 0.03, y: 0.05 } };
    default:
      return { cameraPunch: 0 };
  }
}

function eventForStep(step: EliminationResolutionStep): SemanticGameEvent {
  return {
    id: step.id,
    type: EVENT_TYPES[step.phase],
    category: step.phase,
    tags: [...step.tags],
    entityIds: [...step.entityIds],
    payload: {
      cycleIndex: step.cycleIndex,
      deltas: step.deltas,
      metrics: step.metrics,
    },
  };
}

export function blockCrushDropFrameFromPacket(
  packet: PresentationPacket,
): BlockCrushDropPresentationFrame {
  if (packet.payloadSchemaId !== BLOCK_CRUSH_DROP_PRESENTATION_SCHEMA_ID) {
    throw new Error(`Unsupported presentation schema ${packet.payloadSchemaId}.`);
  }
  return packet.payload as BlockCrushDropPresentationFrame;
}

export const blockCrushDropPresentationAdapter: PresentationCompilerAdapter = {
  gameId: BLOCK_CRUSH_DROP_GAME_ID,
  compile(input) {
    if (
      input.project.game.id !== BLOCK_CRUSH_DROP_GAME_ID ||
      input.replay.gameId !== BLOCK_CRUSH_DROP_GAME_ID
    ) {
      throw new Error('Block 落消 presentation requires matching project and replay game ids.');
    }
    const timing = resolveDirectorTiming(input.directorProfile, input.fps);
    let cursor = blockCrushDropStateSchema.parse(input.project.initialState.data);
    const calibration = cursor.config.presentation.referenceCalibration;
    const fragmentPhysics = calibration?.clear?.fragmentPhysics;
    const observedV2Cues =
      calibration?.observedFragmentMotionCues?.filter((cue) =>
        isDropObservedFragmentMotionV2(cue.motion),
      ) ?? [];
    const consumedObservedV2 = new Set<string>();
    const timeline: TimelineStep[] = [];
    const clearVisualCues: ClearVisualCue[] = [];
    const scoreVisualCues: ScoreVisualCue[] = [];
    const resolutions: BlockCrushDropResolution[] = [];
    let frameCursor = timing.leadInFrames;
    input.replay.actions.forEach((envelope, stepIndex) => {
      if (stepIndex > 0) frameCursor += timing.betweenActionsFrames;
      const action = blockCrushDropActionSchema.parse(envelope.action);
      const resolved = blockCrushDropRuntime.resolve(cursor, action, {
        seed: input.replay.seed,
        stepIndex,
      });
      const resolution: BlockCrushDropResolution = {
        ...resolved,
        trace: { ...resolved.trace, actionId: envelope.id },
      };
      const scoreReveal = timing.scoreRevealByAction[stepIndex];
      if (scoreReveal) {
        const scoreDelta = resolution.after.score - resolution.before.score;
        const impactFrame = Math.round((action.impactTick * input.fps) / 30);
        scoreVisualCues.push({
          ownershipStartFrame: impactFrame,
          startFrame: impactFrame + scoreReveal.startOffsetFromImpactFrames,
          beforeScore: resolution.before.score,
          afterScore: resolution.after.score,
          values: scoreReveal.normalizedProgress.map((progress) =>
            Math.round(resolution.before.score + scoreDelta * progress),
          ),
        });
      }
      const interaction = input.replay.interactions.find(
        (item) => item.committedActionId === envelope.id,
      );
      resolutions.push(resolution);
      const trayPiece = cursor.config.trayBatches[cursor.batchIndex]?.[action.traySlot];
      const pieceKind =
        cursor.config.pieces.find((piece) => piece.id === trayPiece?.pieceId)?.kind ??
        'embossed-star';
      let intermediateCells = resolution.before.cells.map((cell) => ({ ...cell }));
      const authoredClearColors =
        cursor.config.presentation.referenceCalibration?.clear?.colorByAction?.[stepIndex];
      if (
        authoredClearColors &&
        authoredClearColors.length >
          resolution.trace.steps.filter((s) => s.phase === 'resolve').length
      )
        throw new Error(
          `Clear colour sequence ${stepIndex} has more colours than clear cycles in this Take.`,
        );
      const eliminatedCells: BlockCrushDropCell[] = [];
      const cascade = Boolean(cursor.config.rules.settlement);
      const stepTiming = timing.stepFramesByAction[stepIndex] ?? {};
      const stepProgress = timing.stepProgressByAction[stepIndex] ?? {};
      const gravityLeads = timing.gravityLeadFramesByAction[stepIndex] ?? {};
      const gravityTails = timing.stepTailFramesByAction[stepIndex] ?? {};
      const suffix = (id: string) => id.slice(id.indexOf(':') + 1);
      const actualStepKeys = new Set(resolution.trace.steps.map((step) => suffix(step.id)));
      for (const key of Object.keys(stepTiming))
        if (!actualStepKeys.has(key))
          throw new Error(`Step timing ${stepIndex}/${key} does not match this Take.`);
      for (const key of Object.keys(stepProgress))
        if (!actualStepKeys.has(key))
          throw new Error(`Step movement ${stepIndex}/${key} does not match this Take.`);
      for (const key of Object.keys(gravityLeads))
        if (!actualStepKeys.has(key))
          throw new Error(`Gravity lead ${stepIndex}/${key} does not match this Take.`);
      for (const key of Object.keys(gravityTails))
        if (!actualStepKeys.has(key))
          throw new Error(`Gravity tail ${stepIndex}/${key} does not match this Take.`);
      const cutCascade = cursor.config.rules.settlement === 'cut-component-cascade';
      let intermediateScore = resolution.before.score;
      const ownsFieldSteps = resolution.trace.steps.some((step) =>
        step.tags.includes('cascade-field-advance'),
      );
      const elapsedField =
        resolution.before.riseOffsetTicks +
        blockCrushFieldClock(resolution.before.config, action.impactTick) -
        blockCrushFieldClock(resolution.before.config, resolution.before.tick);
      let intermediateFieldBasis = {
        tick: action.impactTick,
        riseOffsetTicks: elapsedField % resolution.before.config.rules.fieldMotion.ticksPerCell,
        incomingRowIndex:
          resolution.before.incomingRowIndex +
          Math.floor(elapsedField / resolution.before.config.rules.fieldMotion.ticksPerCell),
      };
      for (const step of resolution.trace.steps) {
        const fieldBasisBefore =
          step.phase === 'commit'
            ? {
                tick: resolution.before.tick,
                riseOffsetTicks: resolution.before.riseOffsetTicks,
                incomingRowIndex: resolution.before.incomingRowIndex,
              }
            : { ...intermediateFieldBasis };
        if (step.tags.includes('cascade-field-advance')) {
          const m = step.metrics?.objectives;
          const tick = m?.canonicalFieldTick,
            offset = m?.riseOffsetTicks,
            index = m?.incomingRowIndex;
          if (
            typeof tick !== 'number' ||
            !Number.isInteger(tick) ||
            tick < intermediateFieldBasis.tick ||
            typeof offset !== 'number' ||
            !Number.isFinite(offset) ||
            offset < 0 ||
            offset >= resolution.before.config.rules.fieldMotion.ticksPerCell ||
            typeof index !== 'number' ||
            !Number.isInteger(index) ||
            index < intermediateFieldBasis.incomingRowIndex
          )
            throw new Error('Cascade field advance requires its native monotonic field basis.');
          intermediateFieldBasis = { tick, riseOffsetTicks: offset, incomingRowIndex: index };
        }
        const stepBeforeCells = intermediateCells.map((cell) => ({ ...cell }));
        const cycleRemoved: BlockCrushDropCell[] = [];
        for (const delta of step.deltas) {
          if (delta.kind !== 'remove') continue;
          const removed = intermediateCells.find((cell) => cell.id === delta.entityId);
          if (removed) {
            eliminatedCells.push({ ...removed });
            cycleRemoved.push({ ...removed });
          }
        }
        intermediateCells = applyStepDeltas(intermediateCells, step, pieceKind);
        const stepAfterCells = intermediateCells.map((cell) => ({ ...cell }));
        let duration = phaseFrames(step.phase, input.fps, frameCursor, action, stepIndex, timing);
        const cycleTiming = timing.cycleTimingsByAction[stepIndex]?.[step.cycleIndex];
        const gravity =
          step.tags?.includes('active-cell-gravity') ||
          step.tags?.includes('cut-component-gravity');
        if (cascade && !cutCascade && step.phase !== 'commit') {
          const distance = Math.max(
            0,
            ...step.deltas.map((delta) => (delta.kind === 'move' ? delta.from.y - delta.to.y : 0)),
          );
          const seconds = step.tags?.includes('active-cell-gravity')
            ? Math.min(0.8, 0.22 + Math.sqrt(distance) * 0.12)
            : { detect: 0.067, resolve: 0.133, reconfigure: 0.5, settle: 0.133, outcome: 0.033 }[
                step.phase
              ];
          const authored = timing.phaseFramesByAction[stepIndex]?.[step.phase];
          duration = Math.max(
            1,
            step.tags?.includes('active-cell-gravity')
              ? (timing.pieceSettleFramesByAction[stepIndex] ??
                  Math.round(
                    (seconds *
                      input.fps *
                      (timing.phaseFramesByAction[stepIndex]?.reconfigure ?? input.fps * 0.5)) /
                      (input.fps * 0.5),
                  ))
              : (authored ?? Math.round(seconds * input.fps)),
          );
        }
        if (step.phase !== 'commit') {
          const authored = gravity
            ? cycleTiming?.gravityFrames
            : cycleTiming?.phaseFrames?.[step.phase];
          if (authored !== undefined) duration = Math.max(1, authored);
          else if (cutCascade && gravity) duration = Math.max(1, Math.round(input.fps * 0.2));
        }
        const reconfigureCurve = gravity
          ? undefined
          : (cycleTiming?.reconfigureProgress ?? timing.reconfigureProgressByAction[stepIndex]);
        duration = stepTiming[suffix(step.id)] ?? duration;
        const scoreBefore = intermediateScore;
        if (step.phase === 'commit' || step.phase === 'resolve')
          intermediateScore += step.metrics?.score ?? 0;
        const gravityLeadFrames = gravityLeads[suffix(step.id)] ?? 0;
        if (gravityLeadFrames > 0) {
          const previous = [...timeline]
            .reverse()
            .find(
              (item) =>
                !(
                  item.startFrame === item.endFrame &&
                  item.step.tags.includes('cascade-field-advance')
                ),
            );
          const sameWave =
            previous &&
            previous.resolution === resolution &&
            previous.step.cycleIndex === step.cycleIndex;
          if (step.tags.includes('covered-contact-stack')) {
            const compaction = timeline.find(
              (item) =>
                item.resolution === resolution &&
                item.step.cycleIndex === step.cycleIndex &&
                item.step.tags.includes('row-compaction'),
            );
            if (
              !compaction ||
              gravityLeadFrames >
                frameCursor - compaction.startFrame + (compaction.gravityLeadFrames ?? 0)
            )
              throw new Error(
                `Contact lead ${stepIndex}/${suffix(step.id)} must stay inside the compaction and residual motion of the same wave.`,
              );
          } else if (step.tags?.includes('active-cell-gravity')) {
            if (
              !sameWave ||
              !previous.step.tags?.includes('row-compaction') ||
              gravityLeadFrames >
                previous.endFrame - previous.startFrame + (previous.gravityLeadFrames ?? 0)
            )
              throw new Error(
                `Gravity lead ${stepIndex}/${suffix(step.id)} must stay inside the preceding compaction of the same wave.`,
              );
          } else if (
            step.phase !== 'reconfigure' ||
            !sameWave ||
            previous.step.phase !== 'resolve' ||
            gravityLeadFrames > previous.endFrame - previous.startFrame
          ) {
            throw new Error(
              `Compaction lead ${stepIndex}/${suffix(step.id)} must stay inside the preceding resolve of the same wave.`,
            );
          }
        }
        timeline.push({
          startFrame: frameCursor,
          endFrame: frameCursor + duration,
          resolution,
          step,
          stepBeforeCells,
          stepAfterCells,
          eliminatedCells: eliminatedCells.map((cell) => ({ ...cell })),
          ...(gravityLeadFrames > 0 ? { gravityLeadFrames } : {}),
          ...((gravityTails[suffix(step.id)] ?? 0) > 0
            ? { stepTailFrames: gravityTails[suffix(step.id)] }
            : {}),
          ...(ownsFieldSteps
            ? { fieldBasisBefore, fieldBasisAfter: { ...intermediateFieldBasis } }
            : {}),
          ...(cascade ? { scoreBefore, scoreAfter: intermediateScore, settleBounceCells: 0 } : {}),
          ...(interaction ? { interaction } : {}),
          ...(step.phase === 'reconfigure' && reconfigureCurve
            ? { reconfigureProgressCurve: reconfigureCurve }
            : {}),
          ...(step.phase === 'reconfigure' && stepProgress[suffix(step.id)]
            ? { reconfigureProgressCurve: stepProgress[suffix(step.id)] }
            : {}),
          ...(step.phase === 'settle' && timing.settleBounceCellsByAction[stepIndex] !== undefined
            ? { settleBounceCells: timing.settleBounceCellsByAction[stepIndex] }
            : {}),
        });
        if (step.phase === 'resolve') {
          const observed = observedV2Cues.find(
            (cue) => cue.actionIndex === stepIndex && cue.cycleIndex === step.cycleIndex,
          )?.motion;
          const observedV2 = isDropObservedFragmentMotionV2(observed) ? observed : undefined;
          if (
            fragmentPhysics?.sheetDetachAfterReleaseSeconds !== undefined &&
            (observed || timing.clearObservedFragmentMotionByAction[stepIndex])
          )
            throw new Error('DROP_LOCAL_DETACH_OBSERVED_MOTION_CONFLICT');
          if (
            calibration?.clear?.fragmentDisplayFps !== undefined &&
            (observed || timing.clearObservedFragmentMotionByAction[stepIndex])
          )
            throw new Error('DROP_FRAGMENT_DISPLAY_OBSERVED_MOTION_CONFLICT');
          if (observedV2) {
            const ids = new Set((cascade ? cycleRemoved : eliminatedCells).map((cell) => cell.id));
            if (observedV2.particles.some((particle) => !ids.has(particle.cellId)))
              throw new Error('DROP_OBSERVED_FRAGMENT_NATIVE_BINDING_INVALID');
            consumedObservedV2.add(`${stepIndex}:${step.cycleIndex}`);
          }
          const effectFrames =
            cycleTiming?.clearEffectFrames ??
            timing.clearEffectFramesByAction[stepIndex] ??
            (cascade
              ? Math.round(input.fps)
              : fragmentPhysics || observedV2
                ? Math.round((calibration?.clear?.lifetimeSeconds ?? 1) * input.fps)
                : undefined);
          if (effectFrames !== undefined) {
            const startOffset =
              timing.clearEffectStartOffsetFramesByAction[stepIndex] ??
              Math.max(1, Math.round((4 * input.fps) / 30));
            const rowStaggerFrames = timing.clearRowStaggerFramesByAction[stepIndex] ?? 0;
            const originFrame =
              cycleTiming?.clearEffectStartOffsetFrames !== undefined
                ? frameCursor + cycleTiming.clearEffectStartOffsetFrames
                : cascade && !cutCascade
                  ? frameCursor
                  : step.cycleIndex === 0
                    ? Math.round((action.impactTick * input.fps) / 30) + startOffset
                    : frameCursor;
            const preRollFrames = observedV2
              ? Math.min(
                  0,
                  Math.ceil(
                    (dropObservedFragmentFirstFrame(observedV2) * input.fps) /
                      observedV2.canonicalFps,
                  ),
                )
              : 0;
            // The wave alone may begin before its native visual origin. Keys
            // before video frame zero are clipped, never shifted into view.
            const startFrame = Math.max(0, originFrame + preRollFrames);
            const motionStartOffset =
              cycleTiming?.clearMotionStartOffsetFrames ??
              timing.clearMotionStartOffsetFramesByAction[stepIndex] ??
              0;
            // Keep each released column alive until its lowest possible trajectory
            // leaves the screen. This extends only the visual cue, never the Take,
            // clear-sound timestamps, phase durations, or the exported clip.
            const localPhysicsFrames =
              fragmentPhysics?.sheetDetachAfterReleaseSeconds !== undefined && calibration?.clear
                ? Math.ceil(
                    input.fps *
                      calibratedLocalDetachLifetimeSeconds(
                        {
                          fps: input.fps,
                          frameIndex: originFrame,
                          canonicalTick: (originFrame * 30) / input.fps,
                          before: resolution.before,
                          after: resolution.after,
                          fieldRiseOffsetCells: 0,
                          lingeringClear: {
                            elapsedFrames: 0,
                            durationFrames: effectFrames,
                            rowStaggerProgress: 0,
                            eliminatedCells: (cascade ? cycleRemoved : eliminatedCells).map(
                              (cell) => ({ ...cell }),
                            ),
                          },
                        } as BlockCrushDropPresentationFrame,
                        calibration,
                      ),
                  ) + 2
                : undefined;
            const plainDisplayPhysicsFrames =
              fragmentPhysics &&
              calibration?.clear?.fragmentDisplayFps !== undefined &&
              calibration.clear.motionModel === 'ballistic'
                ? Math.ceil(
                    input.fps *
                      (calibration.clear.frontSeconds +
                        (rowStaggerFrames / input.fps) *
                          Math.max(
                            0,
                            new Set(
                              (cascade ? cycleRemoved : eliminatedCells).map((cell) => cell.y),
                            ).size - 1,
                          ) +
                        calibratedFragmentFlightSeconds(
                          calibration.clear.ballisticPrefracture
                            ? Math.min(
                                Math.min(0, calibration.board.y) -
                                  calibration.board.cell * (calibration.board.verticalScale ?? 1),
                                calibration.board.y +
                                  (resolution.before.config.rows -
                                    2 -
                                    Math.max(
                                      ...(cascade ? cycleRemoved : eliminatedCells).map(
                                        (cell) => cell.y,
                                      ),
                                    )) *
                                    calibration.board.cell *
                                    (calibration.board.verticalScale ?? 1),
                              )
                            : Math.min(0, calibration.board.y) -
                                calibration.board.cell * (calibration.board.verticalScale ?? 1),
                          calibration.clear.ballisticPrefracture
                            ? Math.max(
                                (calibration.board.cell / calibration.clear.subdivisions) *
                                  (calibration.clear.fragmentScale ?? 1.1) *
                                  (1 + (calibration.clear.sizeSpread ?? 0)),
                                (calibration.board.cell /
                                  calibration.clear.ballisticPrefracture.coarseSubdivisions) *
                                  Math.max(1, calibration.clear.ballisticPrefracture.coarseScale),
                              )
                            : (calibration.board.cell / calibration.clear.subdivisions) *
                                (calibration.clear.fragmentScale ?? 1.1) *
                                (1 + (calibration.clear.sizeSpread ?? 0)),
                          fragmentPhysics,
                          fragmentPhysics.initialVelocityY - (fragmentPhysics.velocitySpreadY ?? 0),
                        ) +
                        calibratedFragmentDisplayMaximumLag(
                          calibration.clear.fragmentDisplayFps,
                          calibration.clear.fragmentDisplayPhaseSeconds,
                        ) +
                        calibratedBallisticFragmentAgeMaximumDelay(
                          calibration.clear.fragmentAgeOffsetSeconds,
                        )),
                  ) + 2
                : undefined;
            const physicsFrames =
              localPhysicsFrames ??
              plainDisplayPhysicsFrames ??
              (fragmentPhysics && calibration?.clear
                ? Math.ceil(
                    input.fps *
                      (calibration.clear.frontSeconds +
                        (rowStaggerFrames / input.fps) *
                          Math.max(
                            0,
                            new Set(
                              (cascade ? cycleRemoved : eliminatedCells).map((cell) => cell.y),
                            ).size - 1,
                          ) +
                        (fragmentPhysics.sheetDetachSeconds ?? 0) +
                        calibratedFragmentFlightSeconds(
                          Math.min(0, calibration.board.y) -
                            (calibration.clear.sheetLiftPixels ?? 0),
                          calibration.board.cell * (calibration.clear.fragmentScale ?? 1) * 2,
                          fragmentPhysics,
                          fragmentPhysics.initialVelocityY -
                            (fragmentPhysics.velocitySpreadY ?? 0) -
                            ((fragmentPhysics.sheetDetachSeconds ?? 0) > 0 ? 1200 : 0),
                        )),
                  ) + 2
                : effectFrames);
            const measuredFrames = observedV2
              ? Math.ceil(
                  (dropObservedFragmentLastFrame(observedV2) * input.fps) / observedV2.canonicalFps,
                ) + 1
              : 0;
            const cueFrames = Math.max(effectFrames, physicsFrames, measuredFrames);
            clearVisualCues.push({
              actionIndex: stepIndex,
              cycleIndex: step.cycleIndex,
              pieceKind,
              ...(cycleTiming?.sequence ? { sequence: cycleTiming.sequence } : {}),
              startFrame,
              ...(preRollFrames < 0 ? { originFrame } : {}),
              endFrame: originFrame + cueFrames,
              motionStartFrame: originFrame + motionStartOffset,
              motionFrames:
                cycleTiming?.clearMotionFrames ??
                timing.clearMotionFramesByAction[stepIndex] ??
                effectFrames,
              ...((!cycleTiming || step.cycleIndex === 0) &&
              timing.clearMotionProgressByAction[stepIndex]
                ? { motionProgressCurve: timing.clearMotionProgressByAction[stepIndex] }
                : {}),
              ...(timing.clearFragmentTiltScaleByAction[stepIndex] !== undefined
                ? { fragmentTiltScale: timing.clearFragmentTiltScaleByAction[stepIndex] }
                : {}),
              ...(timing.clearFragmentMotionBlurByAction[stepIndex]
                ? { fragmentMotionBlur: timing.clearFragmentMotionBlurByAction[stepIndex] }
                : {}),
              ...((!cycleTiming || step.cycleIndex === 0) &&
              timing.clearObservedFragmentMotionByAction[stepIndex]
                ? { observedFragmentMotion: timing.clearObservedFragmentMotionByAction[stepIndex] }
                : {}),
              ...(observedV2 ? { observedFragmentMotionV2: observedV2 } : {}),
              ...((cycleTiming?.fragmentAppearance ??
              timing.clearFragmentAppearanceByAction[stepIndex])
                ? {
                    fragmentAppearance: (cycleTiming?.fragmentAppearance ??
                      timing.clearFragmentAppearanceByAction[
                        stepIndex
                      ]) as BlockCrushDropFragmentAppearanceProfile,
                  }
                : {}),
              ...(timing.clearFragmentFoldSpreadByAction[stepIndex]
                ? { fragmentFoldSpread: timing.clearFragmentFoldSpreadByAction[stepIndex] }
                : {}),
              ...(timing.clearResidualMotionByAction[stepIndex]
                ? { residualMotion: timing.clearResidualMotionByAction[stepIndex] }
                : {}),
              rowStaggerProgress: Math.min(0.95, rowStaggerFrames / cueFrames),
              eliminatedCells: (cascade ? cycleRemoved : eliminatedCells).map((cell) => ({
                ...cell,
              })),
              ...(cascade
                ? {
                    chainDepth: step.cycleIndex + 1,
                    clearOrdinal: resolution.before.clearEventCount + step.cycleIndex + 1,
                    riseOriginTick: ownsFieldSteps
                      ? blockCrushFieldClock(resolution.after.config, intermediateFieldBasis.tick) -
                        intermediateFieldBasis.riseOffsetTicks
                      : blockCrushFieldClock(resolution.after.config, resolution.after.tick) -
                        resolution.after.riseOffsetTicks,
                  }
                : {}),
            });
          }
        }
        frameCursor += duration;
      }
      cursor = blockCrushDropRuntime.stateAfter(resolved);
    });

    if (consumedObservedV2.size !== observedV2Cues.length)
      throw new Error('DROP_OBSERVED_FRAGMENT_NATIVE_WAVE_MISSING');
    validateDropImpactBeamBindings(calibration?.impactBeamCues, clearVisualCues, input.fps);
    const landingSurfaceFlashes = bindDropLandingSurfaceFlashCues(
      calibration?.landingSurfaceFlashCues,
      calibration?.landingSurfaceFlashCues?.length
        ? resolutions.map((resolution, actionIndex) => {
            const steps = timeline.filter((item) => item.resolution === resolution),
              commit = steps.find((item) => item.step.phase === 'commit');
            // A commit also carries newly rising terrain spawns. Indices refer only
            // to the piece cells authored by this commit, in native shape order.
            const pieceCellPrefix = commit?.step.id.endsWith(':commit')
              ? commit.step.id.slice(0, -7) + ':cell:'
              : undefined;
            return {
              actionIndex,
              originFrame: commit?.endFrame ?? 0,
              endFrame: Math.max(...steps.map((item) => item.endFrame)),
              cellIds: pieceCellPrefix
                ? commit!.step.deltas
                    .filter(
                      (delta) =>
                        delta.kind === 'spawn' && delta.entityId.startsWith(pieceCellPrefix),
                    )
                    .map((delta) => delta.entityId)
                : [],
            };
          })
        : [],
      input.fps,
    );
    if (timing.clearExposureSeconds && ![30, 60].includes(input.fps))
      throw new Error('CRUSH_EXPOSURE_SUPPORTED_FPS_30_OR_60');
    const initial = blockCrushDropStateSchema.parse(input.project.initialState.data);
    const exposureOrdinals = new Map<ClearVisualCue, number>();
    if (timing.clearExposureSeconds) {
      const reserved = new Set(
        clearVisualCues.flatMap((c) => (c.clearOrdinal === undefined ? [] : [c.clearOrdinal])),
      );
      let next = 1;
      [...clearVisualCues]
        .sort((a, b) => Math.max(0, a.startFrame) - Math.max(0, b.startFrame))
        .forEach((cue) => {
          if (cue.clearOrdinal !== undefined) exposureOrdinals.set(cue, cue.clearOrdinal);
          else {
            while (reserved.has(next)) next++;
            exposureOrdinals.set(cue, next++);
          }
        });
    }
    const physicsCueSchedule: NonNullable<BlockCrushDropPresentationFrame['physicsCueSchedule']> =
      clearVisualCues.flatMap((cue) => {
        if (!cue.fragmentAppearance?.inertialPhysics?.sharedContact) return [];
        return [
          {
            startSeconds: cue.startFrame / input.fps,
            endSeconds: cue.endFrame / input.fps,
            ...(cue.sequence ? { sequence: cue.sequence } : {}),
            ...(timing.clearExposureSeconds ? { clearOrdinal: exposureOrdinals.get(cue)! } : {}),
            eliminatedCells: cue.eliminatedCells,
            riseAtStartCells:
              ((cue.startFrame * 30) / input.fps -
                (cue.riseOriginTick ?? initial.tick - initial.riseOffsetTicks)) /
              initial.config.rules.fieldMotion.ticksPerCell,
            fragmentAppearance: cue.fragmentAppearance,
            ...(cue.observedFragmentMotion
              ? { observedFragmentMotion: cue.observedFragmentMotion }
              : {}),
          },
        ];
      });
    if (calibration?.clear?.fragmentGeometry === 'rounded-polyhedron') {
      if (clearVisualCues.some((c) => c.sequence))
        throw new Error('ROUNDED_POLYHEDRON_SEQUENCE_CONFLICT');
      if (clearVisualCues.some((c) => c.observedFragmentMotion || c.observedFragmentMotionV2))
        throw new Error('ROUNDED_POLYHEDRON_OBSERVED_MOTION_CONFLICT');
    }
    if (calibration?.clear?.nativeInertial) {
      if (Math.abs(120 / input.fps - Math.round(120 / input.fps)) > 1e-8)
        throw new Error('DROP_NATIVE_INERTIAL_REQUIRES_120HZ_GRID_FPS');
      const field = initial.config.rules.fieldMotion;
      if (field.pauses?.length || field.rateChanges?.length)
        throw new Error('DROP_NATIVE_INERTIAL_VARIABLE_RISE_UNSUPPORTED');
      if (clearVisualCues.some((c) => c.sequence))
        throw new Error('DROP_NATIVE_INERTIAL_SEQUENCE_CONFLICT');
      if (clearVisualCues.some((c) => c.observedFragmentMotion || c.observedFragmentMotionV2))
        throw new Error('DROP_NATIVE_INERTIAL_OBSERVED_MOTION_CONFLICT');
      if (
        clearVisualCues.some(
          (c) =>
            !c.fragmentAppearance?.inertialPhysics?.sharedContact ||
            c.fragmentAppearance.inertialPhysics.depthLayers !== 2,
        )
      )
        throw new Error('DROP_NATIVE_INERTIAL_REQUIRES_SHARED_TWO_DEPTH_SCHEDULE');
      const bodies = physicsCueSchedule.reduce((sum, c) => sum + c.eliminatedCells.length * 8, 0);
      const historyBytes = physicsCueSchedule.reduce(
        (sum, c) =>
          sum +
          c.eliminatedCells.length *
            8 *
            16 *
            8 *
            (Math.ceil((c.endSeconds - c.startSeconds) * 120) + 1),
        0,
      );
      if (bodies > 8192 || historyBytes > 96 * 1024 * 1024)
        throw new Error('DROP_NATIVE_INERTIAL_WORLD_BUDGET');
    }
    if (
      timing.clearExposureSeconds &&
      clearVisualCues.some(
        (cue) => !cue.sequence && !cue.fragmentAppearance?.inertialPhysics?.sharedContact,
      )
    )
      throw new Error('CRUSH_EXPOSURE_REQUIRES_ALL_CUES_SHARED_INERTIAL');
    const totalFrames = Math.max(frameCursor + timing.tailFrames, 1);
    const encouragementGlyphBindings = bindDropEncouragementGlyphCues(
      calibration?.encouragementGlyphCues,
      clearVisualCues,
      input.fps,
      totalFrames,
    );
    const finalState = resolutions.at(-1)?.after ?? initial;
    const { stepTailFramesByAction: tails, ...legacyTiming } = timing;
    const hashTiming = tails.some((entry) => Object.values(entry).some((value) => value > 0))
      ? timing
      : legacyTiming;
    const frameSourceHash = stableHash({
      gameId: BLOCK_CRUSH_DROP_GAME_ID,
      takeId: input.replay.takeId,
      fps: input.fps,
      timing: hashTiming,
      traces: resolutions.map((resolution) => resolution.trace),
      ...(calibration?.impactBeamCues?.length
        ? { impactBeamCues: calibration.impactBeamCues }
        : {}),
      ...(calibration?.landingSurfaceFlashCues?.length
        ? { landingSurfaceFlashCues: calibration.landingSurfaceFlashCues }
        : {}),
      ...(calibration?.encouragementGlyphCues?.length
        ? { encouragementGlyphCues: calibration.encouragementGlyphCues, encouragementGlyphBindings }
        : {}),
      ...(calibration?.clear?.fragmentDisplayFps !== undefined &&
      calibration.clear.motionModel === 'ballistic' &&
      (calibration.clear.fragmentAgeOffsetSeconds ?? 0) !== 0
        ? { sampledFragmentAgeOffsetSeconds: calibration.clear.fragmentAgeOffsetSeconds }
        : {}),
      ...(fragmentPhysics
        ? {
            fragmentPhysics,
            fragmentCueFrames: clearVisualCues.map((cue) => [cue.startFrame, cue.endFrame]),
          }
        : {}),
      ...(observedV2Cues.length
        ? {
            observedFragmentMotionV2: observedV2Cues,
            observedFragmentCueFrames: clearVisualCues
              .filter((cue) => cue.observedFragmentMotionV2)
              .map((cue) => [cue.startFrame, cue.endFrame]),
          }
        : {}),
    });
    return {
      gameId: BLOCK_CRUSH_DROP_GAME_ID,
      takeId: input.replay.takeId,
      fps: input.fps,
      totalFrames,
      frameSourceHash,
      evaluate(frameIndex) {
        const clamped = Math.min(Math.max(Math.trunc(frameIndex), 0), totalFrames - 1);
        const active = timeline.find(
          (item) => clamped >= item.startFrame && clamped < item.endFrame,
        );
        let previous: TimelineStep | undefined;
        for (const item of timeline) {
          if (item.endFrame <= clamped) previous = item;
          else break;
        }
        const heldState = previous?.resolution.after ?? initial;
        const before = active?.resolution.before ?? heldState;
        const after = active?.resolution.after ?? heldState;
        const phase = active?.step.phase ?? 'idle';
        const progress = active
          ? // Preserve the canonical 30fps sample convention at higher rates.
            // Advancing one output frame made a 1-frame drop jump differently
            // at matching 30/60fps timestamps and changed settlement bounce.
            Math.min(
              1,
              (clamped - active.startFrame + input.fps / 30) /
                (active.endFrame - active.startFrame),
            )
          : 1;
        const gravityProgress = (item: TimelineStep) => {
          const lead = item.gravityLeadFrames ?? 0;
          const u = Math.max(
            0,
            Math.min(
              1,
              (clamped - item.startFrame + lead + 1) /
                (item.endFrame - item.startFrame + lead + (item.stepTailFrames ?? 0)),
            ),
          );
          return item.reconfigureProgressCurve
            ? sampleProgressCurve(item.reconfigureProgressCurve, u)
            : u * u;
        };
        const earlyGravity = timeline.filter(
          (item) =>
            item.gravityLeadFrames &&
            clamped >= item.startFrame - item.gravityLeadFrames &&
            clamped < item.startFrame,
        );
        const lateMovementOffsets = timeline
          .filter(
            (item) =>
              item.stepTailFrames &&
              clamped >= item.endFrame &&
              clamped < item.endFrame + item.stepTailFrames,
          )
          .flatMap((item) =>
            item.step.deltas.flatMap((delta) =>
              delta.kind === 'move'
                ? [
                    {
                      id: delta.entityId,
                      x: (delta.from.x - delta.to.x) * (1 - gravityProgress(item)),
                      y: (delta.from.y - delta.to.y) * (1 - gravityProgress(item)),
                    },
                  ]
                : [],
            ),
          );
        const canonicalTick = (clamped * 30) / input.fps;
        const legacyCellBasisState = active
          ? active.step.phase === 'commit'
            ? active.resolution.before
            : active.resolution.after
          : heldState;
        const fieldBasis = active
          ? active.step.phase === 'commit'
            ? active.fieldBasisBefore
            : active.fieldBasisAfter
          : previous?.fieldBasisAfter;
        const cellBasisState = fieldBasis
          ? { ...legacyCellBasisState, ...fieldBasis }
          : legacyCellBasisState;
        const ticksPerCell = before.config.rules.fieldMotion.ticksPerCell;
        const accumulatedRiseTicks = Math.max(
          0,
          cellBasisState.riseOffsetTicks +
            blockCrushFieldClock(cellBasisState.config, canonicalTick) -
            blockCrushFieldClock(cellBasisState.config, cellBasisState.tick),
        );
        const fieldPreviewRows = Math.floor(accumulatedRiseTicks / ticksPerCell);
        const fieldRiseOffsetCells = (accumulatedRiseTicks % ticksPerCell) / ticksPerCell;
        const activeClearCues = clearVisualCues.filter(
          (cue) => clamped >= cue.startFrame && clamped < cue.endFrame,
        );
        const clearCue = activeClearCues.at(-1);
        // A source-authored counter can outlive the semantic step that caused
        // it and overlap the next pickup. Own it by source-frame range rather
        // than by the current action's before/after score endpoints.
        const scoreCuesNewestFirst = [...scoreVisualCues].reverse();
        const scoreCue =
          scoreCuesNewestFirst.find(
            (cue) =>
              clamped >= cue.ownershipStartFrame && clamped < cue.startFrame + cue.values.length,
          ) ??
          scoreCuesNewestFirst.find(
            (cue) => before.score === cue.beforeScore && after.score === cue.afterScore,
          );
        const cuePayload = (
          clearCue: ClearVisualCue,
        ): NonNullable<BlockCrushDropPresentationFrame['lingeringClear']> => {
          const origin = clearCue.originFrame ?? clearCue.startFrame;
          const preRoll = clearCue.originFrame !== undefined && clamped < origin;
          // A future clear's integer row basis is not the current field basis.
          // Reading its riseOriginTick during pre-roll can floor a tiny negative
          // difference to -1 and visibly jump every held parent by a whole row.
          // Use the current native snapshot instead; future, unspawned mothers
          // are retained for binding/UV metadata but are explicitly not painted.
          const nativeSnapshot = active
            ? active.step.phase === 'settle' || active.step.phase === 'outcome'
              ? active.stepAfterCells
              : active.stepBeforeCells
            : heldState.cells;
          const currentById = preRoll
            ? new Map(nativeSnapshot.map((cell) => [cell.id, cell]))
            : undefined;
          // Physical/layered renderers freeze their native release origins by
          // applying this field delta in screen space. A pre-roll held mother
          // instead follows the current snapshot, so cancel that extra delta
          // in logical y (screen y has the opposite sign).
          const heldOriginCorrection =
            preRoll &&
            (calibration?.clear?.fragmentPhysics ||
              calibration?.clear?.motionModel === 'layered-curve')
              ? (blockCrushFieldClock(before.config, canonicalTick) -
                  blockCrushFieldClock(before.config, (origin * 30) / input.fps)) /
                ticksPerCell
              : 0;
          const omitted = currentById
            ? clearCue.eliminatedCells
                .filter((cell) => !currentById.has(cell.id))
                .map((cell) => cell.id)
                .sort()
            : [];
          const measuredMotion =
            omitted.length && clearCue.observedFragmentMotionV2
              ? {
                  ...clearCue.observedFragmentMotionV2,
                  particles: clearCue.observedFragmentMotionV2.particles.filter((particle) =>
                    currentById!.has(particle.cellId),
                  ),
                }
              : clearCue.observedFragmentMotionV2;
          const eliminatedCells = clearCue.eliminatedCells.map((cell) => {
            const current = currentById?.get(cell.id);
            if (current) {
              let x = current.x,
                y = current.y;
              if (active?.step.phase === 'reconfigure') {
                const delta = active.step.deltas.find(
                  (delta) => delta.kind === 'move' && delta.entityId === cell.id,
                );
                if (delta?.kind === 'move') {
                  const u = Math.max(0, Math.min(1, (progress - 0.72) / 0.28));
                  const snap =
                    active.gravityLeadFrames || active.stepTailFrames
                      ? gravityProgress(active)
                      : active.reconfigureProgressCurve
                        ? sampleProgressCurve(active.reconfigureProgressCurve, progress)
                        : before.config.rules.settlement
                          ? active.step.tags.includes('active-cell-gravity')
                            ? progress * progress
                            : progress * progress * (3 - 2 * progress)
                          : u * u * (3 - 2 * u);
                  x = delta.from.x + (delta.to.x - delta.from.x) * snap;
                  y = delta.from.y + (delta.to.y - delta.from.y) * snap;
                }
              } else if (active?.step.phase === 'settle') {
                y += Math.sin(progress * Math.PI) * (active.settleBounceCells ?? 0.08);
              }
              for (const offset of earlyGravity.filter((offset) =>
                offset.step.deltas.some(
                  (delta) => delta.kind === 'move' && delta.entityId === cell.id,
                ),
              )) {
                const delta = offset.step.deltas.find(
                  (delta) => delta.kind === 'move' && delta.entityId === cell.id,
                )!;
                if (delta.kind === 'move') {
                  x += (delta.to.x - delta.from.x) * gravityProgress(offset);
                  y += (delta.to.y - delta.from.y) * gravityProgress(offset);
                }
              }
              return { ...cell, x, y: y + fieldPreviewRows + heldOriginCorrection };
            }
            return clearCue.riseOriginTick === undefined || preRoll
              ? cell
              : {
                  ...cell,
                  y:
                    cell.y +
                    Math.floor(
                      (blockCrushFieldClock(before.config, canonicalTick) -
                        clearCue.riseOriginTick) /
                        ticksPerCell,
                    ),
                };
          });
          return {
            actionIndex: clearCue.actionIndex,
            cycleIndex: clearCue.cycleIndex,
            pieceKind: clearCue.pieceKind,
            progress: Math.max(0, (clamped - origin + 1) / (clearCue.endFrame - origin)),
            elapsedFrames: clamped - origin,
            durationFrames: clearCue.endFrame - origin,
            ...(clearCue.originFrame === undefined ? {} : { originFrame: clearCue.originFrame }),
            ...(omitted.length ? { preRollOmittedCellIds: omitted } : {}),
            motionProgress: (() => {
              const linear = Math.max(
                0,
                Math.min(1, (clamped - clearCue.motionStartFrame + 1) / clearCue.motionFrames),
              );
              const curve = clearCue.motionProgressCurve;
              if (!curve || curve.length < 2) return linear;
              const position = linear * (curve.length - 1);
              const left = Math.floor(position);
              const right = Math.min(curve.length - 1, left + 1);
              const fraction = position - left;
              return curve[left]! + (curve[right]! - curve[left]!) * fraction;
            })(),
            rowStaggerProgress: clearCue.rowStaggerProgress,
            eliminatedCells,
            ...(clearCue.chainDepth !== undefined
              ? { chainDepth: clearCue.chainDepth, clearOrdinal: clearCue.clearOrdinal }
              : {}),
            ...(timing.clearExposureSeconds
              ? { clearOrdinal: exposureOrdinals.get(clearCue)! }
              : {}),
            ...(clearCue.fragmentTiltScale !== undefined
              ? { fragmentTiltScale: clearCue.fragmentTiltScale }
              : {}),
            ...(clearCue.fragmentMotionBlur
              ? {
                  fragmentMotionBlurScale: (() => {
                    const lifetime =
                      (clamped - clearCue.startFrame + 1) /
                      (clearCue.endFrame - clearCue.startFrame);
                    const profile = clearCue.fragmentMotionBlur;
                    const smooth = (value: number) => {
                      const bounded = Math.max(0, Math.min(1, value));
                      return bounded * bounded * (3 - 2 * bounded);
                    };
                    const fadeIn = smooth(
                      (lifetime - profile.startLifetimeProgress) / profile.rampLifetimeProgress,
                    );
                    const fadeOut =
                      1 -
                      smooth(
                        (lifetime - profile.endLifetimeProgress) / profile.rampLifetimeProgress,
                      );
                    return profile.scale * fadeIn * fadeOut;
                  })(),
                }
              : {}),
            ...(clearCue.sequence ? { sequence: clearCue.sequence } : {}),
            ...(clearCue.fragmentAppearance
              ? { fragmentAppearance: clearCue.fragmentAppearance }
              : {}),
            ...(clearCue.observedFragmentMotion
              ? { observedFragmentMotion: clearCue.observedFragmentMotion }
              : {}),
            ...(measuredMotion ? { observedFragmentMotionV2: measuredMotion } : {}),
            ...(clearCue.fragmentFoldSpread
              ? { fragmentFoldSpread: clearCue.fragmentFoldSpread }
              : {}),
            ...(clearCue.residualMotion ? { residualMotion: clearCue.residualMotion } : {}),
          };
        };
        const sequenceCues = clearVisualCues.filter((c) => c.sequence);
        const payload: BlockCrushDropPresentationFrame = {
          ...(sequenceCues.length
            ? {
                sequenceCueSchedule: sequenceCues.map((c) => ({
                  startSeconds: c.startFrame / input.fps,
                  endSeconds: c.endFrame / input.fps,
                  sequence: c.sequence!,
                })),
              }
            : {}),
          ...(physicsCueSchedule.length || timing.clearExposureSeconds
            ? { physicsCueSchedule }
            : {}),
          ...(timing.clearExposureSeconds
            ? { clearExposureSeconds: timing.clearExposureSeconds }
            : {}),
          frameIndex: clamped,
          fps: input.fps,
          totalFrames,
          canonicalTick,
          fieldRiseOffsetCells,
          fieldPreviewRows,
          fieldIncomingRowIndex: cellBasisState.incomingRowIndex,
          phase,
          progress,
          ...(active ? { step: active.step } : {}),
          ...(active ? { action: active.resolution.action } : {}),
          ...(active?.interaction ? { interaction: active.interaction } : {}),
          ...(clearCue ? { lingeringClear: cuePayload(clearCue) } : {}),
          ...(landingSurfaceFlashes.length
            ? {
                landingSurfaceFlashes: landingSurfaceFlashes
                  .filter((cue) => clamped >= cue.originFrame && clamped < cue.endFrame)
                  .map((cue) => ({
                    cueIndex: cue.cueIndex,
                    elapsedFrames: clamped - cue.originFrame,
                    cellIds: cue.cellIds,
                  })),
              }
            : {}),
          ...(encouragementGlyphBindings.length
            ? {
                encouragementGlyphWaves: encouragementGlyphBindings
                  .filter((cue) => clamped >= cue.originFrame && clamped < cue.endFrame)
                  .map((cue) => ({
                    cueIndex: cue.cueIndex,
                    elapsedFrames: clamped - cue.originFrame,
                  })),
              }
            : {}),
          ...(calibration?.impactBeamCues?.length
            ? {
                impactBeamWaves: clearVisualCues
                  .filter(
                    (cue) =>
                      clamped >= cue.startFrame &&
                      clamped < cue.endFrame &&
                      calibration.impactBeamCues!.some(
                        (beam) =>
                          beam.actionIndex === cue.actionIndex &&
                          beam.cycleIndex === cue.cycleIndex,
                      ),
                  )
                  .map((cue) => ({
                    actionIndex: cue.actionIndex,
                    cycleIndex: cue.cycleIndex,
                    elapsedFrames: clamped - (cue.originFrame ?? cue.startFrame),
                  })),
              }
            : {}),
          ...(!calibration || calibration.clear?.overlap || observedV2Cues.length
            ? {
                lingeringClears: clearVisualCues
                  .filter(
                    (cue) =>
                      clamped >= cue.startFrame &&
                      clamped < cue.endFrame &&
                      (!calibration ||
                        calibration.clear?.overlap ||
                        cue.observedFragmentMotionV2 ||
                        cue === clearCue),
                  )
                  .map(cuePayload),
              }
            : {}),
          ...(scoreCue
            ? {
                displayScore:
                  clamped < scoreCue.startFrame
                    ? scoreCue.beforeScore
                    : scoreCue.values[
                        Math.min(scoreCue.values.length - 1, clamped - scoreCue.startFrame)
                      ],
              }
            : {}),
          ...(before.config.rules.settlement && !scoreCue
            ? {
                displayScore:
                  before.config.rules.settlement === 'cut-component-cascade' && phase === 'commit'
                    ? before.score
                    : active
                      ? Math.round(
                          (active.scoreBefore ?? before.score) +
                            ((active.scoreAfter ?? before.score) -
                              (active.scoreBefore ?? before.score)) *
                              progress,
                        )
                      : heldState.score,
              }
            : {}),
          ...(timing.countdownStartSeconds !== undefined
            ? {
                displayCountdownSeconds: Math.max(
                  0,
                  timing.countdownStartSeconds -
                    timing.countdownTickFrames.filter((tickFrame) => tickFrame <= clamped).length,
                ),
              }
            : {}),
          ...(active?.step.phase === 'reconfigure' && active.reconfigureProgressCurve
            ? {
                reconfigureProgress: sampleProgressCurve(active.reconfigureProgressCurve, progress),
              }
            : {}),
          ...(active?.gravityLeadFrames || active?.stepTailFrames
            ? { reconfigureProgress: gravityProgress(active) }
            : {}),
          ...(lateMovementOffsets.length ? { lateMovementOffsets } : {}),
          ...(earlyGravity.length
            ? {
                earlyGravityOffsets: earlyGravity.flatMap((item) =>
                  item.step.deltas.flatMap((delta) =>
                    delta.kind === 'move'
                      ? [
                          {
                            id: delta.entityId,
                            x: (delta.to.x - delta.from.x) * gravityProgress(item),
                            y: (delta.to.y - delta.from.y) * gravityProgress(item),
                          },
                        ]
                      : [],
                  ),
                ),
              }
            : {}),
          ...(active?.step.phase === 'settle' && active.settleBounceCells !== undefined
            ? {
                settleBounceCells: active.settleBounceCells,
              }
            : {}),
          ...(active
            ? {
                stepBeforeCells: active.stepBeforeCells,
                stepAfterCells: active.stepAfterCells,
                eliminatedCells: active.eliminatedCells,
              }
            : {}),
          before,
          after,
        };
        const semanticEvents = active ? [eventForStep(active.step)] : [];
        if (active?.step.phase === 'resolve') {
          const removed = active.step.deltas.filter((delta) => delta.kind === 'remove').length;
          if (removed > 0)
            semanticEvents.push({
              ...eventForStep(active.step),
              id: `${active.step.id}:clear-sound`,
              type:
                removed > before.config.columns
                  ? 'block-crush-drop.multi-line-cleared'
                  : 'block-crush-drop.single-line-cleared',
            });
        }
        // Commit spans the whole airborne approach. Audio for contact belongs
        // to its end, not the first frame of that approach.
        const landing = timeline.find(
          (item) => item.step.phase === 'commit' && item.endFrame === clamped,
        );
        if (landing)
          semanticEvents.push({
            ...eventForStep(landing.step),
            id: `${landing.step.id}:landed`,
            type: 'block-crush-drop.piece-landed',
            tags: [...landing.step.tags, 'audible-contact'],
          });
        const feedback = feedbackForPhase(phase);
        const isFinalFrame = clamped === totalFrames - 1;
        const stateHash = blockCrushDropRuntime.hashState(isFinalFrame ? finalState : before);
        return {
          contract: PRESENTATION_PACKET_CONTRACT,
          contractVersion: PRESENTATION_PACKET_CONTRACT_VERSION,
          identity: {
            gameId: BLOCK_CRUSH_DROP_GAME_ID,
            moduleVersion: BLOCK_CRUSH_DROP_MODULE_VERSION,
            takeId: input.replay.takeId,
            frameIndex: clamped,
            fps: input.fps,
            totalFrames,
            stateHash,
            presentationHash: stableHash(
              presentationHashIdentity({
                frameIndex: clamped,
                fps: input.fps,
                totalFrames,
                payload,
                semanticEvents,
                cameraPunch: feedback.cameraPunch,
              }),
            ),
          },
          semanticEvents,
          feedback,
          payloadSchemaId: BLOCK_CRUSH_DROP_PRESENTATION_SCHEMA_ID,
          payload,
        };
      },
    } satisfies CompiledFrameSource;
  },
};
