import type { TileMaterialId } from '../stackModel';

export interface TapTileMaterialAppearance {
  id: TileMaterialId;
  radiusRatio: number;
  surfaceOffsetYRatio: number;
  edgeDepthRatio: number;
  fillStops: ReadonlyArray<readonly [offset: number, color: string]>;
  edgeColor: string;
  borderColor: string;
  shadowColor: string;
  shadowBlurRatio: number;
  textureOpacity: number;
  highlightInsetRatio: number;
  highlightColor: string;
  highlightWidthRatio: number;
}

export const TAPTILE_MATERIAL_APPEARANCES: Readonly<Record<TileMaterialId, TapTileMaterialAppearance>> = Object.freeze({
  porcelain: {
    id: 'porcelain',
    radiusRatio: 0.12,
    surfaceOffsetYRatio: 0,
    edgeDepthRatio: 0.026,
    fillStops: [[0, '#fffdf8'], [0.56, '#f7f2e8'], [1, '#ddd8cd']],
    edgeColor: '#a7aaae',
    borderColor: 'rgba(116, 119, 122, 0.72)',
    shadowColor: 'rgba(4, 13, 28, 0.38)',
    shadowBlurRatio: 0.032,
    textureOpacity: 0.34,
    highlightInsetRatio: 0.03,
    highlightColor: 'rgba(255, 255, 255, 0.68)',
    highlightWidthRatio: 0.008,
  },
  ice: {
    id: 'ice',
    radiusRatio: 0.16,
    surfaceOffsetYRatio: 0,
    edgeDepthRatio: 0.032,
    fillStops: [[0, '#ffffff'], [0.56, '#eef5ff'], [1, '#d3e4ff']],
    edgeColor: '#779cdd',
    borderColor: 'rgba(104, 143, 208, 0.72)',
    shadowColor: 'rgba(6, 26, 70, 0.42)',
    shadowBlurRatio: 0.036,
    textureOpacity: 0.12,
    highlightInsetRatio: 0.07,
    highlightColor: 'rgba(255, 255, 255, 0.82)',
    highlightWidthRatio: 0.01,
  },
  jelly: {
    id: 'jelly',
    radiusRatio: 0.14,
    surfaceOffsetYRatio: 0,
    edgeDepthRatio: 0.03,
    fillStops: [[0, 'rgba(255, 255, 255, 0.96)'], [0.52, 'rgba(218, 242, 255, 0.88)'], [1, 'rgba(160, 211, 250, 0.82)']],
    edgeColor: 'rgba(87, 159, 221, 0.86)',
    borderColor: 'rgba(217, 245, 255, 0.95)',
    shadowColor: 'rgba(6, 29, 70, 0.4)',
    shadowBlurRatio: 0.038,
    textureOpacity: 0.08,
    highlightInsetRatio: 0.05,
    highlightColor: 'rgba(255, 255, 255, 0.9)',
    highlightWidthRatio: 0.012,
  },
  paper: {
    id: 'paper',
    radiusRatio: 0.085,
    surfaceOffsetYRatio: 0,
    edgeDepthRatio: 0.022,
    fillStops: [[0, '#fffdf7'], [0.62, '#f4efe6'], [1, '#e4dac9']],
    edgeColor: '#b9aa92',
    borderColor: 'rgba(201, 192, 174, 0.9)',
    shadowColor: 'rgba(24, 27, 38, 0.34)',
    shadowBlurRatio: 0.03,
    textureOpacity: 0.42,
    highlightInsetRatio: 0.025,
    highlightColor: 'rgba(255, 255, 255, 0.64)',
    highlightWidthRatio: 0.006,
  },
});

export function tapTileMaterialAppearance(material: TileMaterialId): TapTileMaterialAppearance {
  return TAPTILE_MATERIAL_APPEARANCES[material];
}
