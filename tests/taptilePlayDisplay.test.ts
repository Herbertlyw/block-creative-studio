import { describe, expect, it } from 'vitest';
import {
  normalizeTapTilePlayDisplayMode,
  tapTilePlayDisplayTreatment,
} from '../src/taptile/play/playDisplayMode';

describe('TapTile play display mode', () => {
  it('defaults unknown or missing preferences to showing every tile normally', () => {
    expect(normalizeTapTilePlayDisplayMode(null)).toBe('all');
    expect(normalizeTapTilePlayDisplayMode('all')).toBe('all');
    expect(normalizeTapTilePlayDisplayMode('legacy-value')).toBe('all');
  });

  it('only dims blocked tiles and highlights playable tiles in playable mode', () => {
    expect(tapTilePlayDisplayTreatment('all', false)).toEqual({ dimmed: false, highlighted: false });
    expect(tapTilePlayDisplayTreatment('all', true)).toEqual({ dimmed: false, highlighted: false });
    expect(tapTilePlayDisplayTreatment('playable', false)).toEqual({ dimmed: true, highlighted: false });
    expect(tapTilePlayDisplayTreatment('playable', true)).toEqual({ dimmed: false, highlighted: true });
  });
});
