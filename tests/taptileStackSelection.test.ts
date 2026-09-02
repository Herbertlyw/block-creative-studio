import { describe, expect, it } from 'vitest';
import { makeSelectionRect, tileIdsInsideSelection } from '../src/taptile/stackSelection';
import type { StackTile } from '../src/taptile/stackModel';

function tile(id: string, x: number, y: number, layer = 0): StackTile {
  return { id, x, y, layer, rotation: 0, scale: 1, faceId: 'bear', locked: false };
}

describe('TapTile marquee selection', () => {
  it('normalizes a selection drawn in any direction', () => {
    expect(makeSelectionRect({ x: 240, y: 420 }, { x: 100, y: 180 })).toEqual({
      left: 100,
      top: 180,
      right: 240,
      bottom: 420,
      width: 140,
      height: 240,
    });
  });

  it('selects tile centers inside the marquee and respects layer focus', () => {
    const tiles = [tile('one', 120, 200, 0), tile('two', 180, 260, 2), tile('outside', 300, 500, 2)];
    const rect = makeSelectionRect({ x: 80, y: 160 }, { x: 220, y: 300 });
    expect(tileIdsInsideSelection(tiles, rect)).toEqual(['one', 'two']);
    expect(tileIdsInsideSelection(tiles, rect, 2)).toEqual(['two']);
  });
});
