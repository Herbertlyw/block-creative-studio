import type { TileColor } from '../domain/types';
import { blockPlacementLayoutProfile } from '../games/block-placement/profiles/layout';

export const REFERENCE_CANVAS = blockPlacementLayoutProfile.canvas;
export const REFERENCE_LAYOUT = blockPlacementLayoutProfile;

export interface ReferenceTilePalette {
  base: string;
  top: string;
  bottom: string;
  edge: string;
  motif: string;
  glow: string;
}

export const REFERENCE_TILE_PALETTE: Record<TileColor, ReferenceTilePalette> = {
  coral: {
    base: '#ff7b46',
    top: '#ff9a61',
    bottom: '#e45b31',
    edge: '#c94d2c',
    motif: '#cf5430',
    glow: '#ff9b67',
  },
  amber: {
    base: '#ffc13a',
    top: '#ffd45d',
    bottom: '#e59a20',
    edge: '#c98318',
    motif: '#d99a20',
    glow: '#ffd86a',
  },
  lime: {
    base: '#5cd43d',
    top: '#7ce354',
    bottom: '#35aa2a',
    edge: '#2a9224',
    motif: '#2ba82a',
    glow: '#90ee68',
  },
  cyan: {
    base: '#39b8de',
    top: '#62cceb',
    bottom: '#208db8',
    edge: '#197ba2',
    motif: '#1887b2',
    glow: '#72dcff',
  },
  blue: {
    base: '#5d82ee',
    top: '#7d9cff',
    bottom: '#3d5fc8',
    edge: '#324fb2',
    motif: '#3e5fc7',
    glow: '#93adff',
  },
  violet: {
    base: '#ef61b7',
    top: '#ff81ca',
    bottom: '#c93d90',
    edge: '#ad327b',
    motif: '#bd3a88',
    glow: '#ff9cda',
  },
  rose: {
    base: '#e56392',
    top: '#f47ead',
    bottom: '#c44375',
    edge: '#a93663',
    motif: '#b94270',
    glow: '#ff9bc0',
  },
};

export const REFERENCE_BACKGROUND = {
  top: '#80bf78',
  middle: '#69b77d',
  bottom: '#1aa989',
  halo: 'rgba(200,255,194,0.18)',
} as const;

export const REFERENCE_BOARD_COLORS = {
  frame: '#2f684b',
  frameHighlight: '#4a8b63',
  slot: '#1e4033',
  slotTop: '#244a3a',
  slotEdge: '#17382c',
  shadow: 'rgba(0,88,63,0.42)',
} as const;

/** Measured 8-region RGB from ZTC4F4273 (Kimik3 recreation). rose maps to that ad's yellow. */
export const BLAST_FACE_GEOMETRY = {
  unitPx: 120,
  outlinePx: 2,
  bevelPx: 17,
} as const;

export type BlastRgb = readonly [number, number, number];

export interface BlastFaceSwatch {
  outline: BlastRgb;
  bevelTop: BlastRgb;
  bevelLeft: BlastRgb;
  bevelRight: BlastRgb;
  bevelBottom: BlastRgb;
  faceTop: BlastRgb;
  faceMid: BlastRgb;
  faceBottom: BlastRgb;
}

export const BLAST_FACE_PALETTE: Record<TileColor, BlastFaceSwatch> = {
  coral: {
    outline: [90, 8, 8],
    bevelTop: [243, 141, 126],
    bevelLeft: [223, 79, 63],
    bevelRight: [176, 50, 35],
    bevelBottom: [136, 39, 29],
    faceTop: [212, 67, 48],
    faceMid: [207, 60, 45],
    faceBottom: [201, 56, 42],
  },
  amber: {
    outline: [103, 46, 1],
    bevelTop: [250, 195, 128],
    bevelLeft: [252, 136, 38],
    bevelRight: [196, 96, 14],
    bevelBottom: [158, 71, 2],
    faceTop: [246, 133, 33],
    faceMid: [241, 122, 28],
    faceBottom: [231, 111, 17],
  },
  rose: {
    outline: [115, 73, 10],
    bevelTop: [246, 221, 113],
    bevelLeft: [251, 192, 52],
    bevelRight: [203, 143, 16],
    bevelBottom: [177, 112, 16],
    faceTop: [235, 184, 48],
    faceMid: [233, 175, 45],
    faceBottom: [230, 165, 44],
  },
  lime: {
    outline: [2, 95, 18],
    bevelTop: [118, 221, 149],
    bevelLeft: [45, 177, 64],
    bevelRight: [20, 121, 46],
    bevelBottom: [1, 96, 36],
    faceTop: [55, 175, 55],
    faceMid: [37, 159, 55],
    faceBottom: [16, 140, 51],
  },
  cyan: {
    outline: [1, 67, 108],
    bevelTop: [138, 227, 251],
    bevelLeft: [48, 188, 234],
    bevelRight: [10, 133, 203],
    bevelBottom: [1, 103, 166],
    faceTop: [47, 176, 235],
    faceMid: [29, 167, 225],
    faceBottom: [6, 154, 216],
  },
  blue: {
    outline: [20, 41, 113],
    bevelTop: [137, 179, 251],
    bevelLeft: [59, 105, 243],
    bevelRight: [30, 77, 195],
    bevelBottom: [28, 57, 146],
    faceTop: [57, 102, 229],
    faceMid: [48, 94, 226],
    faceBottom: [38, 83, 222],
  },
  violet: {
    outline: [57, 29, 82],
    bevelTop: [212, 158, 238],
    bevelLeft: [154, 107, 216],
    bevelRight: [105, 61, 149],
    bevelBottom: [87, 44, 126],
    faceTop: [145, 102, 213],
    faceMid: [135, 95, 211],
    faceBottom: [123, 84, 206],
  },
};

function hexFromRgb(color: BlastRgb): string {
  return `#${color.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function blastTileFromFace(swatch: BlastFaceSwatch): ReferenceTilePalette {
  return {
    base: hexFromRgb(swatch.faceMid),
    top: hexFromRgb(swatch.bevelTop),
    bottom: hexFromRgb(swatch.bevelBottom),
    edge: hexFromRgb(swatch.outline),
    motif: hexFromRgb(swatch.faceBottom),
    glow: hexFromRgb(swatch.bevelTop),
  };
}

/** Sampled from Hungry Studio Block Blast ads (ZTC4F4009), not a claimed official palette. */
export const BLAST_BACKGROUND = {
  top: '#32487e',
  middle: '#32487e',
  bottom: '#2c4278',
  halo: 'rgba(0,0,0,0)',
} as const;

export const BLAST_BOARD_COLORS = {
  frame: '#182549',
  frameHighlight: '#22315c',
  slot: '#1d2a4e',
  slotTop: '#22315b',
  slotEdge: '#141d3c',
  shadow: 'rgba(8,12,32,0.28)',
} as const;

export const BLAST_TILE_PALETTE: Record<TileColor, ReferenceTilePalette> = {
  coral: blastTileFromFace(BLAST_FACE_PALETTE.coral),
  amber: blastTileFromFace(BLAST_FACE_PALETTE.amber),
  lime: blastTileFromFace(BLAST_FACE_PALETTE.lime),
  cyan: blastTileFromFace(BLAST_FACE_PALETTE.cyan),
  blue: blastTileFromFace(BLAST_FACE_PALETTE.blue),
  violet: blastTileFromFace(BLAST_FACE_PALETTE.violet),
  rose: blastTileFromFace(BLAST_FACE_PALETTE.rose),
};
