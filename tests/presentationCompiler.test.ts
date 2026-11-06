import { describe, expect, it } from 'vitest';
import {
  boardAnchorFromNormalizedPointer,
  pointerLandingForPlacement,
} from '../src/director/boardLayout';
import { compileTake, evaluateCompiledTake } from '../src/director/presentationCompiler';
import { RHYTHM_PRESETS } from '../src/director/rhythmPresets';
import { createEmptyBoard } from '../src/domain/boardPresets';
import { createGame, createPieceSet } from '../src/domain/gameEngine';
import type { Take } from '../src/domain/types';

describe('presentation compiler', () => {
  it('compiles a semantic take into deterministic frames', () => {
    const pieces = createPieceSet(2, 0, ['single', 'single', 'single']);
    const initial = createGame(createEmptyBoard(), 2, pieces);
    const take: Take = {
      id: 'take-test',
      name: 'test',
      createdAt: '2026-09-01T00:00:00.000Z',
      initial,
      actions: [
        {
          id: 'a1',
          actor: 'human',
          pieceId: pieces[0]!.id,
          anchor: { row: 2, col: 3 },
          durationFrames: 18,
          pointerPath: [],
        },
      ],
    };
    const compiled = compileTake(take, RHYTHM_PRESETS['tight-fast'], 30);
    expect(compiled.totalFrames).toBeGreaterThan(60);
    const during = evaluateCompiledTake(
      compiled,
      compiled.actions[0]!.startFrame + 2,
      RHYTHM_PRESETS['tight-fast'],
    );
    expect(during.draggedPiece?.piece.id).toBe(pieces[0]!.id);
    const final = evaluateCompiledTake(
      compiled,
      compiled.totalFrames - 1,
      RHYTHM_PRESETS['tight-fast'],
    );
    expect(final.snapshot.turn).toBe(1);
    expect(final.totalFrames).toBe(compiled.totalFrames);
  });

  it('advances to later actions after a placement that clears no line', () => {
    const pieces = createPieceSet(11, 0, ['single', 'single', 'single']);
    const initial = createGame(createEmptyBoard(), 11, pieces);
    const take: Take = {
      id: 'take-sequential',
      name: 'sequential',
      createdAt: '2026-09-01T00:00:00.000Z',
      initial,
      actions: [
        {
          id: 'a1',
          actor: 'human',
          pieceId: pieces[0]!.id,
          anchor: { row: 0, col: 0 },
          durationFrames: 18,
          pointerPath: [],
        },
        {
          id: 'a2',
          actor: 'human',
          pieceId: pieces[1]!.id,
          anchor: { row: 0, col: 1 },
          durationFrames: 18,
          pointerPath: [],
        },
      ],
    };
    const rhythm = RHYTHM_PRESETS['human-natural'];
    const compiled = compileTake(take, rhythm, 30);
    const second = compiled.actions[1]!;
    const duringSecond = evaluateCompiledTake(compiled, second.startFrame + 2, rhythm);
    expect(duringSecond.draggedPiece?.piece.id).toBe(pieces[1]!.id);
    expect(evaluateCompiledTake(compiled, compiled.totalFrames - 1, rhythm).snapshot.turn).toBe(2);
  });

  it('exposes stepped placement score and temporary placement feedback before clear VFX', () => {
    const board = createEmptyBoard();
    for (let col = 0; col < 7; col += 1) board.cells[3]![col] = 'lime';
    const pieces = createPieceSet(31, 0, ['single', 'single', 'single']);
    const initial = createGame(board, 31, pieces);
    const take: Take = {
      id: 'take-placement-feedback',
      name: 'placement feedback',
      createdAt: '2026-09-01T00:00:00.000Z',
      initial,
      actions: [
        {
          id: 'a1',
          actor: 'human',
          pieceId: pieces[0]!.id,
          anchor: { row: 3, col: 7 },
          durationFrames: 18,
          pointerPath: [],
        },
      ],
    };
    const rhythm = RHYTHM_PRESETS['human-natural'];
    const compiled = compileTake(take, rhythm, 30);
    const action = compiled.actions[0]!;
    const afterRelease = evaluateCompiledTake(compiled, action.releaseFrame + 1, rhythm);
    expect(afterRelease.placementFeedback?.cells).toHaveLength(1);
    expect(afterRelease.placementFeedback?.placementPoints).toBe(1);
    expect(afterRelease.snapshot.score).toBe(1);

    const duringClear = evaluateCompiledTake(
      compiled,
      Math.round((action.clearStartFrame + action.clearEndFrame) / 2),
      rhythm,
    );
    expect(duringClear.clearing?.clear.rows).toEqual([3]);
    expect(duringClear.snapshot.score).toBeGreaterThanOrEqual(1);
    expect(duringClear.snapshot.score).toBeLessThanOrEqual(action.transition.after.score);

    const afterClear = evaluateCompiledTake(compiled, action.clearEndFrame, rhythm);
    expect(afterClear.snapshot.score).toBe(action.transition.after.score);
  });

  it('reserves the configured camera recovery interval after a clear', () => {
    const pieces = createPieceSet(8, 0, ['single', 'tri-h', 'square-2']);
    const initial = createGame(
      // This fixture becomes one full row and one full column after the single placement.
      // It exercises the cinematic hold rather than only the no-clear path.
      (() => {
        const board = createEmptyBoard();
        for (let col = 0; col < 8; col += 1) if (col !== 4) board.cells[5]![col] = 'blue';
        for (let row = 0; row < 8; row += 1) if (row !== 5) board.cells[row]![4] = 'cyan';
        return board;
      })(),
      8,
      pieces,
    );
    const take: Take = {
      id: 'take-clear-recovery',
      name: 'clear recovery',
      createdAt: '2026-09-01T00:00:00.000Z',
      initial,
      actions: [
        {
          id: 'a1',
          actor: 'human',
          pieceId: pieces[0]!.id,
          anchor: { row: 5, col: 4 },
          durationFrames: 16,
          pointerPath: [],
        },
      ],
    };
    const rhythm = RHYTHM_PRESETS['tight-fast'];
    const compiled = compileTake(take, rhythm, 30);
    const action = compiled.actions[0]!;
    expect(action.endFrame).toBeGreaterThan(action.clearEndFrame);
    expect(action.endFrame - action.clearEndFrame).toBe(
      Math.max(1, Math.round(rhythm.cameraRecoveryFrames / rhythm.globalSpeed)),
    );
  });

  it('rebuilds a short agent path onto the public canvas landing and keeps rhythm frames when fps changes', () => {
    const pieces = createPieceSet(5, 0, ['domino-h', 'single', 'single']);
    const initial = createGame(createEmptyBoard(), 5, pieces);
    const take: Take = {
      id: 'take-agent-clock',
      name: 'agent clock',
      createdAt: '2026-09-01T00:00:00.000Z',
      initial,
      actions: [
        {
          id: 'a1',
          actor: 'agent',
          pieceId: pieces[0]!.id,
          anchor: { row: 4, col: 2 },
          durationFrames: 15,
          pointerPath: [
            { frameOffset: 0, x: 0.2, y: 0.8 },
            { frameOffset: 15, x: 0.4, y: 0.4 },
          ],
        },
      ],
    };
    const rhythm = RHYTHM_PRESETS['tight-fast'];
    const at30 = compileTake(take, rhythm, 30);
    const at60 = compileTake(take, rhythm, 60);
    const landing = pointerLandingForPlacement({ row: 4, col: 2 }, { rows: 1, cols: 2 });
    const action30 = at30.actions[0]!;
    expect(action30.action.pointerPath.at(-1)).toMatchObject({ x: landing.x, y: landing.y });
    expect(action30.action.pointerPath[0]?.frameOffset).toBe(0);
    expect(action30.action.durationFrames).toBe(at60.actions[0]!.action.durationFrames);
    expect(at30.actions[0]!.releaseFrame - at30.actions[0]!.startFrame).toBe(
      action30.action.durationFrames,
    );
    const rhythmFrames =
      Math.round(rhythm.betweenActionFrames / rhythm.globalSpeed) +
      Math.round(rhythm.pickupDelayFrames / rhythm.globalSpeed);
    expect(at30.actions[0]!.startFrame).toBe(Math.round(0.45 * 30) + rhythmFrames);
    expect(at60.actions[0]!.startFrame).toBe(Math.round(0.45 * 60) + rhythmFrames);
    expect(at30.totalFrames).toBe(30 * 2);
    expect(at60.totalFrames).toBe(60 * 2);

    const released = evaluateCompiledTake(at30, action30.releaseFrame, rhythm);
    expect(released.pointer?.x).toBeCloseTo(landing.x, 5);
    expect(released.pointer?.y).toBeCloseTo(landing.y, 5);
    expect(boardAnchorFromNormalizedPointer(landing, { rows: 1, cols: 2 })).toEqual({
      row: 4,
      col: 2,
    });
    expect(released.draggedPiece?.anchor).toEqual({ row: 4, col: 2 });
  });
});

