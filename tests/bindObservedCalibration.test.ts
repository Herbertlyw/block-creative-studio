import { expect, it } from 'vitest';
import { bindObservedCalibration } from '../src/contracts/bindObservedCalibration';
import { prepareCalibratedRenderer } from '../src/contracts/calibratedRenderer';
import { attachObservedAudio } from '../src/contracts/attachObservedAudio';
import { syntheticWav } from '../scripts/fixtures/syntheticMedia.mjs';
import { createCalibratedVariant } from '../src/contracts/calibratedVariant';

const measure = () => ({
  version: '1.0.0',
  source: {
    sha256: 'fixture',
    width: 540,
    height: 960,
    fps: '30',
    frameCount: 150,
    firstTimestamp: 900,
    timeBase: '1/90000',
  },
  timing: {
    mode: 'constant',
    timestampTicks: Array.from({ length: 150 }, (_, i) => 900 + i * 3000),
  },
});
const input = () => ({
  version: '1.0.0',
  sourceSha256: 'fixture',
  seed: 42,
  board: {
    confirmed: true,
    cells: Array.from({ length: 8 }, (_, r) =>
      Array.from({ length: 8 }, (_, c) => (r === 0 && c < 7 ? 'blue' : null)),
    ),
  },
  supply: {
    confirmed: true,
    initialUsedSlots: [],
    rounds: [
      [
        { shapeId: 'single', color: 'blue' },
        { shapeId: 'single', color: 'coral' },
        { shapeId: 'single', color: 'lime' },
      ],
    ],
  },
  output: { width: 540, height: 960, fps: 30 },
  actions: [
    {
      id: 'one',
      confirmed: true,
      slot: 0,
      row: 0,
      col: 7,
      pickupFrame: 6,
      releaseFrame: 21,
      clearFrame: 27,
      clearRows: [0],
      clearCols: [],
      path: [
        { frame: 6, x: 0.2, y: 0.8 },
        { frame: 21, x: 0.9, y: 0.2 },
      ],
    },
    {
      id: 'two',
      confirmed: true,
      slot: 1,
      row: 1,
      col: 1,
      pickupFrame: 36,
      releaseFrame: 51,
      clearFrame: 51,
      clearRows: [],
      clearCols: [],
      path: [
        { frame: 36, x: 0.5, y: 0.8 },
        { frame: 51, x: 0.2, y: 0.3 },
      ],
    },
    {
      id: 'three',
      confirmed: true,
      slot: 2,
      row: 1,
      col: 2,
      pickupFrame: 66,
      releaseFrame: 81,
      clearFrame: 81,
      clearRows: [],
      clearCols: [],
      path: [
        { frame: 66, x: 0.8, y: 0.8 },
        { frame: 81, x: 0.3, y: 0.3 },
      ],
    },
  ],
});
const geometry = () => ({
  confirmed: true,
  coordinateSystem: 'design-1080x1920-piece-top-left',
  board: [60, 300, 100],
  rackY: 1450,
  rackCell: 70,
  rackCenters: [236, 540, 844],
  theme: 'grey',
  bestScore: 0,
  motions: input().actions.map((a) => ({
    actionId: a.id,
    confirmed: true,
    points: [
      { frame: a.pickupFrame, x: 200, y: 1400, cellSize: 70 },
      { frame: a.releaseFrame, x: 60 + a.col * 100, y: 300 + a.row * 100, cellSize: 100 },
    ],
  })),
});
it('binds confirmed geometry and measured event clocks to the actual calibrated frame source', async () => {
  const result = await bindObservedCalibration(input(), measure(), 'fixture', 540, 960, geometry());
  const reopened = JSON.parse(JSON.stringify(result.document));
  const source = prepareCalibratedRenderer(reopened, 'observed-take').frameSource;
  expect(source.totalFrames).toBe(150);
  expect(source.fps).toBe(30);
  expect(source.evaluate(21).semanticEvents.map((e) => e.type)).toContain(
    'block-placement.placement-committed',
  );
  expect(source.evaluate(27).semanticEvents.map((e) => e.type)).toContain(
    'block-placement.reference-clear-body',
  );
  expect(source.evaluate(51).semanticEvents.map((e) => e.type)).toContain(
    'block-placement.placement-committed',
  );
  const cal = (reopened.direction!.style as any).referenceCalibration;
  expect(cal.actions[0].motion[0]).toEqual([0.2, 200, 1400, 70]);
  expect(cal.actions[0].release).toBeCloseTo(0.7);
  const converted = input();
  converted.output.fps = 45;
  const at45 = await bindObservedCalibration(converted, measure(), 'fixture', 540, 960, geometry());
  expect(at45.timing[0]!.release.frame).toBe(32);
  expect(at45.timing[0]!.release.seconds).toBeCloseTo(0.7);
  expect(at45.timing[0]!.release.quantizationSeconds).toBeCloseTo(32 / 45 - 0.7);
  expect(at45.frameSource.evaluate(32).semanticEvents.map((e) => e.type)).toContain(
    'block-placement.placement-committed',
  );
  const bad = geometry();
  bad.motions[0]!.points[1]!.x += 10;
  await expect(
    bindObservedCalibration(input(), measure(), 'fixture', 540, 960, bad),
  ).rejects.toThrow(/吸附/);
  const absent = input();
  absent.actions[1]!.clearFrame = 54;
  await expect(
    bindObservedCalibration(absent, measure(), 'fixture', 540, 960, geometry()),
  ).rejects.toThrow(/没有消除/);
  const stale = geometry();
  stale.motions[0]!.actionId = 'other';
  await expect(
    bindObservedCalibration(input(), measure(), 'fixture', 540, 960, stale),
  ).rejects.toThrow(/动作 ID/);
});
it('attaches selected WAVs only after checking the calibrated production mix', async () => {
  const built = await bindObservedCalibration(input(), measure(), 'fixture', 540, 960, geometry()),
    before = JSON.stringify(built.document);
  const file = (id: string) =>
    new File(
      [new Uint8Array(syntheticWav(id === 'music' ? 220 : id === 'cue' ? 740 : 1120, 0.8)).buffer],
      `${id}.wav`,
      { type: 'audio/wav' },
    );
  const settings = {
    bgm: file('music'),
    placement: file('cue'),
    clear: file('cross-cue'),
    bgmStart: 0.2,
    bgmOffset: 0.1,
    bgmGain: 0.2,
    bgmLoop: true,
    cueGain: 0.5,
  };
  const result = await attachObservedAudio(built.document, settings);
  expect(
    result.document.direction.production.audio.cues
      .filter((cue: any) => cue.assetId === 'clear')
      .map((cue: any) => cue.eventType),
  ).toEqual(['block-placement.reference-clear-body', 'block-placement.reference-clear-heavy']);
  expect(
    result.scheduledCues.filter((c) => c.eventType === 'block-placement.placement-committed'),
  ).toHaveLength(3);
  expect(
    result.scheduledCues.filter((c) => c.eventType === 'block-placement.reference-clear-body'),
  ).toHaveLength(1);
  expect(JSON.stringify(built.document)).toBe(before);
  const withAudio = JSON.stringify(result.document);
  const variant = await createCalibratedVariant(result.document, 'pink', 0.1);
  expect(JSON.stringify(result.document)).toBe(withAudio);
  const copy = structuredClone(variant.document);
  copy.direction.style.referenceCalibration.theme = 'grey';
  copy.direction.production.audio.bgm.gain = 0.2;
  expect(copy).toEqual(result.document);
  expect(
    prepareCalibratedRenderer(variant.document, 'observed-take').frameSource.evaluate(21)
      .semanticEvents,
  ).toEqual(
    prepareCalibratedRenderer(result.document, 'observed-take').frameSource.evaluate(21)
      .semanticEvents,
  );
  const unsupported = structuredClone(result.document) as any;
  unsupported.direction.style.referenceCalibration.sprites = {
    background: 'data:image/png;base64,AA==',
  };
  await expect(createCalibratedVariant(unsupported, 'pink', 0.1)).rejects.toThrow(/不支持/);
  await expect(attachObservedAudio(result.document, settings)).rejects.toThrow(/原工程保留/);
  await expect(
    attachObservedAudio(built.document, {
      ...settings,
      placement: new File(['damaged'], 'bad.wav'),
    }),
  ).rejects.toThrow();
});

