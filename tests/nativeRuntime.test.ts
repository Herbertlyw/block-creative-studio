import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectNativeRuntime } from '../src/contracts/inspectNativeRuntime';
import { explainContractDocument } from '../src/contracts/validateContract';
import { makeNativeV2Fixture } from './fixtures/nativeV2';

const structure = JSON.parse(
  readFileSync(new URL('./fixtures/synthetic-v2-structure.json', import.meta.url), 'utf8'),
);

describe('isolated V2 reference runtime', () => {
  it('checks the real parsed-state hash and replays two legal semantic actions without modifying the original', () => {
    const project = makeNativeV2Fixture(structure);
    const original = JSON.stringify(project),
      result = inspectNativeRuntime(project);
    expect(explainContractDocument(project)).toContain('Schema 校验通过');
    expect(result.validated).toBe(true);
    expect(result.takes).toHaveLength(1);
    expect(result.takes[0]).toMatchObject({ actions: 2, legal: true });
    expect(result.takes[0]!.detail).toContain('fnv1a32:');
    expect(JSON.stringify(project)).toBe(original);
  });
  it('identifies the precise failing subsequent step and rejects a stale initial hash', () => {
    const project = makeNativeV2Fixture(structure);
    project.takes[0].actions[1].action.pieceId = project.takes[0].actions[0].action.pieceId;
    const original = JSON.stringify(project),
      result = inspectNativeRuntime(project);
    expect(result.validated).toBe(true);
    expect(result.takes[0]).toMatchObject({ legal: false });
    expect(result.takes[0]!.detail).toContain('第 2 步');
    expect(JSON.stringify(project)).toBe(original);
    project.game.initialState.stateHash = 'fnv1a32:00000000';
    expect(inspectNativeRuntime(project).message).toContain('STATE_HASH_MISMATCH');
  });
  it('does not treat the earlier placeholder hash as a validated state', () => {
    expect(inspectNativeRuntime(structure).message).toContain('STATE_HASH_MISMATCH');
  });
});

it('uses native cross deduplication, scores once per cell and resets combo on a non-clear', async () => {
  const { blockPlacementDefinition } = await import(
    '../src/nativeReference/games/block-placement/definition'
  );
  const project = makeNativeV2Fixture(structure);
  let state = blockPlacementDefinition.schemas.state.parse(project.game.initialState.data);
  const first = blockPlacementDefinition.runtime.resolve(
    state,
    project.takes[0].actions[0].action,
    { seed: project.takes[0].seed, stepIndex: 0 },
  );
  expect(first.clear.rows).toEqual([5]);
  expect(first.clear.cols).toEqual([4]);
  expect(first.clear.cells).toHaveLength(15);
  expect(new Set(first.clear.cells.map((c) => `${c.row}:${c.col}`)).size).toBe(15);
  expect(first.placementPoints).toBe(1);
  expect(first.clearBonusPoints).toBe(78);
  expect(first.after.score).toBe(79);
  expect(first.after.combo).toBe(1);
  state = first.after;
  const second = blockPlacementDefinition.runtime.resolve(
    state,
    project.takes[0].actions[1].action,
    { seed: project.takes[0].seed, stepIndex: 1 },
  );
  expect(second.clear.cells).toHaveLength(0);
  expect(second.after.combo).toBe(0);
  expect(second.after.score).toBe(82);
});
