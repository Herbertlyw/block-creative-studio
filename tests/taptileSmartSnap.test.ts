import { describe, expect, it } from 'vitest';
import { solveSmartSnap } from '../src/taptile/smartSnap';
import type { StackTile } from '../src/taptile/stackModel';

function tile(id: string, x: number, y: number): StackTile {
  return {
    id,
    x,
    y,
    layer: 0,
    rotation: 0,
    scale: 1,
    faceId: 'bear',
    locked: false,
  };
}

describe('TapTile smart snapping', () => {
  it('snaps a moving tile center to the seam between two aligned tiles', () => {
    const tiles = [tile('left', 100, 300), tile('right', 168, 300), tile('moving', 260, 430)];
    const result = solveSmartSnap({
      tiles,
      movingIds: ['moving'],
      rawDx: -123,
      rawDy: 0,
      enabled: true,
    });

    expect(260 + result.dx).toBe(134);
    expect(result.guides.find((guide) => guide.axis === 'x')?.kind).toBe('seam');
    expect(result.targetIds).toEqual(expect.arrayContaining(['left', 'right']));
  });

  it('keeps an acquired seam while the pointer remains inside the wider release band', () => {
    const tiles = [tile('left', 100, 300), tile('right', 168, 300), tile('moving', 260, 430)];
    const acquired = solveSmartSnap({
      tiles,
      movingIds: ['moving'],
      rawDx: -123,
      rawDy: 0,
      enabled: true,
    });
    const retained = solveSmartSnap({
      tiles,
      movingIds: ['moving'],
      rawDx: -114,
      rawDy: 40,
      enabled: true,
      previousLocks: acquired.locks,
    });

    expect(260 + retained.dx).toBe(134);
    expect(retained.locks.x?.kind).toBe('seam');
    expect(retained.dy).toBe(40);
  });

  it('extends a repeated row with an equal-spacing track', () => {
    const tiles = [tile('one', 100, 300), tile('two', 160, 300), tile('moving', 300, 500)];
    const result = solveSmartSnap({
      tiles,
      movingIds: ['moving'],
      rawDx: -76,
      rawDy: 0,
      enabled: true,
    });

    expect(300 + result.dx).toBe(220);
    expect(result.guides.find((guide) => guide.axis === 'x')?.kind).toBe('spacing');
  });

  it('inserts a tile at the equal midpoint of a wider structural gap', () => {
    const tiles = [tile('left', 100, 300), tile('right', 236, 300), tile('moving', 300, 500)];
    const result = solveSmartSnap({
      tiles,
      movingIds: ['moving'],
      rawDx: -128,
      rawDy: 0,
      enabled: true,
    });

    expect(300 + result.dx).toBe(168);
    expect(result.guides.find((guide) => guide.axis === 'x')?.label).toBe('等距插入');
  });

  it('highlights every stationary tile sharing the selected alignment line', () => {
    const tiles = [tile('upper', 100, 250), tile('lower', 100, 350), tile('moving', 170, 500)];
    const result = solveSmartSnap({
      tiles,
      movingIds: ['moving'],
      rawDx: -66,
      rawDy: 0,
      enabled: true,
    });

    expect(170 + result.dx).toBe(100);
    expect(result.targetIds).toEqual(expect.arrayContaining(['upper', 'lower']));
  });

  it('returns unmodified movement and clears locks when snapping is disabled', () => {
    const result = solveSmartSnap({
      tiles: [tile('target', 100, 300), tile('moving', 180, 430)],
      movingIds: ['moving'],
      rawDx: 12.5,
      rawDy: -7.25,
      enabled: false,
    });

    expect(result).toMatchObject({
      dx: 12.5,
      dy: -7.25,
      guides: [],
      locks: { x: null, y: null },
      targetIds: [],
    });
  });
});
