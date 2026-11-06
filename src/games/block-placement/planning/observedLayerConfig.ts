import type { ReferenceCalibration } from '../calibrated/parseCalibration';
import type { CalibratedDisplayState } from '../../../contracts/calibratedFrame';
import type { ImageBindings } from '../calibrated/imageBindings';
import type { BBGeometry } from './geometry';

/** A validated appearance and its assets; frame sampling remains independent. */
export interface ObservedLayerConfig {
  readonly spec: ReferenceCalibration;
  readonly initial: CalibratedDisplayState;
  readonly bindings: ImageBindings;
  readonly geometry: BBGeometry;
}
