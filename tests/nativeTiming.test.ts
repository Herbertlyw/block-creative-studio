import { ordinaryProject } from './fixtures/ordinaryProject';
import { syntheticObservedFixture } from './fixtures/syntheticObserved';
import sixActions from './fixtures/six-action-parameters.json';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import { evaluateCompiledTake } from '../src/nativeReference/games/block-placement/presentation/presentationCompiler';
import { makeNativeV2Fixture } from './fixtures/nativeV2';
const structure = JSON.parse(
  readFileSync(new URL('./fixtures/synthetic-v2-structure.json', import.meta.url), 'utf8'),
);

it('compiles and evaluates two reference-timed actions from V2 interactions', () => {
  const document = makeNativeV2Fixture(structure),
    before = JSON.stringify(document);
  const { compiled, rhythm } = compileNativeTake(document, 'synthetic-take');
  expect(compiled.actions).toHaveLength(2);
  const first = compiled.actions[0]!,
    second = compiled.actions[1]!;
  expect(second.startFrame).toBeGreaterThan(first.endFrame);
  expect(evaluateCompiledTake(compiled, first.startFrame, rhythm).currentActionId).toBe(
    'synthetic-first',
  );
  expect(evaluateCompiledTake(compiled, second.startFrame, rhythm).currentActionId).toBe(
    'synthetic-second',
  );
  expect(evaluateCompiledTake(compiled, compiled.totalFrames - 1, rhythm).snapshot.board).toEqual(
    compiled.final.board,
  );
  expect(JSON.stringify(document)).toBe(before);
});

it('rejects missing or ambiguous interactions and invalid subsequent moves', () => {
  const document = makeNativeV2Fixture(structure);
  document.takes[0].interactions.pop();
  expect(() => compileNativeTake(document, 'synthetic-take')).toThrow(/第 2 步/);
  const invalid = makeNativeV2Fixture(structure);
  invalid.takes[0].actions[1].action.pieceId = invalid.takes[0].actions[0].action.pieceId;
  expect(() => compileNativeTake(invalid, 'synthetic-take')).toThrow(/synthetic-second/);
});

it('uses bounded frame rounding when converting 30 fps to 60 fps while preserving audio seconds', async () => {
  const { retimeNativeFps } = await import('../src/contracts/editNativeDocument');
  const text = JSON.stringify(ordinaryProject());
  const before = JSON.parse(text),
    after = JSON.parse(retimeNativeFps(text, 60));
  const a = compileNativeTake(before, 'synthetic-take').compiled,
    b = compileNativeTake(after, 'synthetic-take').compiled;
  for (let i = 0; i < a.actions.length; i++)
    for (const key of [
      'startFrame',
      'releaseFrame',
      'clearStartFrame',
      'clearEndFrame',
      'endFrame',
    ] as const)
      expect(Math.abs(a.actions[i]![key] * 2 - b.actions[i]![key])).toBeLessThanOrEqual(2);
  expect(after.direction.production.audio.bgm).toEqual(before.direction.production.audio.bgm);
});

it('evaluates human and machine paths, release, commit and cross-clear on the reference frame clock', () => {
  const doc = ordinaryProject();
  doc.takes[0].actions[1].actor = 'agent';
  const { compiled, rhythm, frameSource } = compileNativeTake(doc, 'synthetic-take');
  const [human, machine] = compiled.actions;
  expect(human!.action.pointerPath[0]).toMatchObject({ x: 0.2, y: 0.8 });
  expect(machine!.action.pointerPath.length).toBeGreaterThanOrEqual(3);
  expect(machine!.action.pointerPath[0]!.y).toBeCloseTo(0.88);
  const types = (frame: number) => frameSource.evaluate(frame).semanticEvents.map((e) => e.type);
  expect(evaluateCompiledTake(compiled, human!.releaseFrame, rhythm).draggedPiece).toBeTruthy();
  expect(types(human!.releaseFrame + 1)).toContain('block-placement.placement-committed');
  expect(types(human!.clearStartFrame)).toContain('block-placement.cross-cleared');
  expect(machine!.startFrame).toBeGreaterThan(human!.endFrame);
});

