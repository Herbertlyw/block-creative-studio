import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEmptyBoard } from '../src/domain/boardPresets';
import {
  applyPlacement,
  createPieceSet,
  createProjectGame,
  diagnoseReplay,
} from '../src/domain/gameEngine';
import { parseStudioBundle } from '../src/domain/projectValidation';
import { rebaseTakesForSetup, replaceTakeActions } from '../src/domain/variants';
import type { PlacementAction, Take } from '../src/domain/types';

const raw = JSON.parse(
  readFileSync(new URL('./fixtures/synthetic-edited.block-creative.json', import.meta.url), 'utf8'),
);
const action = (id: string, pieceId: string, row: number, col: number): PlacementAction => ({
  id,
  actor: 'human',
  pieceId,
  anchor: { row, col },
  durationFrames: 10,
  pointerPath: [],
});
function setup() {
  const bundle = parseStudioBundle(raw),
    project = bundle.project;
  project.setupBoard = createEmptyBoard();
  project.setupPieces = createPieceSet(7, 0, ['single', 'single', 'single']);
  project.fixedPieceSupply = [
    structuredClone(project.setupPieces),
    createPieceSet(7, 1, ['single', 'single', 'single']),
  ];
  const initial = createProjectGame(project);
  const actions = project.fixedPieceSupply.flat().map((p, i) => action(`a${i}`, p.id, 0, i));
  const take: Take = {
    id: 'take',
    name: 'fixed',
    createdAt: '2026-01-01T00:00:00Z',
    initial,
    actions,
  };
  return { ...bundle, project, takes: [take] };
}

describe('fixed supply and action edits', () => {
  it('refreshes only after three placements and marks exhaustion after the final round', () => {
    const bundle = setup();
    let game = bundle.takes[0]!.initial;
    for (let i = 0; i < 6; i++) {
      const transition = applyPlacement(game, bundle.takes[0]!.actions[i]!);
      expect(transition).not.toBeNull();
      game = transition!.after;
      expect(game.setIndex).toBe(i < 2 ? 0 : 1);
      expect(game.supplyExhausted ?? false).toBe(i === 5);
    }
    expect(game.status).toBe('game-over');
    expect(parseStudioBundle(bundle).takes[0]!.actions).toHaveLength(6);
  });

  it('preserves valid actions but rejects removing a used supply round', () => {
    const bundle = setup(),
      original = structuredClone(bundle);
    const added = structuredClone(bundle.project);
    added.fixedPieceSupply!.push(createPieceSet(7, 2, ['single', 'single', 'single']));
    expect(rebaseTakesForSetup(added, bundle.takes)[0]!.actions).toEqual(bundle.takes[0]!.actions);
    const removed = structuredClone(bundle.project);
    removed.fixedPieceSupply!.pop();
    expect(() => rebaseTakesForSetup(removed, bundle.takes)).toThrow(/第 4 步/);
    expect(bundle).toEqual(original);
  });

  it('checks the affected later actions, timing and path before applying an edit', () => {
    const bundle = setup(),
      original = structuredClone(bundle);
    const reordered = structuredClone(bundle.takes[0]!.actions);
    [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
    expect(
      replaceTakeActions(bundle, 'take', reordered)
        .actions.map((a) => a.id)
        .slice(0, 2),
    ).toEqual(['a1', 'a0']);
    const overlap = structuredClone(bundle.takes[0]!.actions);
    overlap[0]!.anchor = { ...overlap[1]!.anchor };
    expect(() => replaceTakeActions(bundle, 'take', overlap)).toThrow(/第 2 步/);
    const invalidPath = structuredClone(bundle.takes[0]!.actions);
    invalidPath[0]!.pointerPath = [{ frameOffset: 11, x: 0.5, y: 0.5 }];
    expect(() => replaceTakeActions(bundle, 'take', invalidPath)).toThrow(/pointerPath/);
    expect(diagnoseReplay(bundle.takes[0]!.initial, bundle.takes[0]!.actions).ok).toBe(true);
    expect(bundle).toEqual(original);
  });
});

it('uses the current clear rule for the drag preview', async () => {
  const { evaluateBBGhost } = await import('../src/games/block-placement/planning/ghostTimeline');
  const bundle = setup();
  const snapshot = bundle.takes[0]!.initial;
  for (let row = 0; row < 7; row++) snapshot.board.cells[row]![4] = 'blue';
  snapshot.clearAxes = 'rows';
  const piece = snapshot.pieces[0]!,
    drag = {
      actionId: 'preview',
      pieceId: piece.id,
      cells: [[0, 0] as const],
      color: piece.color,
      cellColors: null,
      target: { row: 7, col: 4 },
      hover: { row: 7, col: 4 },
      pose: {
        x: 0,
        y: 0,
        size: 50,
        pitch: 50,
        space: 'design' as const,
        anchor: 'center' as const,
      },
      progress: 0.5,
    };
  const policy = { kind: 'center' as const, linePreview: true };
  const preview = evaluateBBGhost(policy, drag, snapshot, snapshot.board.cells, 0);
  expect(preview?.lines?.cols).toEqual([]);
  snapshot.referenceClearRules = [{ turn: 0, axes: 'columns' }];
  expect(evaluateBBGhost(policy, drag, snapshot, snapshot.board.cells, 0)?.lines?.cols).toEqual([
    4,
  ]);
});
