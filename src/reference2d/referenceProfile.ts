import type { TileColor } from '../domain/types';
import { DESIGN_RESOLUTION } from '../headless/coordinateMapping';

export const REFERENCE_CANVAS = DESIGN_RESOLUTION;

export const REFERENCE_LAYOUT = {
  hud: {
    best: { x: 72, y: 48, width: 320, height: 86 },
    scoreCenter: { x: 532, y: 213 },
    controls: { x: 778, y: 48, width: 210, height: 88 },
  },
  board: {
    outer: { x: 80, y: 309, size: 912, radius: 18 },
    grid: { x: 91, y: 321, cell: 108, gap: 4, pitch: 112 },
  },
  rack: {
    centersX: [238, 532, 826],
    centerY: 1470,
    cell: 50,
    pickupLift: 145,
  },
} as const;

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
