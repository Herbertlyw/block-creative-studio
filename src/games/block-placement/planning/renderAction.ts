import type { CalibratedActionTiming } from '../../../contracts/calibratedFrame';

/** Minimal, already-replayed visual inputs needed by drawing effects. */
export interface BBRenderStep {
  action: { id: string };
  before: { board: { cells: Array<Array<string | null>> } };
  after: { board: { cells: Array<Array<string | null>> }; combo: number };
  piece: { id: string; shapeId: string; color: string };
  clear: {
    rows: number[];
    cols: number[];
    cells: Array<{ row: number; col: number; color: string }>;
  };
  placedCells: Array<{ row: number; col: number }>;
  placedColors?: Record<string, string>;
}
export type BBRenderTiming = Pick<
  CalibratedActionTiming,
  | 'actionId'
  | 'start'
  | 'release'
  | 'clear'
  | 'slot'
  | 'clearFace'
  | 'linePreview'
  | 'clearStyle'
  | 'perfect'
  | 'rainbowGapSeconds'
  | 'rainbowReverse'
  | 'rainbowCells'
>;
export interface BBRenderAction {
  step: BBRenderStep;
  timing: BBRenderTiming;
}