it('binds and replaces the clear WAV for an observed three-line clear', async () => {
  const data = input();
  data.board.cells = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => (r < 3 && c < 7 ? 'blue' : null)),
  );
  data.supply.rounds[0]![0] = { shapeId: 'tri-v', color: 'blue' };
  data.actions[0]!.clearRows = [0, 1, 2];
  const built = await bindObservedCalibration(data, measure(), 'fixture', 540, 960, geometry());
  const wav = new File([new Uint8Array(syntheticWav(1120)).buffer], 'clear.wav', {
    type: 'audio/wav',
  });
  const result = await attachObservedAudio(built.document, {
    clear: wav,
    bgmStart: 0,
    bgmOffset: 0,
    bgmGain: 1,
    bgmLoop: false,
    cueGain: 0.5,
  });
  expect(
    result.scheduledCues.filter((c) => c.eventType === 'block-placement.reference-clear-heavy'),
  ).toHaveLength(1);
  expect(
    result.scheduledCues.filter((c) => c.eventType === 'block-placement.reference-clear-body'),
  ).toHaveLength(0);
  const { createBBWorkPackage } = await import('../src/contracts/bbWorkPackage');
  const { setNativeWorkAudio } = await import('../src/contracts/setNativeWorkAudio');
  const original = await createBBWorkPackage(result.document, null, null),
    before = JSON.stringify(original);
  const changed = await setNativeWorkAudio(original, 'clear', wav);
  const cues = (changed.project as any).direction.production.audio.cues;
  expect(cues.map((cue: any) => cue.eventType)).toEqual([
    'block-placement.reference-clear-body',
    'block-placement.reference-clear-heavy',
  ]);
  expect(new Set(cues.map((cue: any) => cue.assetId)).size).toBe(1);
  expect(JSON.stringify(original)).toBe(before);
});

it('rejects unconfirmed, duplicate and changed action identities', async () => {
  const a = input();
  a.actions[0]!.confirmed = false;
  await expect(
    bindObservedCalibration(a, measure(), 'fixture', 540, 960, geometry()),
  ).rejects.toThrow();
  const duplicate = input();
  duplicate.actions[1]!.id = 'one';
  await expect(
    bindObservedCalibration(duplicate, measure(), 'fixture', 540, 960, geometry()),
  ).rejects.toThrow();
  const result = await bindObservedCalibration(input(), measure(), 'fixture', 540, 960, geometry());
  const stale = JSON.parse(JSON.stringify(result.document));
  stale.takes[0].actions[0].action.anchor.col = 6;
  expect(() => prepareCalibratedRenderer(stale, 'observed-take')).toThrow();
});
