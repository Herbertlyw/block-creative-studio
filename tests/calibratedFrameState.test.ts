import { syntheticObservedFixture } from './fixtures/syntheticObserved';
import { expect, it } from 'vitest';
import { inlineBrowserStudioReferences } from '../src/contracts/browserAssetReferences';
import { prepareCalibratedRenderer } from '../src/contracts/calibratedRenderer';
import { stableHash } from '../src/nativeReference/headless/stableHash';
import { readCalibratedFrame } from '../src/contracts/calibratedFrame';
import { verifyObservedPointer } from '../src/contracts/observedPointer';
import { referenceHudAt } from '../src/games/block-placement/calibrated/referenceFeedback';
import { readBBFrame } from '../src/games/block-placement/planning/timelineFrameSource';
import { selectionGlowAt } from '../src/games/block-placement/planning/selectionGlowTimeline';

const synthetic = await syntheticObservedFixture();
const project = () => JSON.parse(JSON.stringify(synthetic.document));

it('exposes the actual calibrated board and box pose without changing clock or sound events', async () => {
  const input = project();
  const doc = (await inlineBrowserStudioReferences(input, {})).document;
  const current = prepareCalibratedRenderer(doc, 'observed-take').frameSource;
  expect(current.totalFrames).toBe(151);
  for (let i = 0; i < current.totalFrames; i++) {
    const a = current.evaluate(i),
      again = current.evaluate(i);
    expect(a.semanticEvents).toEqual(again.semanticEvents);
    expect(a.identity.stateHash).toBe(again.identity.stateHash);
    expect(stableHash(readCalibratedFrame(a).gameState)).toBe(a.identity.stateHash);
    expect(readBBFrame(a).timeSeconds).toBeCloseTo(i / current.fps);
  }
  const frame = (i: number) => readCalibratedFrame(current.evaluate(i));
  expect(frame(0).phase).toBe('initial');
  expect(readCalibratedFrame(current.evaluate(6)).actionId).toBe('1');
  expect(frame(6)).toMatchObject({
    actionId: '1',
    phase: 'drag',
    drag: { x: 200, y: 1400, size: 70 },
  });
  expect(frame(15)).toMatchObject({ actionId: '1', phase: 'drag', drag: { x: 536, size: 88 } });
  const moving = frame(15).drag;
  if (!moving) throw new Error('expected drag');
  expect(moving.y).toBeCloseTo(740, 8);
  expect(frame(21).phase).toBe('placed');
  expect(frame(21).board[0][7]).toBe('blue');
  expect(frame(21).gameState.board.cells[0].every((cell: unknown) => cell === null)).toBe(true);
  expect(stableHash(frame(21).gameState)).toBe(current.evaluate(21).identity.stateHash);
  expect(frame(27).phase).toBe('post-clear');
  expect(frame(27).board[0].every((cell: unknown) => cell === null)).toBe(true);
  expect(frame(51)).toMatchObject({ actionId: '2', phase: 'post-placement', drag: null });
  const mutable = frame(6);
  mutable.state.board.cells[0][0] = null;
  mutable.board[0][0] = null;
  expect(frame(6).state.board.cells[0][0]).toBe('blue');
  expect(frame(6).board[0][0]).toBe('blue');
  expect(() => current.evaluate(-1)).toThrow(/FRAME_OUT_OF_RANGE/);
});

it('keeps confirmed seconds and quantizes phase boundaries at the output frame rate', async () => {
  const doc = project();
  doc.production.output.fps = 45;
  const source = prepareCalibratedRenderer(
    (await inlineBrowserStudioReferences(doc, {})).document,
    'observed-take',
  ).frameSource;
  const frame = (i: number) => readCalibratedFrame(source.evaluate(i));
  expect(frame(31).phase).toBe('drag');
  expect(frame(32).phase).toBe('placed');
  expect(frame(40).phase).toBe('placed');
  expect(frame(41).phase).toBe('post-clear');
  expect(source.evaluate(32).semanticEvents.map((e) => e.type)).toContain(
    'block-placement.placement-committed',
  );
  expect(source.evaluate(41).semanticEvents.map((e) => e.type)).toContain(
    'block-placement.reference-clear-body',
  );
});

it('handles a confirmed zero-duration pickup without inventing a drag frame', async () => {
  const doc = project();
  const action = doc.direction.style.referenceCalibration.actions[0];
  action.start = action.release;
  delete action.motion;
  const source = prepareCalibratedRenderer(
    (await inlineBrowserStudioReferences(doc, {})).document,
    'observed-take',
  ).frameSource;
  expect(readCalibratedFrame(source.evaluate(20)).phase).toBe('initial');
  expect(readCalibratedFrame(source.evaluate(21))).toMatchObject({
    actionId: '1',
    phase: 'placed',
    drag: null,
  });
  expect(source.evaluate(21).semanticEvents.map((event) => event.type)).toContain(
    'block-placement.placement-committed',
  );
});

