import { describe, expect, it } from 'vitest';
import {
  compileTapTileTake,
  evaluateTapTileFrame,
} from '../src/taptile/director';
import {
  applyTapAction,
  compileTapTileLevel,
  createInitialTapTileGameState,
  replayTapTileTake,
} from '../src/taptile/gameplay';
import { createTapTileTake } from '../src/taptile/gameplay/take';
import {
  createDefaultTapTileProject,
  DEFAULT_DIRECTOR_PROFILES,
  type TapTileTakeAction,
} from '../src/taptile/project';
import { tapTileTraySlotCenter } from '../src/taptile/trayLayout';

const ACTION_IDS = [
  'hourglass-43',
  'hourglass-44',
  'hourglass-45',
  'hourglass-46',
  'hourglass-47',
  'hourglass-48',
];

function makeGateTake() {
  const project = createDefaultTapTileProject('hourglass');
  const level = compileTapTileLevel(project);
  let state = createInitialTapTileGameState(level);
  const actions: TapTileTakeAction[] = [];
  for (const [index, tileId] of ACTION_IDS.entries()) {
    const action = { id: `director-${index}`, type: 'tap' as const, actor: 'script' as const, tileId };
    const transition = applyTapAction(level, state, action);
    expect(transition.accepted).toBe(true);
    state = transition.after;
    actions.push({ ...action, startedAtFrame: index * 3, durationFrames: 1 });
  }
  const take = createTapTileTake(level, actions, state, {
    id: 'director-gate-take',
    name: 'Director Gate fixture',
    createdAt: '1970-01-01T00:00:00.000Z',
  });
  return { project, level, take };
}

