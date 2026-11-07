import type { TapTileGameState } from '../gameplay';
import { TAPTILE_EXPORT_STAGE } from '../pixelGeometry';
import { tapTileTraySlotCenter } from '../trayLayout';
import { easeProgress, frameProgress, lerp } from './easing';
import { seededSigned, seededUnit } from './seededNoise';
import type {
  CompiledDirectorAction,
  CompiledTapTileTake,
  PresentationEffect,
  PresentationMovingTile,
  TapTilePresentationFrame,
} from './types';

function cloneState(state: TapTileGameState): TapTileGameState {
  return {
    status: state.status,
    turn: state.turn,
    boardIds: [...state.boardIds],
    trayIds: [...state.trayIds],
    clearedIds: [...state.clearedIds],
    activeBlockerCount: { ...state.activeBlockerCount },
  };
}

function trayPoint(index: number): { xPx: number; yPx: number } {
  return tapTileTraySlotCenter(index);
}

function recordedPointerPoint(
  compiled: CompiledTapTileTake,
  action: CompiledDirectorAction,
  progress: number,
): { xPx: number; yPx: number } | null {
  const path = compiled.sourceTake.actions[action.index]?.pointerPath;
  if (!path || path.length === 0) return null;
  if (path.length === 1) {
    return {
      xPx: path[0]!.x * TAPTILE_EXPORT_STAGE.width,
      yPx: path[0]!.y * TAPTILE_EXPORT_STAGE.height,
    };
  }
  const ordered = [...path].sort((left, right) => left.frameOffset - right.frameOffset);
  const lastOffset = Math.max(1, ordered.at(-1)?.frameOffset ?? 1);
  const offset = progress * lastOffset;
  const rightIndex = ordered.findIndex((point) => point.frameOffset >= offset);
  const right = ordered[rightIndex < 0 ? ordered.length - 1 : rightIndex]!;
  const left = ordered[Math.max(0, (rightIndex < 0 ? ordered.length : rightIndex) - 1)]!;
  const span = Math.max(1, right.frameOffset - left.frameOffset);
  const localProgress = Math.max(0, Math.min(1, (offset - left.frameOffset) / span));
  return {
    xPx: lerp(left.x, right.x, localProgress) * TAPTILE_EXPORT_STAGE.width,
    yPx: lerp(left.y, right.y, localProgress) * TAPTILE_EXPORT_STAGE.height,
  };
}

function movingTile(compiled: CompiledTapTileTake, action: CompiledDirectorAction, frame: number): PresentationMovingTile | null {
  const { timing } = action;
  if (frame < timing.flightStartFrame || frame > timing.flightEndFrame) return null;
  const tile = compiled.level.tiles[action.tileId];
  if (!tile) return null;
  const raw = frameProgress(frame, timing.flightStartFrame, timing.flightEndFrame);
  const progress = easeProgress(raw, compiled.profile.tileFlight.easing);
  const target = trayPoint(action.transition.insertedIndex ?? action.transition.trayAfterInsert.indexOf(action.tileId));
  const arc = Math.sin(Math.PI * progress) * compiled.profile.tileFlight.arcHeightPx;
  return {
    tileId: action.tileId,
    xPx: lerp(tile.geometry.centerXPx, target.xPx, progress),
    yPx: lerp(tile.geometry.centerYPx, target.yPx, progress) - arc,
    rotationDeg: tile.geometry.rotationDeg * (1 - progress) + seededSigned(compiled.seed, action.index, 1) * 5 * Math.sin(Math.PI * progress),
    scale: lerp(1, 0.82, progress),
    progress,
    actionIndex: action.index,
  };
}

function presentationState(compiled: CompiledTapTileTake, frame: number): TapTileGameState {
  let state = cloneState(compiled.initialState);
  for (const action of compiled.actions) {
    if (frame >= action.timing.matchLogicVisibleFrame) {
      state = cloneState(action.transition.after);
      continue;
    }
    if (frame < action.timing.actionStartFrame) break;
    state = cloneState(action.transition.before);
    if (frame >= action.timing.flightStartFrame) {
      state.boardIds = state.boardIds.filter((id) => id !== action.tileId);
    }
    if (frame >= action.timing.flightEndFrame) {
      state.trayIds = [...action.transition.trayAfterInsert];
      state.turn = action.transition.after.turn;
    }
    break;
  }
  return state;
}

