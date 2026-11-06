import { expect, it } from 'vitest';
import { bbDesignTransform, type BBGeometry } from '../src/games/block-placement/planning/geometry';

const geometry: BBGeometry = {
  canvas: { width: 1064, height: 1788 },
  board: { x: 91, y: 321, pitch: 112, cell: 110, rows: 8, cols: 8 },
  fit: 'contain',
};

it.each([
  [512, 864],
  [1080, 1920],
  [1920, 1080],
  [2160, 3840],
])('maps board and edge points both ways at %s×%s', (width, height) => {
  const map = bbDesignTransform(geometry, width, height);
  expect(map.sx).toBe(map.sy);
  for (const point of [
    { x: 0, y: 0 },
    { x: 91, y: 321 },
    { x: 91 + 7 * 112, y: 321 + 7 * 112 },
    { x: 1064, y: 1788 },
  ]) {
    const output = map.designToOutput(point.x, point.y),
      roundTrip = map.outputToDesign(output.x, output.y);
    expect(roundTrip.x).toBeCloseTo(point.x, 10);
    expect(roundTrip.y).toBeCloseTo(point.y, 10);
  }
});

it('keeps measured stretch explicit and rejects invalid geometry', () => {
  const measured = { ...geometry, canvas: { width: 1080, height: 1920 }, fit: 'stretch' as const };
  const map = bbDesignTransform(measured, 1000, 1000);
  expect(map.sx).not.toBe(map.sy);
  expect(map.designToOutput(1080, 1920)).toEqual({ x: 1000, y: 1000 });
  expect(() =>
    bbDesignTransform({ ...geometry, board: { ...geometry.board, pitch: 0 } }, 512, 864),
  ).toThrow(/GEOMETRY_INVALID/);
});
