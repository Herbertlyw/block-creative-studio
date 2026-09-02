import { describe, expect, it } from 'vitest';
import { alignStackTiles } from '../src/taptile/stackAlignment';
import type { StackTile } from '../src/taptile/stackModel';

function tile(id: string, x: number, y: number, scale = 1): StackTile {
  return { id, x, y, scale, layer: 0, rotation: 0, faceId: 'bear', locked: false };
}

describe('TapTile stack alignment', () => {
  it('aligns different-sized tile edges instead of only their centers', () => {
    const result = alignStackTiles(
      [tile('small', 120, 200, 0.5), tile('large', 260, 300, 1)],
      ['small', 'large'],
      'left',
    );
    const small = result.find((candidate) => candidate.id === 'small');
    const large = result.find((candidate) => candidate.id === 'large');
    expect(small).toBeDefined();
    expect(large).toBeDefined();
    expect((small?.x ?? 0) - 17).toBe((large?.x ?? 0) - 34);
  });

  it('distributes three tiles with equal horizontal gaps while preserving outer edges', () => {
    const result = alignStackTiles(
      [tile('one', 100, 200), tile('two', 185, 230), tile('three', 320, 260)],
      ['one', 'two', 'three'],
      'distribute-x',
    );
    const [one, two, three] = ['one', 'two', 'three'].map((id) => result.find((candidate) => candidate.id === id));
    const firstGap = (two?.x ?? 0) - (one?.x ?? 0) - 68;
    const secondGap = (three?.x ?? 0) - (two?.x ?? 0) - 68;
    expect(firstGap).toBeCloseTo(secondGap);
    expect(one?.x).toBe(100);
    expect(three?.x).toBe(320);
  });

  it('does not distribute fewer than three selected tiles', () => {
    const tiles = [tile('one', 100, 200), tile('two', 220, 200)];
    expect(alignStackTiles(tiles, ['one', 'two'], 'distribute-x')).toEqual(tiles);
  });
});
