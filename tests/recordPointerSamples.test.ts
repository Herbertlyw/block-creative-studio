import { expect, it } from 'vitest';
import { quantizeRecordedPointer } from '../src/contracts/recordPointerSamples';

it('records elapsed time at the project fps and keeps ordered endpoints when samples collide', () => {
  const points = [
    { timeMs: 100, x: 0.1, y: 0.9 },
    { timeMs: 108, x: 0.2, y: 0.8 },
    { timeMs: 370, x: 0.5, y: 0.5 },
    { timeMs: 1100, x: 0.8, y: 0.2 },
  ];
  const at30 = quantizeRecordedPointer(points, 30),
    at45 = quantizeRecordedPointer(points, 45);
  expect(at30.durationFrames).toBe(30);
  expect(at45.durationFrames).toBe(45);
  expect(at30.path[0]).toEqual({ frameOffset: 0, x: 0.1, y: 0.9 });
  expect(at30.path.at(-1)).toEqual({ frameOffset: 30, x: 0.8, y: 0.2 });
  expect(at30.path.every((p, i) => !i || p.frameOffset > at30.path[i - 1]!.frameOffset)).toBe(true);
  expect(
    quantizeRecordedPointer(
      [
        { timeMs: 1, x: 0, y: 0 },
        { timeMs: 2, x: 1, y: 1 },
      ],
      30,
    ).durationFrames,
  ).toBe(1);
  expect(() => quantizeRecordedPointer([...points, { timeMs: 5, x: 0, y: 0 }], 30)).toThrow(
    /时间或坐标/,
  );
});
