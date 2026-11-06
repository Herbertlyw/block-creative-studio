import { expect, it } from 'vitest';
import { sampleLinearTrack } from '../src/games/block-placement/planning/linearTrack';

it('samples separate pointer and box coordinates at the same clock time', () => {
  const pointer = [
    { time: 0, value: [0.1, 0.2] as const },
    { time: 1, value: [0.7, 0.8] as const },
  ];
  const piece = [
    { time: 0, value: [100, 200, 40] as const },
    { time: 1, value: [300, 400, 100] as const },
  ];
  expect(sampleLinearTrack(pointer, 0.5, 0.001)).toEqual([0.4, 0.5]);
  expect(sampleLinearTrack(piece, 0.5, 0.001)).toEqual([200, 300, 70]);
  expect(sampleLinearTrack(pointer, -1, 0.001)).toEqual([0.1, 0.2]);
  expect(sampleLinearTrack(piece, 2, 0.001)).toEqual([300, 400, 100]);
});

it('rejects an empty or out-of-order track and invalid clock', () => {
  expect(() => sampleLinearTrack([], 0, 1)).toThrow(/INVALID/);
  expect(() =>
    sampleLinearTrack(
      [
        { time: 0, value: [0, 0] as const },
        { time: -1, value: [1, 1] as const },
      ],
      0.5,
      1,
    ),
  ).toThrow(/INVALID/);
  expect(() => sampleLinearTrack([{ time: 0, value: [0, 0] as const }], 0, 0)).toThrow(/INVALID/);
});