it('preserves explicitly authored short agent paths while keeping legacy regeneration', () => {
  const pieces = createPieceSet(5, 0, ['single', 'single', 'single']);
  const initial = createGame(createEmptyBoard(), 5, pieces);
  const path = [
    { frameOffset: 0, x: 0.15, y: 0.8 },
    { frameOffset: 12, x: 0.4, y: 0.6 },
  ];
  const action = {
    id: 'authored',
    actor: 'agent' as const,
    pieceId: pieces[0]!.id,
    anchor: { row: 3, col: 3 },
    durationFrames: 12,
    pointerPath: path,
  };
  const take: Take = {
    id: 'path-test',
    name: 'path-test',
    createdAt: '2026-01-01T00:00:00Z',
    initial,
    actions: [action],
  };
  const legacy = compileTake(take, RHYTHM_PRESETS['tight-fast'], 30);
  const authored = compileTake(
    { ...take, actions: [{ ...action, pointerPathMode: 'authored' }] },
    RHYTHM_PRESETS['tight-fast'],
    30,
  );
  expect(legacy.actions[0]!.action.pointerPath[0]!.x).not.toBe(path[0]!.x);
  expect(authored.actions[0]!.action.pointerPath[0]!.x).toBe(path[0]!.x);
  expect(authored.actions[0]!.action.pointerPath.at(-1)!.x).toBe(path[1]!.x);
  expect(authored.actions[0]!.action.pointerPath.at(-1)!.frameOffset).toBe(
    authored.actions[0]!.action.durationFrames,
  );
});
