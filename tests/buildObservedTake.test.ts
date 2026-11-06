import { expect, it } from 'vitest';
import { buildObservedTake } from '../src/contracts/buildObservedTake';
const measurement = () => ({
  version: '1.0.0',
  source: {
    sha256: 'fixture',
    width: 512,
    height: 864,
    fps: '30',
    frameCount: 150,
    firstTimestamp: 0,
    timeBase: '1/30',
  },
  timing: { mode: 'constant', timestampTicks: Array.from({ length: 150 }, (_, i) => i) },
});
const annotation = () => ({
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
  output: { width: 512, height: 864, fps: 30 },
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
      clearFrame: 54,
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
      clearFrame: 84,
      clearRows: [],
      clearCols: [],
      path: [
        { frame: 66, x: 0.8, y: 0.8 },
        { frame: 81, x: 0.3, y: 0.3 },
      ],
    },
  ],
});
it('builds only explicitly confirmed legal actions and rejects wrong clears, timing, path and source', async () => {
  const input = annotation(),
    result = await buildObservedTake(input, measurement(), 'fixture', 512, 864);
  expect(result.document.takes).toHaveLength(1);
  expect(result.timing).toHaveLength(3);
  expect(result.timing[0]!.release).toBeCloseTo(0.7);
  const wrong = annotation();
  wrong.actions[0]!.clearRows = [];
  await expect(buildObservedTake(wrong, measurement(), 'fixture', 512, 864)).rejects.toThrow(
    /消除/,
  );
  const overlap = annotation();
  overlap.actions[1]!.row = 0;
  overlap.actions[1]!.col = 0;
  overlap.actions[2]!.row = 0;
  overlap.actions[2]!.col = 0;
  await expect(buildObservedTake(overlap, measurement(), 'fixture', 512, 864)).rejects.toThrow(
    /第 3 步/,
  );
  const missing = annotation();
  missing.actions[0]!.path = [];
  await expect(buildObservedTake(missing, measurement(), 'fixture', 512, 864)).rejects.toThrow(
    /path|轨迹/,
  );
  await expect(buildObservedTake(annotation(), measurement(), 'other', 512, 864)).rejects.toThrow(
    /SHA-256/,
  );
});