it('fits each absolute action and semantic boundary at 60 fps without changing audio seconds', async () => {
  const { retimeNativeFpsAbsolute } = await import('../src/contracts/editNativeDocument');
  const text = JSON.stringify(ordinaryProject());
  const before = JSON.parse(text),
    output = retimeNativeFpsAbsolute(text, 60),
    after = JSON.parse(output);
  const a = compileNativeTake(before, 'synthetic-take').compiled,
    b = compileNativeTake(after, 'synthetic-take').compiled;
  const delta: number[] = [];
  for (let i = 0; i < a.actions.length; i++) {
    for (const key of [
      'startFrame',
      'releaseFrame',
      'clearStartFrame',
      'clearEndFrame',
      'endFrame',
    ] as const)
      delta.push(Math.abs(b.actions[i]![key] - a.actions[i]![key] * 2));
    delta.push(Math.abs(b.actions[i]!.releaseFrame + 1 - (a.actions[i]!.releaseFrame + 1) * 2));
  }
  expect(Math.max(...delta)).toBeLessThanOrEqual(1);
  expect(after.direction.production.audio).toEqual(before.direction.production.audio);
  expect(after.direction.style.agentAssets).toEqual(before.direction.style.agentAssets);
  expect(after.takes[0].actions).toEqual(before.takes[0].actions);
  expect(JSON.parse(text)).toEqual(before);
});

it('fits a three-action human and machine Take against absolute boundaries', async () => {
  const { addNativeAction, retimeNativeFpsAbsolute } = await import(
    '../src/contracts/editNativeDocument'
  );
  const text = JSON.stringify(ordinaryProject());
  const action = {
    id: 'third',
    actor: 'agent',
    schemaId: 'bcs.runtime.block-placement.semantic-action',
    action: { pieceId: 'piece-0-2-square-2', anchor: { row: 2, col: 0 } },
  };
  const interaction = {
    id: 'third-interaction',
    modality: 'pointer',
    startFrame: 0,
    endFrame: 12,
    samples: [
      { frameOffset: 0, x: 0.4, y: 0.8 },
      { frameOffset: 12, x: 0.2, y: 0.4 },
    ],
    committedActionId: 'third',
  };
  const source = addNativeAction(text, 0, JSON.stringify(action), JSON.stringify(interaction));
  const target = retimeNativeFpsAbsolute(source, 60),
    a = compileNativeTake(JSON.parse(source), 'synthetic-take').compiled,
    b = compileNativeTake(JSON.parse(target), 'synthetic-take').compiled;
  expect(a.actions).toHaveLength(3);
  for (let i = 0; i < 3; i++)
    for (const field of [
      'startFrame',
      'releaseFrame',
      'clearStartFrame',
      'clearEndFrame',
      'endFrame',
    ] as const)
      expect(Math.abs(a.actions[i]![field] * 2 - b.actions[i]![field])).toBeLessThanOrEqual(1);
  expect(
    Math.abs((a.actions[2]!.releaseFrame + 1) * 2 - (b.actions[2]!.releaseFrame + 1)),
  ).toBeLessThanOrEqual(1);
  const oversized = JSON.parse(source);
  oversized.takes[0].actions = Array.from({ length: 513 }, () => oversized.takes[0].actions[0]);
  expect(() => retimeNativeFpsAbsolute(JSON.stringify(oversized), 60)).toThrow(/最多支持 512/);
});

