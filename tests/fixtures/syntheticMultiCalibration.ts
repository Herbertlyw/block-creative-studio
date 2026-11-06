import parameters from './multi-calibration-parameters.json';
import { ordinaryProject } from './ordinaryProject';
/** Two independently authored calibration tracks, backed by generated media. */
export function syntheticMultiCalibration() {
  const doc = ordinaryProject();
  const params = structuredClone(parameters);
  doc.direction.production.audio.cues[1]!.eventType = 'block-placement.reference-clear-body';
  Object.assign(doc, { game: params.game, takes: params.takes, production: params.production });
  Object.assign(doc.direction.style, {
    referenceCalibration: params.referenceCalibration,
    workbenchCalibrationV2: params.workbenchCalibrationV2,
  });
  return doc;
}