it('carries an uncommitted preview drag and rack state without changing the game', async () => {
  const doc = project();
  doc.direction.style.referenceCalibration.previewDrags = [
    { pieceId: 'piece-0-0-single', slot: 0, start: 0, end: 0.19, motion: [[0.1, 200, 1300, 70]] },
  ];
  const source = prepareCalibratedRenderer(
    (await inlineBrowserStudioReferences(doc, {})).document,
    'observed-take',
  ).frameSource;
  const frame = readCalibratedFrame(source.evaluate(3));
  expect(frame.phase).toBe('initial');
  expect(frame.previewDrag?.pieceId).toBe('piece-0-0-single');
  expect(frame.previewPose).toEqual({ x: 200, y: 1300, size: 70 });
  expect(frame.gameState.turn).toBe(0);
  const preview = readBBFrame(source.evaluate(3)).preview;
  expect(preview?.piece).toEqual({
    id: 'piece-0-0-single',
    color: frame.rackState.pieces[0]!.color,
    cells: [[0, 0]],
  });
  const packet = source.evaluate(3),
    bad = structuredClone(packet) as typeof packet & {
      payload: { frame: { preview: { piece: { id: string } } } };
    };
  bad.payload.frame.preview.piece.id = 'other';
  expect(() => readBBFrame(bad)).toThrow(/BB_FRAME_CONTRACT_INVALID/);
  frame.rackState.pieces[0].used = true;
  expect(readCalibratedFrame(source.evaluate(3)).rackState.pieces[0]!.used).toBe(false);
});

it('samples selection feedback for committed and uncommitted motion on the shared clock', async () => {
  const doc = project();
  const calibration = doc.direction.style.referenceCalibration;
  const glow = { enabled: true, intensity: 0.8, haloPx: 20, edgePx: 3 };
  calibration.effects = { ...calibration.effects, selectionGlow: glow };
  calibration.previewDrags = [
    { pieceId: 'piece-0-0-single', slot: 0, start: 0, end: 0.19, motion: [[0.1, 200, 1300, 70]] },
  ];
  const { frameSource } = prepareCalibratedRenderer(
    (await inlineBrowserStudioReferences(doc, {})).document,
    'observed-take',
  );
  const preview = readBBFrame(frameSource.evaluate(3));
  expect(preview.previewSelectionGlow).toEqual({
    config: glow,
    amount: selectionGlowAt(glow, 0, 0.19, 0.1),
  });
  const drag = readBBFrame(frameSource.evaluate(9)),
    action = calibration.actions[0];
  expect(drag.selectionGlow).toEqual({
    config: glow,
    amount: selectionGlowAt(glow, action.start, action.release, 0.3),
  });
  expect(readBBFrame(frameSource.evaluate(21)).selectionGlow).toBeNull();
});

it('keeps the logical state hash correct when authored action intervals overlap', async () => {
  const doc = project();
  doc.direction.style.referenceCalibration.actions[1].start = 0.6;
  const source = prepareCalibratedRenderer(
    (await inlineBrowserStudioReferences(doc, {})).document,
    'observed-take',
  ).frameSource;
  const packet = source.evaluate(20),
    frame = readCalibratedFrame(packet);
  expect(frame.actionId).toBe('2');
  expect(frame.gameState.turn).toBe(0);
  expect(frame.board[0].slice(0, 7)).toEqual(Array(7).fill('blue'));
  expect(frame.board[0][7]).toBeNull();
  expect(frame.rackState.pieces[0].used).toBe(false);
  expect(stableHash(frame.gameState)).toBe(packet.identity.stateHash);
});

it('holds the earlier placement visually when the next drag begins before its clear', async () => {
  const doc = project();
  doc.direction.style.referenceCalibration.actions[1].start = 0.75;
  const source = prepareCalibratedRenderer(
    (await inlineBrowserStudioReferences(doc, {})).document,
    'observed-take',
  ).frameSource;
  const frame = readCalibratedFrame(source.evaluate(24));
  expect(frame.actionId).toBe('2');
  expect(frame.gameState.turn).toBe(1);
  expect(frame.gameState.board.cells[0].every((cell) => cell === null)).toBe(true);
  expect(frame.board[0]).toEqual(Array(8).fill('blue'));
});

it('rejects a later release before an outstanding clear instead of inventing layered board content', async () => {
  const doc = project();
  doc.direction.style.referenceCalibration.actions[1].start = 0.71;
  doc.direction.style.referenceCalibration.actions[1].release = 0.8;
  delete doc.direction.style.referenceCalibration.actions[1].motion;
  const resolved = (await inlineBrowserStudioReferences(doc, {})).document;
  expect(() => prepareCalibratedRenderer(resolved, 'observed-take')).toThrow(
    /CALIBRATED_OVERLAPPING_CLEAR_UNSUPPORTED:1:2/,
  );
});

