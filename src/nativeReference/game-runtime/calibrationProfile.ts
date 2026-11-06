export interface CalibrationRoiSpec {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CalibrationProfile {
  id: string;
  version: string;
  gameId: string;
  compositionProfileId: string;
  rois: CalibrationRoiSpec[];
}
