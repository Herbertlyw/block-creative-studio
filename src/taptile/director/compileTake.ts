import { stableHash, type CompiledTapTileLevel, type TapTileDirectorProfile, type TapTileDirectorTiming, type TapTileTake } from '../project';
import { validateTapTileTake } from '../gameplay';
import { resolveRuntimeDirectorProfile } from './profile';
import type {
  CompileTapTileDirectorOptions,
  CompiledActionTiming,
  CompiledDirectorAction,
  CompiledDirectorEvent,
  CompiledTapTileTake,
} from './types';

function scaledFrames(value: number, speed: number, minimum = 0): number {
  return Math.max(minimum, Math.round(value / Math.max(0.05, speed)));
}

function effectiveTiming(
  base: TapTileDirectorTiming,
  override: Partial<TapTileDirectorTiming> | undefined,
  speed: number,
): TapTileDirectorTiming {
  const merged = { ...base, ...override };
  return {
    pointerTravelFrames: scaledFrames(merged.pointerTravelFrames, speed, 1),
    pressFrames: scaledFrames(merged.pressFrames, speed, 1),
    flightFrames: scaledFrames(merged.flightFrames, speed, 1),
    trayReorderFrames: scaledFrames(merged.trayReorderFrames, speed, 1),
    matchDelayFrames: scaledFrames(merged.matchDelayFrames, speed),
    matchVfxFrames: scaledFrames(merged.matchVfxFrames, speed, 1),
    inputOverlapFrames: scaledFrames(merged.inputOverlapFrames, speed),
  };
}

function eventFrame(eventType: string, timing: CompiledActionTiming): { frame: number; endFrame: number } {
  if (eventType === 'tap.accepted' || eventType === 'tap.rejected') return { frame: timing.pressFrame, endFrame: timing.pressFrame + 1 };
  if (eventType === 'tile.fly-to-tray') return { frame: timing.flightStartFrame, endFrame: timing.flightEndFrame };
  if (eventType === 'tray.reordered') return { frame: timing.trayReorderStartFrame, endFrame: timing.trayReorderEndFrame };
  if (eventType === 'match.resolved') return { frame: timing.matchStartFrame, endFrame: timing.matchVfxEndFrame };
  if (eventType === 'tiles.unlocked') return { frame: timing.matchLogicVisibleFrame, endFrame: timing.matchLogicVisibleFrame + 1 };
  return { frame: timing.matchLogicVisibleFrame, endFrame: timing.actionVisualEndFrame };
}

export function compileTapTileTake(
  level: CompiledTapTileLevel,
  take: TapTileTake,
  sourceProfile: TapTileDirectorProfile,
  options: CompileTapTileDirectorOptions = {},
): CompiledTapTileTake {
  const validation = validateTapTileTake(level, take);
  if (!validation.valid) throw new Error(`DIRECTOR_TAKE_INVALID: ${validation.issues[0]?.message ?? 'unknown'}`);
  const profile = resolveRuntimeDirectorProfile(sourceProfile);
  const seed = options.seed ?? 1;
  const fps = options.fps ?? 30;
  const overrides = options.actionOverrides ?? {};
  const actions: CompiledDirectorAction[] = [];
  const events: CompiledDirectorEvent[] = [];
  let nextActionStart = 0;
  for (const [index, transition] of validation.replay.transitions.entries()) {
    const sourceAction = take.actions[index];
    if (!sourceAction) throw new Error(`DIRECTOR_ACTION_MISSING: ${index}`);
    const timingValue = effectiveTiming(profile.timing, overrides[sourceAction.id], profile.globalSpeed);
    const matched = transition.matchedTileIds.length > 0;
    const actionStartFrame = nextActionStart;
    const pointerArriveFrame = actionStartFrame + timingValue.pointerTravelFrames;
    const pressFrame = pointerArriveFrame + timingValue.pressFrames;
    const flightStartFrame = pressFrame;
    const flightEndFrame = flightStartFrame + timingValue.flightFrames;
    const trayReorderStartFrame = flightEndFrame;
    const trayReorderEndFrame = trayReorderStartFrame + timingValue.trayReorderFrames;
    const matchStartFrame = trayReorderEndFrame + (matched ? timingValue.matchDelayFrames : 0);
    const matchLogicVisibleFrame = matched ? matchStartFrame : trayReorderEndFrame;
    const matchVfxEndFrame = matched ? matchStartFrame + timingValue.matchVfxFrames : matchLogicVisibleFrame;
    const inputReadyFrame = Math.max(trayReorderEndFrame, matchVfxEndFrame - (matched ? timingValue.inputOverlapFrames : 0));
    const actionVisualEndFrame = Math.max(trayReorderEndFrame, matchVfxEndFrame, pressFrame + timingValue.pressFrames);
    const timing: CompiledActionTiming = {
      actionStartFrame,
      pointerArriveFrame,
      pressFrame,
      flightStartFrame,
      flightEndFrame,
      trayReorderStartFrame,
      trayReorderEndFrame,
      matchStartFrame,
      matchLogicVisibleFrame,
      matchVfxEndFrame,
      inputReadyFrame,
      actionVisualEndFrame,
    };
    const compiledAction: CompiledDirectorAction = {
      index,
      actionId: sourceAction.id,
      tileId: sourceAction.tileId,
      transition,
      timing,
      effectiveTiming: timingValue,
    };
    actions.push(compiledAction);
    for (const [eventIndex, event] of transition.events.entries()) {
      const placement = eventFrame(event.type, timing);
      events.push({
        id: `${sourceAction.id}:${eventIndex}:${event.type}`,
        actionIndex: index,
        ...placement,
        event,
      });
    }
    const gap = scaledFrames(profile.betweenActionFrames, profile.globalSpeed);
    nextActionStart = inputReadyFrame + gap;
  }
  const totalFrames = Math.max(1, ...actions.map((action) => action.timing.actionVisualEndFrame + 1));
  return {
    id: stableHash({ takeId: take.id, profileId: profile.id, seed, overrides }, 'directed'),
    levelHash: level.levelHash,
    takeId: take.id,
    finalStateHash: take.finalStateHash,
    profileId: profile.id,
    seed,
    fps,
    totalFrames,
    sourceTake: take,
    level,
    profile,
    actions,
    events,
    initialState: validation.replay.states[0]!,
  };
}