it('converts a legal 36-action fixed-supply take without the former 32-action cap', async () => {
  const { retimeNativeFpsAbsolute } = await import('../src/contracts/editNativeDocument');
  const { blockPlacementDefinition } = await import(
    '../src/nativeReference/games/block-placement/definition'
  );
  const doc = ordinaryProject();
  doc.production.output.fps = 20;
  const board = doc.game.initialState.data.board;
  board.cells = board.cells.map((row: unknown[]) => row.map(() => null));
  const rounds = Array.from({ length: 12 }, (_, setIndex) =>
    Array.from({ length: 3 }, (_, slotIndex) => ({
      id: `long-${setIndex}-${slotIndex}`,
      shapeId: 'single',
      color: 'blue',
      used: false,
      setIndex,
      slotIndex,
      cellColors: ['blue'],
    })),
  );
  Object.assign(doc.game.initialState.data, {
    board,
    pieces: structuredClone(rounds[0]),
    fixedPieceSupply: structuredClone(rounds),
    setIndex: 0,
    turn: 0,
    score: 0,
    combo: 0,
    status: 'playing',
  });
  Object.assign(doc.game.config.data, {
    board: structuredClone(board),
    pieces: structuredClone(rounds[0]),
    fixedPieceSupply: structuredClone(rounds),
  });
  const parsed = blockPlacementDefinition.schemas.state.parse(doc.game.initialState.data),
    hash = blockPlacementDefinition.runtime.hashState(parsed);
  doc.game.initialState.stateHash = hash;
  doc.takes[0].initialStateHash = hash;
  doc.takes[0].actions = [];
  doc.takes[0].interactions = [];
  for (let i = 0; i < 36; i++) {
    const id = `action-${i}`,
      pieceId = `long-${Math.floor(i / 3)}-${i % 3}`;
    doc.takes[0].actions.push({
      id,
      actor: 'human',
      schemaId: 'bcs.runtime.block-placement.semantic-action',
      action: { pieceId, anchor: { row: 0, col: i % 8 } },
    });
    doc.takes[0].interactions.push({
      id: `interaction-${i}`,
      modality: 'pointer',
      startFrame: 0,
      endFrame: 22,
      samples: [
        { frameOffset: 0, x: 0.2, y: 0.8 },
        { frameOffset: 22, x: 0.5, y: 0.6 },
      ],
      committedActionId: id,
    });
  }
  const text = JSON.stringify(doc),
    result = retimeNativeFpsAbsolute(text, 40),
    after = JSON.parse(result);
  const a = compileNativeTake(doc, 'synthetic-take').compiled,
    b = compileNativeTake(after, 'synthetic-take').compiled;
  expect(a.actions).toHaveLength(36);
  expect(b.actions).toHaveLength(36);
  for (let i = 0; i < 36; i++)
    for (const field of [
      'startFrame',
      'releaseFrame',
      'clearStartFrame',
      'clearEndFrame',
      'endFrame',
    ] as const)
      expect(Math.abs(a.actions[i]![field] / 20 - b.actions[i]![field] / 40)).toBeLessThanOrEqual(
        1 / 40 + 1e-9,
      );
  const many = structuredClone(doc);
  for (let i = 1; i < 4; i++) {
    const take = structuredClone(many.takes[0]);
    take.takeId = `long-take-${i}`;
    many.takes.push(take);
  }
  const manyText = JSON.stringify(many),
    manyResult = JSON.parse(retimeNativeFpsAbsolute(manyText, 40));
  expect(manyResult.takes.reduce((n: number, t: any) => n + t.actions.length, 0)).toBe(144);
  for (const take of many.takes) {
    const x = compileNativeTake(many, take.takeId).compiled,
      y = compileNativeTake(manyResult, take.takeId).compiled;
    for (let i = 0; i < x.actions.length; i++)
      for (const field of [
        'startFrame',
        'releaseFrame',
        'clearStartFrame',
        'clearEndFrame',
        'endFrame',
      ] as const)
        expect(Math.abs(x.actions[i]![field] / 20 - y.actions[i]![field] / 40)).toBeLessThanOrEqual(
          1 / 40 + 1e-9,
        );
  }
  expect(JSON.parse(manyText)).toEqual(many);
}, 15000);

