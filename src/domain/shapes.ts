import type { PieceShape, TileColor } from './types';

export const TILE_COLORS: TileColor[] = ['coral', 'amber', 'lime', 'cyan', 'blue', 'violet', 'rose'];

export const SHAPES: PieceShape[] = [
  { id: 'single', label: '单格', cells: [[0, 0]] },
  { id: 'domino-h', label: '横二', cells: [[0, 0], [0, 1]] },
  { id: 'domino-v', label: '竖二', cells: [[0, 0], [1, 0]] },
  { id: 'tri-h', label: '横三', cells: [[0, 0], [0, 1], [0, 2]] },
  { id: 'tri-v', label: '竖三', cells: [[0, 0], [1, 0], [2, 0]] },
  { id: 'line4-h', label: '横四', cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
  { id: 'line4-v', label: '竖四', cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { id: 'line5-h', label: '横五', cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
  { id: 'line5-v', label: '竖五', cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
  { id: 'square-2', label: '方二', cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { id: 'square-3', label: '方三', cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]] },
  { id: 'l-3', label: '小 L', cells: [[0, 0], [1, 0], [1, 1]] },
  { id: 'l-5', label: '大 L', cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]] },
  { id: 'j-5', label: '大 J', cells: [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]] },
  { id: 't-4', label: 'T 四', cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
  { id: 's-4', label: 'S 四', cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
  { id: 'z-4', label: 'Z 四', cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
  { id: 'plus-5', label: '十字', cells: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]] },
];

const SHAPE_MAP = new Map(SHAPES.map((shape) => [shape.id, shape]));

export function getShape(shapeId: string): PieceShape {
  const shape = SHAPE_MAP.get(shapeId);
  if (!shape) throw new Error(`Unknown shape: ${shapeId}`);
  return shape;
}

export function getShapeBounds(shape: PieceShape): { rows: number; cols: number } {
  return {
    rows: Math.max(...shape.cells.map(([row]) => row)) + 1,
    cols: Math.max(...shape.cells.map(([, col]) => col)) + 1,
  };
}