describe('TapTile Director compiler and fixed-frame evaluation', () => {
  it('compiles one semantic Take through four replaceable profiles', () => {
    const { project, level, take } = makeGateTake();
    const profileIds = ['human-natural', 'tight-fast', 'danger-rescue', 'combo-rush'] as const;
    const compiled = profileIds.map((profileId) => compileTapTileTake(
      level,
      take,
      project.director.profiles[profileId]!,
      { seed: project.director.seed, actionOverrides: project.director.actionOverrides },
    ));
    expect(new Set(compiled.map((item) => item.totalFrames)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(compiled.map((item) => item.levelHash))).toEqual(new Set([level.levelHash]));
    expect(new Set(compiled.map((item) => item.finalStateHash))).toEqual(new Set([take.finalStateHash]));
    expect(compiled.every((item) => item.actions.map((action) => action.tileId).join('|') === ACTION_IDS.join('|'))).toBe(true);
  });

  it('separates input-ready from visual-end and permits real VFX overlap', () => {
    const { project, level, take } = makeGateTake();
    for (const profileId of ['tight-fast', 'combo-rush']) {
      const compiled = compileTapTileTake(level, take, project.director.profiles[profileId]!, { seed: 9 });
      const matchAction = compiled.actions.find((action) => action.transition.matchedTileIds.length > 0 && compiled.actions[action.index + 1]);
      expect(matchAction).toBeDefined();
      const next = compiled.actions[matchAction!.index + 1]!;
      expect(matchAction!.timing.inputReadyFrame).toBeLessThan(matchAction!.timing.actionVisualEndFrame);
      expect(next.timing.actionStartFrame).toBeLessThan(matchAction!.timing.matchVfxEndFrame);
      const overlapFrame = next.timing.actionStartFrame;
      const frame = evaluateTapTileFrame(compiled, overlapFrame);
      expect(frame.activeActionIndexes).toContain(matchAction!.index);
      expect(frame.activeActionIndexes).toContain(next.index);
      expect(frame.effects.some((effect) => effect.kind === 'match')).toBe(true);
    }
  });

  it('builds one glow-and-ceramic-shatter burst from each of the three matched slots', () => {
    const { project, level, take } = makeGateTake();
    const compiled = compileTapTileTake(level, take, project.director.profiles['human-natural']!, { seed: 73 });
    const match = compiled.actions.find((action) => action.transition.matchedTileIds.length === 3)!;
    const frame = evaluateTapTileFrame(compiled, Math.floor((match.timing.matchStartFrame + match.timing.matchVfxEndFrame) / 2));
    const effect = frame.effects.find((candidate) => candidate.kind === 'match')!;
    expect(effect.tileIds).toHaveLength(3);
    expect(effect.slotIndexes).toHaveLength(3);
    expect(effect.particles).toHaveLength(30);
    expect(effect.particles.some((particle) => particle.shape === 'ceramic-shard')).toBe(true);
    expect(effect.particles.some((particle) => particle.shape === 'spark')).toBe(true);
    expect(effect.particles.some((particle) => particle.opacity > 0)).toBe(true);
    expect(effect.praiseLabel).toBe('Great');
  });

  it('evaluates direct seek exactly like evaluating the full sequential range', () => {
    const { project, level, take } = makeGateTake();
    const compiled = compileTapTileTake(level, take, project.director.profiles['human-natural']!, { seed: 812 });
    const sequential = Array.from({ length: compiled.totalFrames }, (_, frame) => evaluateTapTileFrame(compiled, frame));
    for (const frameNumber of [0, 1, 17, 53, Math.floor(compiled.totalFrames / 2), compiled.totalFrames - 1]) {
      expect(evaluateTapTileFrame(compiled, frameNumber)).toEqual(sequential[frameNumber]);
    }
    expect(evaluateTapTileFrame(compiled, Number.MAX_SAFE_INTEGER)).toEqual(sequential.at(-1));
  });

  it('uses seeded particles/camera without Date.now or Math.random', () => {
    const { project, level, take } = makeGateTake();
    const profile = project.director.profiles['combo-rush']!;
    const first = compileTapTileTake(level, take, profile, { seed: 41 });
    const second = compileTapTileTake(level, take, profile, { seed: 41 });
    const different = compileTapTileTake(level, take, profile, { seed: 42 });
    const match = first.actions.find((action) => action.transition.matchedTileIds.length > 0)!;
    const frameNumber = match.timing.matchStartFrame + 3;
    const originalRandom = Math.random;
    const originalNow = Date.now;
    Math.random = () => { throw new Error('Math.random must not be read'); };
    Date.now = () => { throw new Error('Date.now must not be read'); };
    try {
      expect(evaluateTapTileFrame(first, frameNumber)).toEqual(evaluateTapTileFrame(second, frameNumber));
      expect(evaluateTapTileFrame(different, frameNumber).effects).not.toEqual(evaluateTapTileFrame(first, frameNumber).effects);
    } finally {
      Math.random = originalRandom;
      Date.now = originalNow;
    }
  });

  it('keeps ordinary taps steady and reserves smooth camera impact for a resolved match', () => {
    const { project, level, take } = makeGateTake();
    const compiled = compileTapTileTake(level, take, project.director.profiles['combo-rush']!, { seed: 41 });
    const ordinaryTap = compiled.actions.find((action) => action.transition.matchedTileIds.length === 0)!;
    const clickFrame = evaluateTapTileFrame(compiled, ordinaryTap.timing.pressFrame);
    expect(clickFrame.effects.some((effect) => effect.kind === 'click')).toBe(true);
    expect(clickFrame.camera).toEqual({ xPx: 0, yPx: 0, zoom: 1 });

    const match = compiled.actions.find((action) => action.transition.matchedTileIds.length === 3)!;
    const matchFrame = evaluateTapTileFrame(compiled, match.timing.matchStartFrame + 3);
    expect(matchFrame.camera.zoom).toBeGreaterThan(1);
    expect(Math.abs(matchFrame.camera.xPx)).toBeLessThanOrEqual(compiled.profile.camera.shakePx);
    expect(Math.abs(matchFrame.camera.yPx)).toBeLessThanOrEqual(compiled.profile.camera.shakePx);
  });

  it('uses the recorded normalized pointer path and exposes a deterministic hand pose', () => {
    const { project, level, take } = makeGateTake();
    const recorded = structuredClone(take);
    recorded.actions[0]!.durationFrames = 6;
    recorded.actions[0]!.pointerPath = [
      { frameOffset: 0, x: 0.72, y: 0.78 },
      { frameOffset: 6, x: 0.28, y: 0.34 },
    ];
    const compiled = compileTapTileTake(level, recorded, project.director.profiles['human-natural']!, { seed: 11 });
    const action = compiled.actions[0]!;
    const start = evaluateTapTileFrame(compiled, action.timing.actionStartFrame).pointer;
    const arrived = evaluateTapTileFrame(compiled, action.timing.pointerArriveFrame).pointer;
    expect(start).toMatchObject({ opacity: 0, scale: 1, rotationDeg: -18 });
    expect(start.xPx).toBeCloseTo(777.6);
    expect(start.yPx).toBeCloseTo(1497.6);
    expect(arrived).toMatchObject({ opacity: 1, pressed: true, rotationDeg: -18 });
    expect(arrived.xPx).toBeCloseTo(302.4);
    expect(arrived.yPx).toBeCloseTo(652.8);
  });

  it('exposes pointer, flight, tray and final logical presentation without calling gameplay during seek', () => {
    const { project, level, take } = makeGateTake();
    const compiled = compileTapTileTake(level, take, project.director.profiles['human-natural']!, { seed: 11 });
    const action = compiled.actions[0]!;
    const pointerFrame = evaluateTapTileFrame(compiled, action.timing.pointerArriveFrame);
    expect(pointerFrame.pointer.visible).toBe(true);
    expect(pointerFrame.pointer.actionIndex).toBe(0);
    const flightFrame = evaluateTapTileFrame(compiled, Math.floor((action.timing.flightStartFrame + action.timing.flightEndFrame) / 2));
    expect(flightFrame.movingTiles).toHaveLength(1);
    expect(flightFrame.gameState.boardIds).not.toContain(action.tileId);
    const landedFrame = evaluateTapTileFrame(compiled, action.timing.flightEndFrame);
    expect(landedFrame.movingTiles[0]).toMatchObject(tapTileTraySlotCenter(0));
    const finalFrame = evaluateTapTileFrame(compiled, compiled.totalFrames - 1);
    const replay = replayTapTileTake(level, take);
    expect(finalFrame.gameState).toEqual(replay.states.at(-1));
  });

  it('keeps single-action timing overrides out of gameplay identity', () => {
    const { project, level, take } = makeGateTake();
    const profile = project.director.profiles['human-natural']!;
    const baseline = compileTapTileTake(level, take, profile, { seed: 7 });
    const overridden = compileTapTileTake(level, take, profile, {
      seed: 7,
      actionOverrides: { [take.actions[0]!.id]: { flightFrames: 40 } },
    });
    expect(overridden.actions[0]!.effectiveTiming.flightFrames).toBe(40);
    expect(overridden.actions[1]!.effectiveTiming).toEqual(baseline.actions[1]!.effectiveTiming);
    expect(overridden.totalFrames).not.toBe(baseline.totalFrames);
    expect(overridden.levelHash).toBe(baseline.levelHash);
    expect(overridden.finalStateHash).toBe(baseline.finalStateHash);
  });

  it('preserves formal semantic events on the compiled event track', () => {
    const { level, take } = makeGateTake();
    const compiled = compileTapTileTake(level, take, DEFAULT_DIRECTOR_PROFILES['human-natural']!, { seed: 1 });
    const eventTypes = new Set(compiled.events.map((event) => event.event.type));
    expect(eventTypes).toEqual(new Set([
      'tap.accepted',
      'tile.fly-to-tray',
      'tray.reordered',
      'match.resolved',
      'tiles.unlocked',
    ]));
    expect(compiled.events.every((event) => event.endFrame >= event.frame)).toBe(true);
  });
});
