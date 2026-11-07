import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import projectSchema from '../contracts/bc/project.schema.json';
import { createBCDemo } from '../src/games/block-crush/demo';
import {
  bcCalibration,
  bcColours,
  bcProduction,
  bcStyle,
  editBCProject,
  readBCProject,
  replayBCTakes,
  setBCProduction,
} from '../src/games/block-crush/document';
import {
  bcBoardText,
  changeBCAction,
  changeBCBoard,
  changeBCColours,
  changeBCClearGeometry,
  changeBCMaterial,
  generateBCTake,
} from '../src/games/block-crush/editing';
import { compileBCPlayback, mixBCAudio } from '../src/games/block-crush/timeline';
import { importBCProject } from '../src/games/block-crush/assets';
import { createBrowserAssetRefReader } from '../src/contracts/browserAssetReferences';
import { makeClearEffect } from '../src/nativeReference/games/block-crush-drop/presentation/clearEffectLibrary';

describe('BC showcase native workflow', () => {
  it('uses the current BC V2 structural contract for the editable example', () => {
    const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(projectSchema);
    expect(validate(createBCDemo()), JSON.stringify(validate.errors)).toBe(true);
  });
  it('replays the original rules with a real row clear and stable frame compilation', () => {
    const project = createBCDemo();
    const replay = replayBCTakes(project)[0]!;
    expect(replay.actions).toBe(3);
    expect(replay.state.score).toBeGreaterThan(50);
    const a = compileBCPlayback(project, 'demo', true),
      b = compileBCPlayback(project, 'demo', true);
    expect(a.source.frameSourceHash).toBe(b.source.frameSourceHash);
    expect(a.source.evaluate(a.end)).toEqual(b.source.evaluate(b.end));
  });

  it('roundtrips the native document without rewriting the source', async () => {
    const original = JSON.stringify(createBCDemo());
    const reopened = await importBCProject(JSON.parse(original));
    expect(JSON.stringify(reopened)).toBe(original);
    expect(readBCProject(JSON.parse(JSON.stringify(reopened)))).toEqual(reopened);
  });

  it('indexes a shared BC library without eagerly reading unrelated files or changing the BB limit', async () => {
    const cas = Array.from({ length: 10_001 }, (_, i) => ({
      name: `${i}.bin`,
      size: 1,
      webkitRelativePath: `assets/unrelated/${i}.bin`,
      arrayBuffer: async (): Promise<ArrayBuffer> => {
        throw new Error('Unreferenced bytes must not be read');
      },
    }));
    expect(() => createBrowserAssetRefReader({ cas })).toThrow(/10000/);
    expect(await importBCProject(createBCDemo(), { cas })).toEqual(createBCDemo());
  });

  it('rejects an illegal dependent action and keeps the original intact', () => {
    const project = createBCDemo(),
      before = JSON.stringify(project);
    expect(() =>
      editBCProject(project, (draft) => {
        draft.takes[0]!.actions[1]!.action = structuredClone(draft.takes[0]!.actions[0]!.action);
      }),
    ).toThrow(/第 2 步/);
    expect(JSON.stringify(project)).toBe(before);
  });

  it('edits a target and revalidates the following actions', () => {
    const project = createBCDemo();
    const result = changeBCAction(project, 'demo', 0, 5, 1);
    expect(result.takes[0]!.actions[0]!.action).toMatchObject({ release: { x: 5 } });
    expect(replayBCTakes(result)[0]!.actions).toBe(3);
    expect(project.takes[0]!.actions[0]!.action).toMatchObject({ release: { x: 4 } });
  });

  it('rejects an edit that removes a bound clear without clips, preserving the renderable original', () => {
    const project = createBCDemo();
    project.direction!.style = {
      ...bcStyle(project),
      clearEffectLibrary: {
        version: '1.0.0',
        effects: [makeClearEffect('first-clear', {})],
        bindings: [{ effectId: 'first-clear', takeId: 'demo', actionIndex: 0, cycleIndex: 0 }],
      },
    };
    const before = JSON.stringify(project);
    expect(bcProduction(project).clips).toBeUndefined();
    expect(() => compileBCPlayback(project, 'demo', true)).not.toThrow();
    expect(() => changeBCAction(project, 'demo', 0, 5, 1)).toThrow(
      /first-clear.*demo.*第 1 步.*CLEAR_EFFECT_TARGET_HAS_NO_CLEAR/,
    );
    expect(JSON.stringify(project)).toBe(before);
    expect(() => compileBCPlayback(project, 'demo', true)).not.toThrow();
  });

  it('rejects a corrupt effect hash before accepting a document', () => {
    const project = createBCDemo();
    const effect = makeClearEffect('bad-hash', {});
    effect.contentHash = 'fnv1a32:00000000';
    project.direction!.style = {
      ...bcStyle(project),
      clearEffectLibrary: {
        version: '1.0.0',
        effects: [effect],
        bindings: [{ effectId: effect.id, takeId: 'demo', actionIndex: 0 }],
      },
    };
    expect(() => readBCProject(project)).toThrow(/CLEAR_EFFECT_VERSION_OR_HASH_MISMATCH: bad-hash/);
  });

  it('checks effect Take, action and clear cycle targets during document validation', () => {
    const project = createBCDemo();
    const effect = makeClearEffect('target-check', {});
    const library = {
      version: '1.0.0' as const,
      effects: [effect],
      bindings: [{ effectId: effect.id, takeId: 'demo', actionIndex: 0, cycleIndex: 0 }],
    };
    project.direction!.style = { ...bcStyle(project), clearEffectLibrary: library };
    expect(() => readBCProject(project)).not.toThrow();
    library.bindings[0]!.takeId = 'missing';
    expect(() => readBCProject(project)).toThrow(
      /target-check.*missing.*CLEAR_EFFECT_TAKE_MISSING/,
    );
    library.bindings[0]!.takeId = 'demo';
    library.bindings[0]!.actionIndex = 99;
    expect(() => readBCProject(project)).toThrow(/target-check.*CLEAR_EFFECT_ACTION_INVALID/);
    library.bindings[0]!.actionIndex = 0;
    library.bindings[0]!.cycleIndex = 31;
    expect(() => readBCProject(project)).toThrow(/target-check.*CLEAR_EFFECT_TARGET_HAS_NO_CLEAR/);
  });

  it('checks the bound Take director plan even without clips', () => {
    const project = createBCDemo();
    project.direction!.style = {
      ...bcStyle(project),
      clearEffectLibrary: {
        version: '1.0.0',
        effects: [makeClearEffect('plan-check', {})],
        bindings: [{ effectId: 'plan-check', takeId: 'demo', actionIndex: 0 }],
      },
    };
    project.direction!.rhythm = { phaseScale: 0 };
    expect(() => readBCProject(project)).toThrow(/demo.*消除效果计划无效.*phaseScale/);
  });

  it('changes saved colours while keeping actions, output clocks and audio', async () => {
    const project = createBCDemo();
    const result = await changeBCColours(project, ['#e39a66']);
    expect(bcCalibration(result).tileColor).toBe('#e39a66');
    expect(bcCalibration(result).tilePaletteColors).toBeUndefined();
    expect(result.takes[0]!.actions).toEqual(project.takes[0]!.actions);
    expect(bcProduction(result)).toEqual(bcProduction(project));
    expect(compileBCPlayback(result, 'demo', true).totalFrames).toBe(
      compileBCPlayback(project, 'demo', true).totalFrames,
    );
    expect(result.game.initialState.stateHash).not.toBe(project.game.initialState.stateHash);
    expect(replayBCTakes(result)[0]!.actions).toBe(3);
  });

  it('retains board cell identities on a roundtrip edit and rejects an invalid layout', () => {
    const project = createBCDemo(),
      board = bcBoardText(project);
    const edited = changeBCBoard(project, board.split('\n'));
    expect(edited.game.config.data.initialCells).toEqual(project.game.config.data.initialCells);
    expect(() => changeBCBoard(project, ['#'])).toThrow(/16 行/);
    expect(bcBoardText(project)).toBe(board);
  });

  it('generates another legal Take without replacing the existing one', () => {
    const project = createBCDemo(),
      result = generateBCTake(project, 3);
    expect(result.takes).toHaveLength(2);
    expect(result.takes[0]).toEqual(project.takes[0]);
    expect(replayBCTakes(result)[1]!.actions).toBeGreaterThan(0);
  });

  it('keeps colour identities across procedural materials and native fragment edits', () => {
    const project = createBCDemo();
    const result = changeBCClearGeometry(changeBCMaterial(project, 'ice'), 'rounded-cube');
    expect(bcColours(result)).toEqual(bcColours(project));
    expect(result.takes.map(({ initialStateHash: _hash, ...take }) => take)).toEqual(
      project.takes.map(({ initialStateHash: _hash, ...take }) => take),
    );
    expect(bcCalibration(result).clear?.fragmentGeometry).toBe('rounded-cube');
    expect(compileBCPlayback(result, 'demo', true).totalFrames).toBe(
      compileBCPlayback(project, 'demo', true).totalFrames,
    );
  });

  it('keeps full and selected clip ranges distinct and mixes the exact selected duration', async () => {
    const project = createBCDemo(),
      full = compileBCPlayback(project, 'demo', true);
    const production = bcProduction(project);
    production.clips = [
      {
        id: 'sample',
        takeId: 'demo',
        source: { takeHash: 'test', frameSourceHash: full.source.frameSourceHash },
        startFrame: 15,
        endFrame: 59,
      },
    ];
    production.selectedClipId = 'sample';
    setBCProduction(project, production);
    const selected = compileBCPlayback(project, 'demo');
    expect(selected.totalFrames).toBe(45);
    expect(compileBCPlayback(project, 'demo', true).totalFrames).toBe(full.totalFrames);
    const mix = await mixBCAudio(selected);
    expect(mix?.track.data.length).toBe((45 / 30) * 48000 * 2);
  });

  it('rejects a different renderer and an incorrect state hash instead of silently converting', () => {
    const project = createBCDemo();
    const other = structuredClone(project);
    other.direction!.style = { renderer: 'fixed-camera-cinematic' };
    expect(() => readBCProject(other)).toThrow(/reference-2d/);
    const broken = structuredClone(project);
    broken.game.initialState.stateHash = 'fnv1a32:00000000';
    expect(() => readBCProject(broken)).toThrow(/does not match the parsed initial state/);
  });
});
