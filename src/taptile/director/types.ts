import type {
  CompiledTapTileLevel,
  TapTileDirectorProfile,
  TapTileDirectorTiming,
  TapTileTake,
} from '../project';
import type { TapTileGameState, TapTileSemanticEvent, TapTileTransition } from '../gameplay';

export type DirectorEffectImplementation = 'web-procedural' | 'sprite-sequence' | 'static-overlay' | 'baked-clip';

export interface EffectBinding {
  id: string;
  implementation: DirectorEffectImplementation;
  presetId: string;
  intensity: number;
}

export interface PraiseBinding {
  enabled: boolean;
  labels: string[];
}

export interface CameraBinding {
  enabled: boolean;
  intensity: number;
}

export interface MatchPresentationBundle {
  preFlash?: EffectBinding;
  tilePulse?: EffectBinding;
  crack?: EffectBinding;
  shatter?: EffectBinding;
  particles?: EffectBinding;
  praise?: PraiseBinding;
  camera?: CameraBinding;
  audioCueId?: string;
}

export interface PointerMotionProfile {
  style: TapTileDirectorProfile['pointerStyle'];
  easing: 'smooth' | 'linear' | 'urgent';
  leadDistancePx: number;
}

export interface ClickFeedbackProfile {
  scale: number;
  ring: boolean;
}

export interface TileFlightProfile {
  style: TapTileDirectorProfile['tileFlightStyle'];
  easing: 'smooth' | 'linear' | 'snap';
  arcHeightPx: number;
}

export interface TrayMotionProfile {
  style: TapTileDirectorProfile['trayMotionStyle'];
  easing: 'smooth' | 'tight' | 'elastic';
}

export interface CameraProfile {
  style: TapTileDirectorProfile['cameraStyle'];
  shakePx: number;
  zoomImpact: number;
}

export interface RuntimeTapTileDirectorProfile {
  id: string;
  name: string;
  globalSpeed: number;
  betweenActionFrames: number;
  pointer: PointerMotionProfile;
  clickFeedback: ClickFeedbackProfile;
  tileFlight: TileFlightProfile;
  trayMotion: TrayMotionProfile;
  matchPresentation: MatchPresentationBundle;
  camera: CameraProfile;
  timing: TapTileDirectorTiming;
}

export interface CompiledActionTiming {
  actionStartFrame: number;
  pointerArriveFrame: number;
  pressFrame: number;
  flightStartFrame: number;
  flightEndFrame: number;
  trayReorderStartFrame: number;
  trayReorderEndFrame: number;
  matchStartFrame: number;
  matchLogicVisibleFrame: number;
  matchVfxEndFrame: number;
  inputReadyFrame: number;
  actionVisualEndFrame: number;
}

export interface CompiledDirectorAction {
  index: number;
  actionId: string;
  tileId: string;
  transition: TapTileTransition;
  timing: CompiledActionTiming;
  effectiveTiming: TapTileDirectorTiming;
}

export interface CompiledDirectorEvent {
  id: string;
  actionIndex: number;
  frame: number;
  endFrame: number;
  event: TapTileSemanticEvent;
}

export interface CompiledTapTileTake {
  id: string;
  levelHash: string;
  takeId: string;
  finalStateHash: string;
  profileId: string;
  seed: number;
  fps: number;
  totalFrames: number;
  sourceTake: TapTileTake;
  level: CompiledTapTileLevel;
  profile: RuntimeTapTileDirectorProfile;
  actions: CompiledDirectorAction[];
  events: CompiledDirectorEvent[];
  initialState: TapTileGameState;
}

export interface PresentationPointer {
  visible: boolean;
  xPx: number;
  yPx: number;
  pressed: boolean;
  opacity: number;
  scale: number;
  rotationDeg: number;
  actionIndex?: number;
}

export interface PresentationMovingTile {
  tileId: string;
  xPx: number;
  yPx: number;
  rotationDeg: number;
  scale: number;
  progress: number;
  actionIndex: number;
}

export interface PresentationEffect {
  id: string;
  kind: 'match' | 'warning' | 'win' | 'loss' | 'click';
  progress: number;
  tileIds: string[];
  /** Deterministic director feedback rendered by both preview and export. */
  praiseLabel?: string;
  implementation: DirectorEffectImplementation;
  presetId: string;
  slotIndexes?: number[];
  particles: Array<{
    id: string;
    xPx: number;
    yPx: number;
    rotationDeg: number;
    scale: number;
    opacity: number;
    shape?: 'ceramic-shard' | 'spark';
    tone?: number;
  }>;
}

export interface TapTilePresentationFrame {
  frameNumber: number;
  totalFrames: number;
  progress: number;
  gameState: TapTileGameState;
  pointer: PresentationPointer;
  movingTiles: PresentationMovingTile[];
  effects: PresentationEffect[];
  camera: { xPx: number; yPx: number; zoom: number };
  activeActionIndexes: number[];
  activeEventIds: string[];
}

export interface CompileTapTileDirectorOptions {
  seed?: number;
  fps?: number;
  actionOverrides?: Record<string, Partial<TapTileDirectorTiming>>;
}
