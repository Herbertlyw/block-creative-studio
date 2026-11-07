import type { PresentationPacket } from '../../../game-runtime/presentationPacket';
import {
  assertBackendSupportsPacket,
  type RenderBackendAdapter,
  type RenderStage,
} from '../../../rendering/backendRegistry';
import type { PreparedRenderResources } from '../../../rendering/preparedRenderResources';
import {
  BLOCK_CRUSH_DROP_PRESENTATION_SCHEMA_ID,
  blockCrushDropFrameFromPacket,
} from '../presentation/presentationAdapter';
import { BlockCrushDropReferenceScene } from './BlockCrushDropReferenceScene';
import { BLOCK_CRUSH_DROP_STAGE } from './stagePainter';
import { paletteFromCrushRuntimeAssets } from './palette';
import { verifyRuntimeAgentImageBindings } from '../../../agent-assets/storage';

export const blockCrushDropReferenceBackend: RenderBackendAdapter = {
  id: 'block-crush-drop.reference-2d',
  renderer: 'reference-2d',
  cameraMicroProjection: 'flat',
  supportedPresentationSchemas: [BLOCK_CRUSH_DROP_PRESENTATION_SCHEMA_ID],
  letterboxFromDesign: false,
  designResolution: { width: BLOCK_CRUSH_DROP_STAGE.width, height: BLOCK_CRUSH_DROP_STAGE.height },
  createStage(canvas: HTMLCanvasElement, resources: PreparedRenderResources): RenderStage {
    const scene = new BlockCrushDropReferenceScene(
      canvas,
      paletteFromCrushRuntimeAssets(resources.runtimeAssets),
      resources.runtimeAssets,
    );
    const draw = (packet: PresentationPacket) => {
      assertBackendSupportsPacket(blockCrushDropReferenceBackend, packet);
      scene.renderAt(blockCrushDropFrameFromPacket(packet));
    };
    return {
      resize: (width, height, pixelRatio) => scene.resize(width, height, pixelRatio),
      warmup: async (packet) => {
        assertBackendSupportsPacket(blockCrushDropReferenceBackend, packet);
        await verifyRuntimeAgentImageBindings(resources.runtimeAssets);
        await scene.warmup(blockCrushDropFrameFromPacket(packet));
      },
      renderAt: draw,
      captureStill: () => scene.captureNativeFrame(),
      dispose: () => scene.dispose(),
    };
  },
};
