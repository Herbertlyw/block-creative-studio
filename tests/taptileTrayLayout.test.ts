import { describe, expect, it } from 'vitest';
import { createDefaultTapTileProject, parseTapTileProjectV2 } from '../src/taptile/project';
import {
  normalizeTapTileTrayBounds,
  tapTileBoardDownwardShiftPx,
  TAPTILE_REFERENCE_TRAY_BOUNDS,
  TAPTILE_TRAY_CAPACITY,
  tapTileTraySlotCenter,
  tapTileTraySlotRect,
} from '../src/taptile/trayLayout';

describe('TapTile reference top tray geometry', () => {
  it('uses the seven-slot geometry measured from tpt760/tpt811', () => {
    expect(TAPTILE_REFERENCE_TRAY_BOUNDS).toEqual({
      left: 30,
      top: 215,
      right: 1050,
      bottom: 385,
      width: 1020,
      height: 170,
    });
    const slots = Array.from({ length: TAPTILE_TRAY_CAPACITY }, (_, index) => tapTileTraySlotRect(index));
    expect(slots[0]).toEqual({ left: 58, top: 236, right: 182, bottom: 364, width: 124, height: 128 });
    expect(slots[6]).toEqual({ left: 898, top: 236, right: 1022, bottom: 364, width: 124, height: 128 });
    expect(slots.map((slot, index) => index === 0 ? 0 : slot.left - slots[index - 1]!.right))
      .toEqual([0, 16, 16, 16, 16, 16, 16]);
    expect(tapTileTraySlotCenter(0)).toEqual({ xPx: 120, yPx: 300 });
    expect(tapTileTraySlotCenter(6)).toEqual({ xPx: 960, yPx: 300 });
  });

  it('normalizes every V1 project to the single evidence-backed tray rectangle', () => {
    const legacyBottom = { left: 75, top: 1640, right: 1005, bottom: 1830, width: 930, height: 190 };
    expect(normalizeTapTileTrayBounds(legacyBottom)).toEqual(TAPTILE_REFERENCE_TRAY_BOUNDS);
    const custom = { left: 40, top: 220, right: 1040, bottom: 390, width: 1000, height: 170 };
    expect(normalizeTapTileTrayBounds(custom)).toEqual(TAPTILE_REFERENCE_TRAY_BOUNDS);

    const serialized = structuredClone(createDefaultTapTileProject());
    serialized.stage.safeAreas.tray = legacyBottom;
    expect(parseTapTileProjectV2(serialized).stage.safeAreas.tray).toEqual(TAPTILE_REFERENCE_TRAY_BOUNDS);
  });

  it('moves a legacy board as one rigid layout until it clears the tray reserve', () => {
    expect(tapTileBoardDownwardShiftPx([
      { centerYPx: 445, widthPx: 170, heightPx: 170, rotationDeg: 0 },
      { centerYPx: 1765, widthPx: 170, heightPx: 170, rotationDeg: 0 },
    ])).toBe(45);
    expect(tapTileBoardDownwardShiftPx([
      { centerYPx: 500, widthPx: 170, heightPx: 170, rotationDeg: 0 },
      { centerYPx: 1765, widthPx: 170, heightPx: 170, rotationDeg: 0 },
    ])).toBe(0);
  });
});