it('samples the verified pointer, camera, feedback and audio events in the same packet', async () => {
  const input = project();
  const rawPointer = structuredClone(synthetic.pointer);
  const pointer = await verifyObservedPointer(input, rawPointer);
  const doc = (await inlineBrowserStudioReferences(input, {})).document;
  const source = prepareCalibratedRenderer(doc, 'observed-take', pointer).frameSource;
  const noPointer = prepareCalibratedRenderer(doc, 'observed-take').frameSource;
  expect(source.frameSourceHash).not.toBe(noPointer.frameSourceHash);
  const first = readCalibratedFrame(source.evaluate(6));
  const later = readCalibratedFrame(source.evaluate(15));
  expect(first.pointer).toMatchObject({
    actionId: '1',
    kind: 'ring',
    radius: pointer.style.radius,
  });
  expect(later.pointer?.x).not.toBe(first.pointer?.x);
  expect(first.drag).toEqual(readCalibratedFrame(noPointer.evaluate(6)).drag);
  expect(readCalibratedFrame(source.evaluate(0)).pointer).toBeNull();
  const beforeClear = readCalibratedFrame(source.evaluate(21));
  expect(beforeClear).toMatchObject({ frameIndex: 21, fps: 30, totalFrames: 151 });
  expect(beforeClear.clearEffects[0]).toMatchObject({
    actionId: '1',
    rows: [0],
    cols: [],
    age: expect.any(Number),
  });
  expect(beforeClear.clearEffects[0]!.age).toBeLessThan(0);
  const onClear = source.evaluate(27),
    clearing = readCalibratedFrame(onClear);
  expect(clearing.clearEffects[0]!.age).toBeCloseTo(0);
  expect(clearing.semanticEvents).toEqual(onClear.semanticEvents);
  expect(clearing.activeAction?.step.action.id).toBe('1');
  expect(clearing.activeAction?.timing.actionId).toBe('1');
  expect(clearing.clearEffects[0]!.step.action.id).toBe('1');
  expect(clearing.clearEffects[0]!.timing.actionId).toBe('1');
  expect(clearing.hud).toEqual(
    expect.objectContaining({ score: expect.any(Number), pulse: expect.any(Number) }),
  );
  expect(clearing.camera).toEqual(
    expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
      scale: expect.any(Number),
    }),
  );
  clearing.semanticEvents.length = 0;
  clearing.clearEffects[0]!.rows.length = 0;
  clearing.clearEffects[0]!.step.action.id = 'modified';
  expect(readCalibratedFrame(source.evaluate(27)).clearEffects[0]!.rows).toEqual([0]);
  expect(readCalibratedFrame(source.evaluate(27)).clearEffects[0]!.step.action.id).toBe('1');
  expect(source.evaluate(27).semanticEvents.length).toBeGreaterThan(0);
  onClear.semanticEvents.length = 0;
  expect(source.evaluate(27).semanticEvents.length).toBeGreaterThan(0);
  const bad = { ...pointer, takeId: 'other' };
  expect(() => prepareCalibratedRenderer(doc, 'observed-take', bad)).toThrow(/指针 Take/);
});

it('samples score and screen feedback with the frame clock instead of recomputing them in the scene', async () => {
  const doc = project();
  const calibration = doc.direction.style.referenceCalibration;
  calibration.scoreFeedback = {
    enabled: true,
    source: 'native',
    durationSeconds: 1,
    risePx: 80,
    fontSize: 50,
    delaySeconds: 0,
  };
  calibration.effects = {
    ...calibration.effects,
    screenAtmosphere: { enabled: true, style: 'aurora-veil', intensity: 0.8 },
  };
  calibration.actions[0].label = 'Great!';
  const source = prepareCalibratedRenderer(
    (await inlineBrowserStudioReferences(doc, {})).document,
    'observed-take',
  ).frameSource;
  const before = readCalibratedFrame(source.evaluate(26));
  const clear = readCalibratedFrame(source.evaluate(30));
  expect(before.scorePopups).toEqual([]);
  expect(before.atmosphereAge).toBeNull();
  expect(clear.scorePopups).toHaveLength(1);
  expect(clear.scorePopups[0]).toMatchObject({
    text: expect.stringMatching(/^\+\d+$/),
    alpha: expect.any(Number),
  });
  expect(clear.atmosphereAge).toBeCloseTo(0.1);
  clear.scorePopups[0]!.text = 'modified';
  expect(readCalibratedFrame(source.evaluate(30)).scorePopups[0]!.text).not.toBe('modified');
});

it.each([30, 60])(
  'samples observed HUD score and pulse against measured seconds at %i fps',
  async (fps) => {
    const doc = project();
    doc.production.output.fps = fps;
    const calibration = doc.direction.style.referenceCalibration;
    calibration.scoreTrack = [
      [0, 0],
      [0.2, 10],
      [0.5, 30],
      [1, 50],
    ];
    calibration.effects = {
      ...calibration.effects,
      scoreHud: { enabled: true, interpolate: true, diamondPulse: true },
    };
    const source = prepareCalibratedRenderer(
      (await inlineBrowserStudioReferences(doc, {})).document,
      'observed-take',
    ).frameSource;
    for (let frame = 0; frame < source.totalFrames; frame++)
      expect(readCalibratedFrame(source.evaluate(frame)).hud).toEqual(
        referenceHudAt(calibration, frame / fps),
      );
  },
);
