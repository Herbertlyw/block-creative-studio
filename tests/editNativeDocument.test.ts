import { ordinaryProject } from './fixtures/ordinaryProject';
import { describe, expect, it } from 'vitest';
import {
  addNativeAction,
  deleteNativeAction,
  editNativeBoardCell,
  editNativeInteraction,
  editNativeSupplyPiece,
  reorderNativeAction,
  editNativeBgm,
  editNativeImageBinding,
  editNativeOutputSize,
  retimeNativeFps,
  editNativeCueGain,
  editNativeCueOffset,
} from '../src/contracts/editNativeDocument';
import { editNativeActionTarget } from '../src/contracts/editNativeAction';
import { inspectNativeRuntime } from '../src/contracts/inspectNativeRuntime';
const source = () => JSON.stringify(ordinaryProject());

it('changes only supported output dimensions and refuses odd or unsafe sizes', () => {
  const text = source(),
    before = JSON.parse(text),
    changed = JSON.parse(editNativeOutputSize(text, 720, 1280));
  expect(changed.production.output).toMatchObject({
    width: 720,
    height: 1280,
    fps: before.production.output.fps,
  });
  changed.production.output.width = before.production.output.width;
  changed.production.output.height = before.production.output.height;
  expect(changed).toEqual(before);
  expect(() => editNativeOutputSize(text, 721, 1280)).toThrow(/偶数/);
  const unsupported = JSON.parse(text);
  unsupported.direction.production.camera = { kind: 'unknown' };
  expect(() => editNativeOutputSize(JSON.stringify(unsupported), 720, 1280)).toThrow();
  expect(JSON.parse(text)).toEqual(before);
});

describe('transactional V2 edits', () => {
  it('updates a board cell, real initial hash and every Take reference without altering other fields', () => {
    const text = source(),
      before = JSON.parse(text),
      changed = JSON.parse(editNativeBoardCell(text, 0, 2, 'amber'));
    expect(changed.game.config.data.board.cells[0][2]).toBe('amber');
    expect(changed.game.initialState.data.board.cells[0][2]).toBe('amber');
    expect(changed.game.initialState.stateHash).not.toBe(before.game.initialState.stateHash);
    expect(changed.takes[0].initialStateHash).toBe(changed.game.initialState.stateHash);
    expect(inspectNativeRuntime(changed).takes.every((t) => t.legal)).toBe(true);
    changed.game.config.data.board.cells[0][2] = null;
    changed.game.initialState.data.board.cells[0][2] = null;
    changed.game.initialState.stateHash = before.game.initialState.stateHash;
    changed.takes[0].initialStateHash = before.takes[0].initialStateHash;
    expect(changed).toEqual(before);
  });
  it('refuses occupied target, invalid color and out-of-sync board without altering input', () => {
    const text = source();
    expect(() => editNativeBoardCell(text, 5, 4, 'blue')).toThrow(/第 1 步/);
    expect(() => editNativeBoardCell(text, 0, 2, 'not-a-color')).toThrow(/颜色/);
    const doc = JSON.parse(text);
    doc.game.config.data.board.cells[0][2] = 'blue';
    expect(() => editNativeBoardCell(JSON.stringify(doc), 0, 2, 'amber')).toThrow(/不一致/);
    expect(JSON.parse(text).game.initialState.data.board.cells[5][4]).toBeNull();
  });
  it('synchronizes fixed supply and first-round candidates and validates Takes', () => {
    const later = JSON.parse(editNativeSupplyPiece(source(), 1, 0, 'square-2', 'amber'));
    expect(later.game.config.data.fixedPieceSupply[1][0].cellColors).toEqual([
      'amber',
      'amber',
      'amber',
      'amber',
    ]);
    expect(later.game.initialState.data.fixedPieceSupply[1][0]).toEqual(
      later.game.config.data.fixedPieceSupply[1][0],
    );
    const first = JSON.parse(editNativeSupplyPiece(source(), 0, 0, 'single', 'amber'));
    expect(first.game.config.data.pieces[0].color).toBe('amber');
    expect(first.game.initialState.data.pieces[0]).toEqual(
      first.game.initialState.data.fixedPieceSupply[0][0],
    );
    expect(() => editNativeSupplyPiece(source(), 0, 0, 'square-2', 'amber')).toThrow(/第 1 步/);
  });
  it('validates reordered actions and edits interaction duration/path', () => {
    const text = source();
    const reordered = JSON.parse(reorderNativeAction(text, 0, 0, 1));
    expect(reordered.takes[0].actions[0].id).toBe('synthetic-second');
    const dependent = editNativeActionTarget(text, 0, 1, 7, 3);
    expect(() => reorderNativeAction(dependent, 0, 0, 1)).toThrow(/第 1 步/);
    const path = [
      { frameOffset: 0, x: 0.2, y: 0.8 },
      { frameOffset: 20, x: 0.5, y: 0.6 },
    ];
    const changed = JSON.parse(editNativeInteraction(text, 0, 0, 20, path));
    expect(changed.takes[0].interactions[0].endFrame).toBe(20);
    expect(changed.takes[0].interactions[0].samples).toEqual(path);
    expect(() => editNativeInteraction(text, 0, 0, 10, path)).toThrow(/frameOffset/);
  });
  it('adds and deletes actions and rechecks the resulting replay', () => {
    const text = source();
    const action = {
      id: 'synthetic-third',
      actor: 'human',
      schemaId: 'bcs.runtime.block-placement.semantic-action',
      action: { pieceId: 'piece-0-2-square-2', anchor: { row: 2, col: 0 } },
    };
    const interaction = {
      id: 'interaction-synthetic-third',
      modality: 'pointer',
      startFrame: 0,
      endFrame: 12,
      samples: [
        { frameOffset: 0, x: 0.4, y: 0.8 },
        { frameOffset: 12, x: 0.2, y: 0.4 },
      ],
      committedActionId: action.id,
    };
    const added = addNativeAction(text, 0, JSON.stringify(action), JSON.stringify(interaction));
    expect(JSON.parse(added).takes[0].actions).toHaveLength(3);
    const removed = deleteNativeAction(added, 0, 2);
    expect(JSON.parse(removed)).toEqual(JSON.parse(text));
    const dependent = editNativeActionTarget(text, 0, 1, 7, 3);
    expect(() => deleteNativeAction(dependent, 0, 0)).toThrow(/第 1 步/);
  });
});