function matchEffect(compiled: CompiledTapTileTake, action: CompiledDirectorAction, frame: number): PresentationEffect | null {
  if (action.transition.matchedTileIds.length === 0) return null;
  const { matchStartFrame, matchVfxEndFrame } = action.timing;
  if (frame < matchStartFrame || frame > matchVfxEndFrame) return null;
  const progress = frameProgress(frame, matchStartFrame, matchVfxEndFrame);
  const slotIndexes = action.transition.matchedTileIds
    .map((tileId) => action.transition.trayAfterInsert.indexOf(tileId))
    .filter((index) => index >= 0);
  const slotCenters = slotIndexes.map((index) => trayPoint(index));
  const burstProgress = Math.max(0, Math.min(1, (progress - 0.16) / 0.84));
  const particles = slotCenters.flatMap((center, tileIndex) => Array.from({ length: 10 }, (_, shardIndex) => {
    const noiseIndex = tileIndex * 20 + shardIndex;
    const angle = seededUnit(compiled.seed + action.index * 101, tileIndex, shardIndex) * Math.PI * 2;
    const travel = 34 + seededUnit(compiled.seed, action.index, noiseIndex + 31) * 118;
    const radius = travel * burstProgress;
    const gravity = burstProgress ** 2 * (28 + seededUnit(compiled.seed, action.index, noiseIndex + 71) * 62);
    const fadeIn = Math.min(1, burstProgress * 10);
    return {
      id: `${action.actionId}:particle:${tileIndex}:${shardIndex}`,
      xPx: center.xPx + Math.cos(angle) * radius,
      yPx: center.yPx + Math.sin(angle) * radius + gravity,
      rotationDeg: seededSigned(compiled.seed, action.index, noiseIndex + 80) * 260 * burstProgress,
      scale: 0.45 + seededUnit(compiled.seed, action.index, noiseIndex + 120) * 0.9,
      opacity: fadeIn * Math.max(0, 1 - burstProgress),
      shape: shardIndex % 5 === 0 ? 'spark' as const : 'ceramic-shard' as const,
      tone: noiseIndex % 3,
    };
  }));
  const binding = compiled.profile.matchPresentation.particles ?? compiled.profile.matchPresentation.shatter;
  const praise = compiled.profile.matchPresentation.praise;
  const matchOrdinal = compiled.actions
    .slice(0, action.index)
    .filter((candidate) => candidate.transition.matchedTileIds.length > 0)
    .length;
  // A three-tile clear is already a positive beat in the reference. Start at
  // “Great”, then escalate deterministically without making frame evaluation
  // depend on mutable combo state or wall-clock time.
  const praiseLabel = praise?.enabled && praise.labels.length > 0
    ? praise.labels[Math.min(praise.labels.length - 1, matchOrdinal + 1)]
    : undefined;
  return {
    id: `${action.actionId}:match`,
    kind: 'match',
    progress,
    tileIds: [...action.transition.matchedTileIds],
    implementation: binding?.implementation ?? 'web-procedural',
    presetId: binding?.presetId ?? 'default-match',
    ...(praiseLabel ? { praiseLabel } : {}),
    slotIndexes,
    particles,
  };
}

function semanticEffects(compiled: CompiledTapTileTake, frame: number): PresentationEffect[] {
  return compiled.events.flatMap<PresentationEffect>((entry): PresentationEffect[] => {
    if (frame < entry.frame || frame > entry.endFrame || entry.event.type === 'match.resolved') return [];
    const progress = frameProgress(frame, entry.frame, entry.endFrame);
    if (entry.event.type === 'tap.accepted' || entry.event.type === 'tap.rejected') {
      return [{
        id: entry.id,
        kind: 'click' as const,
        progress,
        tileIds: [entry.event.tileId],
        implementation: 'web-procedural' as const,
        presetId: entry.event.type === 'tap.accepted' ? 'click-ring' : 'rejected-ring',
        particles: [],
      }];
    }
    if (entry.event.type === 'tray.warning') {
      return [{ id: entry.id, kind: 'warning' as const, progress, tileIds: [], implementation: 'static-overlay' as const, presetId: 'tray-warning', particles: [] }];
    }
    if (entry.event.type === 'game.won') {
      return [{ id: entry.id, kind: 'win' as const, progress, tileIds: [], implementation: 'static-overlay' as const, presetId: 'game-win', particles: [] }];
    }
    if (entry.event.type === 'game.lost') {
      return [{ id: entry.id, kind: 'loss' as const, progress, tileIds: [], implementation: 'static-overlay' as const, presetId: 'game-loss', particles: [] }];
    }
    return [];
  });
}