it('fits the six-action take by bounded interaction adjustments while preserving the original', async () => {
  const { retimeNativeFpsAbsolute } = await import('../src/contracts/editNativeDocument');
  const text = JSON.stringify({ ...ordinaryProject(), ...sixActions });
  const parsed = JSON.parse(text);
  expect(parsed.takes[0].actions).toHaveLength(6);
  const changed = retimeNativeFpsAbsolute(text, 60),
    after = JSON.parse(changed);
  const a = compileNativeTake(parsed, 'synthetic-take').compiled,
    b = compileNativeTake(after, 'synthetic-take').compiled;
  for (let i = 0; i < 6; i++) {
    const x = a.actions[i]!,
      y = b.actions[i]!;
    for (const field of [
      'startFrame',
      'releaseFrame',
      'clearStartFrame',
      'clearEndFrame',
      'endFrame',
    ] as const)
      expect(Math.abs(y[field] / 60 - x[field] / 30)).toBeLessThanOrEqual(1 / 60 + 1e-9);
    expect(Math.abs((y.releaseFrame + 1) / 60 - (x.releaseFrame + 1) / 30)).toBeLessThanOrEqual(
      1 / 60 + 1e-9,
    );
    for (let j = 0; j < x.action.pointerPath.length; j++) {
      expect(y.action.pointerPath[j]!.x).toBeCloseTo(x.action.pointerPath[j]!.x, 9);
      expect(y.action.pointerPath[j]!.y).toBeCloseTo(x.action.pointerPath[j]!.y, 9);
      expect(
        Math.abs(
          (y.startFrame + y.action.pointerPath[j]!.frameOffset) / 60 -
            (x.startFrame + x.action.pointerPath[j]!.frameOffset) / 30,
        ),
      ).toBeLessThanOrEqual(1 / 60 + 1e-9);
    }
    const old = parsed.takes[0].interactions[i],
      next = after.takes[0].interactions[i];
    expect(Math.abs(next.endFrame - old.endFrame * 2)).toBeLessThanOrEqual(1);
  }
  expect(after.takes[0].actions).toEqual(parsed.takes[0].actions);
  expect(after.direction.production.audio).toEqual(parsed.direction.production.audio);
  expect(after.direction.style.agentAssets).toEqual(parsed.direction.style.agentAssets);
  expect(JSON.parse(text)).toEqual(parsed);
}, 15000);

it('rejects frame-rate edits for the separate reference-calibration clock', async () => {
  const { retimeNativeFps, retimeNativeFpsAbsolute } = await import(
    '../src/contracts/editNativeDocument'
  );
  const doc = (await syntheticObservedFixture()).document;
  const text = JSON.stringify(doc),
    before = JSON.parse(text);
  expect(() => retimeNativeFps(text, 30)).toThrow(/独立的秒时钟/);
  expect(() => retimeNativeFpsAbsolute(text, 30)).toThrow(/独立的秒时钟/);
  expect(JSON.parse(text)).toEqual(before);
});

it('checks unrounded event and pointer times for noninteger and downsampled rates across takes', async () => {
  const { retimeNativeFpsAbsolute } = await import('../src/contracts/editNativeDocument');
  for (const [name, fps] of [
    ['native-v2-batch-reopened.json', 45],
    ['native-v2-absolute60.json', 30],
  ] as const) {
    const original = ordinaryProject();
    const doc =
      name === 'native-v2-absolute60.json'
        ? JSON.parse(retimeNativeFpsAbsolute(JSON.stringify(original), 60))
        : original;
    const second = structuredClone(doc.takes[0]);
    second.takeId = 'second-take';
    doc.takes.push(second);
    const before = JSON.stringify(doc),
      out = retimeNativeFpsAbsolute(before, fps),
      after = JSON.parse(out);
    for (const take of doc.takes) {
      const a = compileNativeTake(doc, take.takeId).compiled,
        b = compileNativeTake(after, take.takeId).compiled;
      expect(Math.abs(b.totalFrames / fps - a.totalFrames / a.fps)).toBeLessThanOrEqual(
        1 / fps + 1e-9,
      );
      for (let i = 0; i < a.actions.length; i++) {
        const x = a.actions[i]!,
          y = b.actions[i]!;
        for (const field of [
          'startFrame',
          'releaseFrame',
          'clearStartFrame',
          'clearEndFrame',
          'endFrame',
        ] as const)
          expect(Math.abs(y[field] / fps - x[field] / a.fps)).toBeLessThanOrEqual(1 / fps + 1e-9);
        expect(
          Math.abs((y.releaseFrame + 1) / fps - (x.releaseFrame + 1) / a.fps),
        ).toBeLessThanOrEqual(1 / fps + 1e-9);
        for (let j = 0; j < x.action.pointerPath.length; j++)
          expect(
            Math.abs(
              (y.startFrame + y.action.pointerPath[j]!.frameOffset) / fps -
                (x.startFrame + x.action.pointerPath[j]!.frameOffset) / a.fps,
            ),
          ).toBeLessThanOrEqual(1 / fps + 1e-9);
      }
    }
    expect(after.direction.production.audio).toEqual(doc.direction.production.audio);
    expect(JSON.parse(before)).toEqual(doc);
  }
});
