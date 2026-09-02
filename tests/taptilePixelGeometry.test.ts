import { describe, expect, it } from 'vitest';
import {
  authoringToExportPoint,
  exportToAuthoringPoint,
  isIntegerPixelPoint,
  latticePoint,
  snapAuthoringPointToExportPixels,
  TAPTILE_AUTHORING_STAGE,
  TAPTILE_EXPORT_SCALE,
  TAPTILE_EXPORT_STAGE,
} from '../src/taptile/pixelGeometry';

describe('TapTile pixel geometry', () => {
  it('uses one uniform scale from the 9:16 authoring stage to 1080x1920 export', () => {
    expect(TAPTILE_AUTHORING_STAGE).toEqual({ width: 432, height: 768 });
    expect(TAPTILE_EXPORT_STAGE).toEqual({ width: 1080, height: 1920 });
    expect(TAPTILE_EXPORT_SCALE).toBe(2.5);
  });

  it('quantizes authoring coordinates to exact export pixels', () => {
    const snapped = snapAuthoringPointToExportPixels({ x: 71, y: 213.37 });
    const exported = authoringToExportPoint(snapped);
    expect(exported).toEqual({ x: 178, y: 533 });
    expect(isIntegerPixelPoint(exported)).toBe(true);
    expect(authoringToExportPoint(exportToAuthoringPoint(exported))).toEqual(exported);
  });

  it('derives repeated and half-step positions from a single integer lattice origin', () => {
    const lattice = { originX: 140, originY: 420, pitchX: 170, pitchY: 150, subdivisions: 2 };
    expect(latticePoint(0, 0, lattice)).toEqual({ x: 140, y: 420 });
    expect(latticePoint(2, 0, lattice)).toEqual({ x: 310, y: 420 });
    expect(latticePoint(1, 1, lattice)).toEqual({ x: 225, y: 495 });
  });
});