it('edits supported image parameters and preserves original bindings and unrelated fields', async () => {
  const text = source(),
    decode = async (blob: Blob) => {
      const v = new DataView(await blob.arrayBuffer());
      return { width: v.getUint32(16), height: v.getUint32(20) };
    };
  const changed = JSON.parse(
    await editNativeImageBinding(text, 'tile.face', 'contain', 0.6, 'multiply', 0.1, decode),
  );
  expect(changed.direction.style.agentAssets.bindings['tile.face']).toMatchObject({
    fit: 'contain',
    opacity: 0.6,
    blendMode: 'multiply',
    inset: 0.1,
  });
  await expect(
    editNativeImageBinding(text, 'background.base', 'contain', 1, 'source-over', 0.1, decode),
  ).rejects.toThrow(/参数/);
});
it('edits BGM controls and compiles the resulting real reference audio mix', async () => {
  const text = source(),
    changed = JSON.parse(await editNativeBgm(text, 'synthetic-take', 0.7, 0.1, false, 0.3));
  expect(changed.direction.production.audio.bgm).toMatchObject({
    startSeconds: 0.7,
    sourceOffsetSeconds: 0.1,
    loop: false,
    gain: 0.3,
  });
  await expect(editNativeBgm(text, 'synthetic-take', 0, 0, true, 3)).rejects.toThrow(/无效/);
});

it('converts action, rhythm and pointer frame clocks while leaving audio seconds and assets unchanged', () => {
  const text = source(),
    before = JSON.parse(text),
    changed = JSON.parse(retimeNativeFps(text, 60));
  expect(changed.production.output.fps).toBe(60);
  expect(changed.direction.rhythm.clearDurationFrames).toBe(
    before.direction.rhythm.clearDurationFrames * 2,
  );
  expect(changed.takes[0].interactions[0].endFrame).toBe(
    before.takes[0].interactions[0].endFrame * 2,
  );
  expect(changed.takes[0].interactions[0].samples[1].frameOffset).toBe(
    before.takes[0].interactions[0].samples[1].frameOffset * 2,
  );
  expect(changed.direction.production.audio).toEqual(before.direction.production.audio);
  expect(changed.direction.style.agentAssets).toEqual(before.direction.style.agentAssets);
  expect(inspectNativeRuntime(changed).takes.every((t) => t.legal)).toBe(true);
});

it('edits an event cue gain only after validating and compiling the real audio mix', async () => {
  const text = source(),
    before = JSON.parse(text),
    changed = JSON.parse(await editNativeCueGain(text, 'synthetic-take', 1, 0.4));
  expect(changed.direction.production.audio.cues[1].gain).toBe(0.4);
  changed.direction.production.audio.cues[1].gain = before.direction.production.audio.cues[1].gain;
  expect(changed).toEqual(before);
  await expect(editNativeCueGain(text, 'synthetic-take', 1, -1)).rejects.toThrow(/无效/);
});
it('adds an optional cue offset and gain while preserving other audio and gameplay', async () => {
  const before = JSON.parse(source());
  delete before.direction.production.audio.cues[1].gain;
  delete before.direction.production.audio.cues[1].offsetSeconds;
  const text = JSON.stringify(before),
    gain = JSON.parse(await editNativeCueGain(text, 'synthetic-take', 1, 0.4));
  expect(gain.direction.production.audio.cues[1].gain).toBe(0.4);
  const changed = JSON.parse(await editNativeCueOffset(text, 'synthetic-take', 1, 0.125));
  expect(changed.direction.production.audio.cues[1].offsetSeconds).toBe(0.125);
  delete changed.direction.production.audio.cues[1].offsetSeconds;
  expect(changed).toEqual(before);
  await expect(editNativeCueOffset(text, 'synthetic-take', 1, -3)).rejects.toThrow(/无效/);
});
