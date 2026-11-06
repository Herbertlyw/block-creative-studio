// Adapter for the existing render-driver contract. The actual 2D scene and
// frame orchestration are shared with authored works.
import { BB_FRAME_SCHEMA, readBBFrame } from '../planning/timelineFrameSource';
import { BBScene2D } from '../rendering/BBScene2D';
import type { PresentationPacket } from '../../../nativeReference/game-runtime/presentationPacket';
import type { CalibratedDisplayState } from '../../../contracts/calibratedFrame';
import type { ReferenceCalibration } from './parseCalibration';
import type { ImageBindings } from './imageBindings';
import type { BBGeometry } from '../planning/geometry';

const id = 'bcs.workbench.block-placement.calibrated-state',
  schema = BB_FRAME_SCHEMA;
export function createCalibratedSceneBackend(
  spec: ReferenceCalibration,
  initial: CalibratedDisplayState,
  bindings: ImageBindings,
  geometry: BBGeometry,
) {
  return {
    id,
    renderer: id,
    supportedPresentationSchemas: [schema],
    letterboxFromDesign: false,
    createStage(canvas: HTMLCanvasElement) {
      const scene = new BBScene2D(canvas, {
        quality: 'cinematic',
        alpha: true,
        observed: { spec, initial, bindings, geometry },
      });
      return {
        resize(width: number, height: number, scale = 1) {
          scene.resize(width, height, scale);
        },
        async warmup() {
          await scene.warmup();
        },
        renderAt(packet: PresentationPacket) {
          scene.renderAt(readBBFrame(packet));
        },
        dispose() {
          scene.dispose();
        },
      };
    },
  };
}
