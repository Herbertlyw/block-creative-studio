import { useCallback, useMemo, useRef, useState } from 'react';
import {
  applyTapAction,
  createInitialTapTileGameState,
  createTapTileTake,
  validateTapTileTake,
  type TapTileGameState,
  type TapTileTakeValidationResult,
  type TapTileTransition,
} from '../gameplay';
import type {
  CompiledTapTileLevel,
  TapTileTake,
  TapTileTakeAction,
} from '../project';

interface PointerCapture {
  x: number;
  y: number;
  durationFrames?: number;
}

export function useGameplaySession() {
  const [sessionLevel, setSessionLevel] = useState<CompiledTapTileLevel | null>(null);
  const sessionLevelRef = useRef<CompiledTapTileLevel | null>(null);
  const [gameState, setGameState] = useState<TapTileGameState | null>(null);
  const gameStateRef = useRef<TapTileGameState | null>(null);
  const [recordedActions, setRecordedActions] = useState<TapTileTakeAction[]>([]);
  const actionsRef = useRef<TapTileTakeAction[]>([]);
  const [lastTransition, setLastTransition] = useState<TapTileTransition | null>(null);
  const [transitions, setTransitions] = useState<TapTileTransition[]>([]);
  const transitionsRef = useRef<TapTileTransition[]>([]);
  const [replayValidation, setReplayValidation] = useState<TapTileTakeValidationResult | null>(null);
  const [replayIndex, setReplayIndex] = useState(0);

  const begin = useCallback((level: CompiledTapTileLevel): void => {
    const initial = createInitialTapTileGameState(level);
    sessionLevelRef.current = level;
    gameStateRef.current = initial;
    actionsRef.current = [];
    setSessionLevel(level);
    setGameState(initial);
    setRecordedActions([]);
    setLastTransition(null);
    transitionsRef.current = [];
    setTransitions([]);
    setReplayValidation(null);
    setReplayIndex(0);
  }, []);

  const restart = useCallback((): void => {
    const level = sessionLevelRef.current;
    if (level) begin(level);
  }, [begin]);

  const tapTile = useCallback((tileId: string, pointer?: PointerCapture): TapTileTransition | null => {
    const level = sessionLevelRef.current;
    const current = gameStateRef.current;
    if (!level || !current) return null;
    const index = actionsRef.current.length;
    const transition = applyTapAction(level, current, {
      id: `tap-${index + 1}-${tileId}`,
      type: 'tap',
      actor: 'human',
      tileId,
    });
    setLastTransition(transition);
    if (!transition.accepted) return transition;
    const nextTransitions = [...transitionsRef.current, transition];
    transitionsRef.current = nextTransitions;
    setTransitions(nextTransitions);
    const previous = actionsRef.current.at(-1);
    const durationFrames = Math.max(1, Math.round(pointer?.durationFrames ?? 6));
    const startedAtFrame = previous
      ? previous.startedAtFrame + previous.durationFrames + 10
      : 12;
    const x = Math.max(0, Math.min(1, pointer?.x ?? 0.5));
    const y = Math.max(0, Math.min(1, pointer?.y ?? 0.5));
    const recorded: TapTileTakeAction = {
      id: transition.action.id,
      type: 'tap',
      actor: 'human',
      tileId,
      startedAtFrame,
      durationFrames,
      pointerPath: [
        { frameOffset: 0, x, y: Math.min(1, y + 0.08) },
        { frameOffset: durationFrames, x, y },
      ],
    };
    const nextActions = [...actionsRef.current, recorded];
    actionsRef.current = nextActions;
    gameStateRef.current = transition.after;
    setRecordedActions(nextActions);
    setGameState(transition.after);
    return transition;
  }, []);

  const finish = useCallback((id: string, name: string): TapTileTake | null => {
    const level = sessionLevelRef.current;
    const current = gameStateRef.current;
    if (!level || !current || actionsRef.current.length === 0) return null;
    return createTapTileTake(level, actionsRef.current, current, { id, name });
  }, []);

  const openReplay = useCallback((level: CompiledTapTileLevel, take: TapTileTake): TapTileTakeValidationResult => {
    const validation = validateTapTileTake(level, take);
    sessionLevelRef.current = level;
    setSessionLevel(level);
    setReplayValidation(validation);
    setReplayIndex(0);
    setLastTransition(null);
    return validation;
  }, []);

  const seekReplay = useCallback((index: number): void => {
    setReplayIndex((current) => {
      const maximum = replayValidation?.replay.states.length ? replayValidation.replay.states.length - 1 : current;
      return Math.max(0, Math.min(maximum, Math.round(index)));
    });
  }, [replayValidation]);

  const replayState = useMemo(
    () => replayValidation?.replay.states[replayIndex] ?? null,
    [replayIndex, replayValidation],
  );

  return {
    sessionLevel,
    gameState,
    recordedActions,
    lastTransition,
    transitions,
    replayValidation,
    replayIndex,
    replayState,
    begin,
    restart,
    tapTile,
    finish,
    openReplay,
    seekReplay,
  };
}