export function evaluateTapTileFrame(compiled: CompiledTapTileTake, requestedFrame: number): TapTilePresentationFrame {
  const frameNumber = Math.max(0, Math.min(compiled.totalFrames - 1, Math.floor(requestedFrame)));
  const gameState = presentationState(compiled, frameNumber);
  const movingTiles = compiled.actions
    .map((action) => movingTile(compiled, action, frameNumber))
    .filter((tile): tile is PresentationMovingTile => tile !== null);
  const effects = [...compiled.actions
    .map((action) => matchEffect(compiled, action, frameNumber))
    .filter((effect): effect is PresentationEffect => effect !== null), ...semanticEffects(compiled, frameNumber)];
  const pointerAction = [...compiled.actions].reverse().find((action) => frameNumber >= action.timing.actionStartFrame && frameNumber <= action.timing.flightStartFrame + action.effectiveTiming.pressFrames);
  const pointerTile = pointerAction ? compiled.level.tiles[pointerAction.tileId] : undefined;
  let pointer = {
    visible: false,
    xPx: 540,
    yPx: 960,
    pressed: false,
    opacity: 0,
    scale: 1,
    rotationDeg: -18,
  } as TapTilePresentationFrame['pointer'];
  if (pointerAction && pointerTile) {
    const targetX = pointerTile.geometry.centerXPx;
    const targetY = pointerTile.geometry.centerYPx;
    const rawTravel = frameProgress(frameNumber, pointerAction.timing.actionStartFrame, pointerAction.timing.pointerArriveFrame);
    const travel = easeProgress(
      rawTravel,
      compiled.profile.pointer.easing,
    );
    const recorded = recordedPointerPoint(compiled, pointerAction, travel);
    const lead = compiled.profile.pointer.leadDistancePx;
    const startX = targetX + lead * 0.58;
    const startY = targetY + lead * 1.05;
    const syntheticX = lerp(startX, targetX, travel) - Math.sin(Math.PI * travel) * lead * 0.14;
    const syntheticY = lerp(startY, targetY, travel);
    const pressProgress = frameProgress(frameNumber, pointerAction.timing.pointerArriveFrame, pointerAction.timing.pressFrame);
    const releaseProgress = frameProgress(
      frameNumber,
      pointerAction.timing.pressFrame,
      pointerAction.timing.pressFrame + pointerAction.effectiveTiming.pressFrames,
    );
    const pressPulse = Math.sin(Math.min(1, pressProgress) * Math.PI);
    const releaseOffset = releaseProgress * 14;
    pointer = {
      visible: true,
      xPx: (recorded?.xPx ?? syntheticX) + releaseOffset * 0.55,
      yPx: (recorded?.yPx ?? syntheticY) + releaseOffset,
      pressed: frameNumber >= pointerAction.timing.pointerArriveFrame && frameNumber <= pointerAction.timing.pressFrame,
      opacity: Math.min(1, rawTravel * 4) * (1 - releaseProgress),
      scale: 1 - pressPulse * 0.08 + releaseProgress * 0.03,
      rotationDeg: compiled.profile.pointer.style === 'urgent' ? -14 : compiled.profile.pointer.style === 'direct' ? -20 : -18,
      actionIndex: pointerAction.index,
    };
  }
  const activeActionIndexes = compiled.actions
    .filter((action) => frameNumber >= action.timing.actionStartFrame && frameNumber <= action.timing.actionVisualEndFrame)
    .map((action) => action.index);
  const activeEventIds = compiled.events
    .filter((event) => frameNumber >= event.frame && frameNumber <= event.endFrame)
    .map((event) => event.id);
  const cameraEnabled = compiled.profile.matchPresentation.camera?.enabled ?? compiled.profile.camera.style !== 'steady';
  const impact = cameraEnabled
    ? effects
      .filter((effect) => effect.kind === 'match')
      .reduce((maximum, effect) => {
        const attack = Math.min(1, effect.progress / 0.12);
        const release = Math.max(0, 1 - effect.progress);
        return Math.max(maximum, attack * release);
      }, 0)
    : 0;
  const cameraIntensity = compiled.profile.camera.shakePx * impact;
  const cameraPhase = frameNumber + compiled.seed * 0.013;
  return {
    frameNumber,
    totalFrames: compiled.totalFrames,
    progress: compiled.totalFrames <= 1 ? 1 : frameNumber / (compiled.totalFrames - 1),
    gameState,
    pointer,
    movingTiles,
    effects,
    camera: {
      xPx: cameraIntensity === 0 ? 0 : Math.sin(cameraPhase * 0.86) * cameraIntensity,
      yPx: cameraIntensity === 0 ? 0 : Math.sin(cameraPhase * 1.17 + 1.4) * cameraIntensity * 0.58,
      zoom: 1 + compiled.profile.camera.zoomImpact * impact,
    },
    activeActionIndexes,
    activeEventIds,
  };
}
