import type { GameSnapshot, GameTransition, PieceInstance } from '../nativeReference/domain/types';
import type {
  ReferenceCalibration,
  ReferencePreviewDrag,
} from '../nativeReference/games/block-placement/presentation/referenceCalibration';
import type { SemanticGameEvent } from '../nativeReference/game-runtime/presentationPacket';
import type { PresentationPacket } from '../nativeReference/game-runtime/presentationPacket';
import { readBBFrame } from '../games/block-placement/planning/timelineFrameSource';
import { calibratedPacketFrame } from '../games/block-placement/presentation/calibratedPacket';
import type { BBScorePopup } from '../games/block-placement/planning/scorePopupTimeline';
import type { BBRackDrawable } from '../games/block-placement/planning/rackTimeline';
import type {
  BBRenderAction,
  BBRenderStep,
  BBRenderTiming,
} from '../games/block-placement/planning/renderAction';
import type { BBGeometry } from '../games/block-placement/planning/geometry';

/** Display colors also include explicitly authored atlas-face identifiers. */
export type CalibratedDisplayPiece = Omit<PieceInstance, 'color' | 'cellColors'> & {
  color: string;
  cellColors?: string[];
};
export type CalibratedDisplayState = Omit<GameSnapshot, 'board' | 'pieces' | 'fixedPieceSupply'> & {
  board: { rows: number; cols: number; cells: Array<Array<string | null>> };
  pieces: CalibratedDisplayPiece[];
  fixedPieceSupply?: CalibratedDisplayPiece[][];
};
/** A validated replay transition with presentation-only cell colors. */
export type CalibratedReplayStep = Omit<GameTransition, 'before' | 'after'> & {
  before: CalibratedDisplayState;
  after: CalibratedDisplayState;
  piece: CalibratedDisplayPiece;
  placedCells: Array<{ row: number; col: number }>;
  placedColors?: Record<string, string>;
};
export type CalibratedPointer = {
  actionId: string;
  x: number;
  y: number;
  radius: number;
  kind: 'ring';
};
export type CalibratedActionTiming = ReferenceCalibration['actions'][number];
export type CalibratedClearEffect = {
  index: number;
  actionId: string;
  age: number;
  clearAge: number;
  combo: number;
  rows: number[];
  cols: number[];
  cells: Array<{ row: number; col: number }>;
  feedback: {
    age: number;
    combo: number;
    like: string | undefined;
    rim: boolean;
    celebrate: boolean;
  } | null;
  step: BBRenderStep;
  timing: BBRenderTiming;
  praiseLabel: string;
};
export type CalibratedFrame = {
  frameIndex: number;
  fps: number;
  totalFrames: number;
  time: number;
  geometry: BBGeometry;
  active: number;
  actionId: string | null;
  activeAction: BBRenderAction | null;
  phase: 'initial' | 'drag' | 'placed' | 'post-placement' | 'post-clear';
  /** Display state may use authored appearance colors rather than game colors. */
  state: CalibratedDisplayState;
  /** Rule state is committed at release; the visual board can still show the placed cells. */
  gameState: GameSnapshot;
  board: Array<Array<string | null>>;
  drag: { x: number; y: number; size: number } | null;
  dragPreview: {
    anchor: { row: number; col: number } | null;
    lines: { rows: number[]; cols: number[] } | null;
    progress: number;
  } | null;
  rackState: CalibratedDisplayState;
  rackDrawables: BBRackDrawable[];
  previewDrag: ReferencePreviewDrag | null;
  previewPose: { x: number; y: number; size: number } | null;
  previewAnchor: { row: number; col: number } | null;
  pointer: CalibratedPointer | null;
  hud: { score: number; pulse: number };
  camera: { x: number; y: number; scale: number };
  clearEffects: CalibratedClearEffect[];
  /** Score and screen feedback are sampled with the same clock as the board. */
  scorePopups: BBScorePopup[];
  atmosphereAge: number | null;
  semanticEvents: SemanticGameEvent[];
};

/** Compatibility view for verification tooling. Production scenes consume the common BB frame. */
export function readCalibratedFrame(packet: PresentationPacket): CalibratedFrame {
  return calibratedPacketFrame(
    readBBFrame(packet),
    packet.identity.fps,
    packet.identity.totalFrames,
  );
}
