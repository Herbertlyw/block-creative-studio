import { runtimeAgentImageBindings } from '../../../agent-assets/storage';
import { loadRuntimeImage } from '../../../agent-assets/runtimeImage';
import type { BlockCrushDropPresentationFrame } from '../presentation/presentationAdapter';
import { BLOCK_CRUSH_DROP_CRUSHZR29976_TRAY_GLYPH_LAYOUTS } from './lookPack';
import { drawBlockCrushDropStage } from './stagePainter';
import {
  crushFragmentSurfaceAtlasEdge,
  requireCrushFragmentSurfaceFront,
} from './fragmentSurfaceAtlas';

/** Attachments are optional; the procedural look remains the default. */
export class BlockCrushDropBoundLook {
  readonly images = new Map<string, CanvasImageSource>();
  readonly ready: Promise<void>;
  constructor(runtimeAssets?: unknown) {
    const bindings = runtimeAgentImageBindings(runtimeAssets);
    this.ready = Promise.all(
      [
        'board.surface',
        'board.clear-surface',
        'piece.face',
        'piece.atlas',
        'hud.queue.face',
        'effect.fragment-surfaces',
      ].map(async (slot) => {
        const binding = bindings?.bySlot[slot]?.[0];
        if (!binding || !('fit' in binding)) return;
        const image = await loadRuntimeImage(binding);
        if (image) {
          if (slot === 'effect.fragment-surfaces') {
            const dimensions = image as { width: number; height: number };
            crushFragmentSurfaceAtlasEdge(dimensions.width, dimensions.height);
          }
          if (binding.opacity < 1) {
            const faded = document.createElement('canvas');
            const dimensions = image as { width: number; height: number };
            faded.width = dimensions.width;
            faded.height = dimensions.height;
            const context = faded.getContext('2d')!;
            context.globalAlpha = binding.opacity;
            context.drawImage(image, 0, 0);
            this.images.set(slot, faded);
          } else this.images.set(slot, image);
        }
      }),
    ).then(() =>
      requireCrushFragmentSurfaceFront(
        this.images.has('effect.fragment-surfaces'),
        this.images.has('piece.face'),
      ),
    );
  }
  get textured(): boolean {
    return this.images.has('piece.face');
  }
  stageOptions(
    frame: BlockCrushDropPresentationFrame,
  ): Parameters<typeof drawBlockCrushDropStage>[2] {
    const surface =
      (frame.lingeringClear ? this.images.get('board.clear-surface') : undefined) ??
      this.images.get('board.surface');
    return {
      ...(surface ? { sourceBackplate: surface } : {}),
      ...(this.images.get('hud.queue.face')
        ? { sourceTrayTile: this.images.get('hud.queue.face')! }
        : {}),
      trayGlyphLayouts: BLOCK_CRUSH_DROP_CRUSHZR29976_TRAY_GLYPH_LAYOUTS,
      ...(this.images.get('piece.face') ? { tileFaceImage: this.images.get('piece.face')! } : {}),
      ...(this.images.get('piece.atlas')
        ? { tileAtlasImage: this.images.get('piece.atlas')! }
        : {}),
    };
  }
}
