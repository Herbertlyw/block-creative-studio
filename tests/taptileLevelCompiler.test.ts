import { describe, expect, it } from 'vitest';
import { compileTapTileLevel, convexPolygonIntersectionArea, rotatedRectVertices } from '../src/taptile/gameplay/compiler';
import { createDefaultTapTileProject } from '../src/taptile/project';

describe('TapTile rotated level compiler', () => {
  it.each([0, 15, 30, 45])('computes stable rotated overlap at %s degrees', (rotationDeg) => {
    const first = rotatedRectVertices({ centerXPx: 500, centerYPx: 700, widthPx: 200, heightPx: 160, rotationDeg, layer: 0, order: 0 });
    const second = rotatedRectVertices({ centerXPx: 540, centerYPx: 710, widthPx: 180, heightPx: 170, rotationDeg: -rotationDeg, layer: 1, order: 1 });
    const area = convexPolygonIntersectionArea(first, second);
    expect(area).toBeGreaterThan(10_000);
    expect(convexPolygonIntersectionArea(first, second)).toBeCloseTo(area, 8);
  });

  it('does not count edge-only contact as overlap', () => {
    const first = rotatedRectVertices({ centerXPx: 100, centerYPx: 100, widthPx: 100, heightPx: 100, rotationDeg: 0, layer: 0, order: 0 });
    const second = rotatedRectVertices({ centerXPx: 200, centerYPx: 100, widthPx: 100, heightPx: 100, rotationDeg: 0, layer: 1, order: 1 });
    expect(convexPolygonIntersectionArea(first, second)).toBe(0);
  });

  it('applies ignored edges before valid forced edges', () => {
    const project = createDefaultTapTileProject('free');
    const [lower, upper] = project.level.tileInstances;
    expect(lower && upper).toBeTruthy();
    if (!lower || !upper) return;
    lower.geometry = { ...lower.geometry, centerXPx: 500, centerYPx: 700, layer: 0 };
    upper.geometry = { ...upper.geometry, centerXPx: 500, centerYPx: 700, layer: 1 };
    project.level.tileInstances = [lower, upper];
    project.level.blockerOverrides.ignored = [{ blockerId: upper.id, blockedId: lower.id }];
    let level = compileTapTileLevel(project);
    expect(level.blockersByTile[lower.id]).toEqual([]);
    project.level.blockerOverrides.forced = [{ blockerId: upper.id, blockedId: lower.id }];
    level = compileTapTileLevel(project);
    expect(level.blockersByTile[lower.id]).toEqual([upper.id]);
    expect(level.blockerEdges[0]?.source).toBe('forced');
  });
});
