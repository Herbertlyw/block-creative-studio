import { DROP_UI_ATLAS_SLOTS } from '../profiles/referenceCalibration';
import {
  calibratedHasNativeDepthCue,
  calibratedSpriteFits,
  drawCalibratedDropStage,
} from './calibratedStage';
import { BlockCrushDropClearSequences } from './clearSequenceRuntime';
import { drawClearSequenceHeader } from './stagePainter';
import type { BlockCrushDropPresentationFrame } from '../presentation/presentationAdapter';
import { BLOCK_CRUSH_DROP_STAGE, drawBlockCrushDropStage } from './stagePainter';
import type { BlockCrushDropPalette } from './palette';
import { runtimeAgentImageBindings } from '../../../agent-assets/storage';
import { loadRuntimeImage } from '../../../agent-assets/runtimeImage';
import type { RuntimeImageAssetBinding } from '../../../assets/runtimeAssetBindings';
import { BlockCrushDropBoundLook } from './boundLook';
import { ObservedFragmentDepthLayer } from './observedFragmentDepthLayer';
import { DropEncouragementGlyphLayer } from './encouragementGlyphLayer';

export class BlockCrushDropReferenceScene {
  readonly canvas: HTMLCanvasElement;
  readonly rendererLabel = 'Canvas 2D · Block 落消 Reference';

  private readonly context: CanvasRenderingContext2D;
  private readonly palette: BlockCrushDropPalette;
  private frame: BlockCrushDropPresentationFrame | null = null;
  private readonly backgroundBinding: RuntimeImageAssetBinding | null;
  private backgroundImage: CanvasImageSource | null = null;
  private readonly tilePaletteBinding: RuntimeImageAssetBinding | null;
  private tilePaletteImage: CanvasImageSource | null = null;
  private readonly uiAtlases: Record<
    string,
    { binding: RuntimeImageAssetBinding; image: CanvasImageSource }
  > = {};
  private readonly assetsReady: Promise<void>;
  private readonly clearSequences: BlockCrushDropClearSequences;
  private readonly boundLook: BlockCrushDropBoundLook;
  private observedDepthLayer: ObservedFragmentDepthLayer | undefined;
  private readonly unsupportedNativeMaterials: boolean;
  private encouragementGlyphLayer: DropEncouragementGlyphLayer | undefined;

  constructor(
    canvas: HTMLCanvasElement,
    palette: BlockCrushDropPalette = 'classic-wood',
    runtimeAssets?: unknown,
  ) {
    this.canvas = canvas;
    this.palette = palette;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Unable to create Block 落消 reference canvas.');
    this.context = context;
    this.backgroundBinding =
      (runtimeAgentImageBindings(runtimeAssets)?.bySlot['world.background']?.[0] as
        | RuntimeImageAssetBinding
        | undefined) ?? null;
    this.boundLook = new BlockCrushDropBoundLook(runtimeAssets);
    const slots = runtimeAgentImageBindings(runtimeAssets)?.bySlot;
    this.unsupportedNativeMaterials = !!(
      slots?.['piece.face']?.length ||
      slots?.['piece.atlas']?.length ||
      slots?.['effect.fragment-surfaces']?.length
    );
    this.clearSequences = new BlockCrushDropClearSequences(runtimeAssets);
    this.tilePaletteBinding =
      (runtimeAgentImageBindings(runtimeAssets)?.bySlot['tile.palette']?.[0] as
        | RuntimeImageAssetBinding
        | undefined) ?? null;
    this.assetsReady = Promise.all([
      this.clearSequences.ready,
      this.boundLook.ready,
      ...DROP_UI_ATLAS_SLOTS.map(async (slot) => {
        const binding = runtimeAgentImageBindings(runtimeAssets)?.bySlot[slot]?.[0] as
          | RuntimeImageAssetBinding
          | undefined;
        if (!binding) return;
        const image = await loadRuntimeImage(binding);
        if (image) this.uiAtlases[slot] = { binding, image };
      }),
      loadRuntimeImage(this.backgroundBinding).then((image) => {
        this.backgroundImage = image;
      }),
      loadRuntimeImage(this.tilePaletteBinding).then((image) => {
        this.tilePaletteImage = image;
      }),
    ]).then(() => undefined);
    this.resize(BLOCK_CRUSH_DROP_STAGE.width, BLOCK_CRUSH_DROP_STAGE.height, 1);
  }

  async warmup(frame: BlockCrushDropPresentationFrame): Promise<void> {
    await this.assetsReady;
    if (
      frame.before.config.presentation.referenceCalibration?.tilePaletteColors &&
      !this.tilePaletteImage
    )
      throw new Error('DROP_TILE_PALETTE_IMAGE_REQUIRED');
    const colors = frame.before.config.presentation.referenceCalibration?.tilePaletteColors;
    const rows =
      frame.before.config.presentation.referenceCalibration?.tilePaletteLighting?.rows ?? 1;
    const faceHeight = (this.tilePaletteBinding?.height ?? 0) / rows;
    if (
      colors &&
      this.tilePaletteBinding &&
      (this.tilePaletteBinding.width !== faceHeight * colors.length ||
        !Number.isInteger(faceHeight))
    ) {
      throw new Error('DROP_TILE_PALETTE_MUST_BE_HORIZONTAL_SQUARE_FACES');
    }
    const crop = frame.before.config.presentation.referenceCalibration?.tilePaletteCropPixels;
    if (
      crop &&
      this.tilePaletteBinding &&
      (crop.top + crop.bottom >= faceHeight || crop.left + crop.right >= faceHeight)
    )
      throw new Error('DROP_TILE_PALETTE_CROP_EMPTY');
    const sprites = frame.before.config.presentation.referenceCalibration?.spriteCues;
    for (const cue of sprites ?? []) {
      const slot = cue.atlasSlot ?? 'ui.atlas',
        atlas = this.uiAtlases[slot];
      if (!atlas) throw new Error(`DROP_UI_ATLAS_IMAGE_REQUIRED: ${slot}`);
      if (!calibratedSpriteFits(cue, atlas.binding.width ?? 0, atlas.binding.height ?? 0))
        throw new Error(`DROP_UI_ATLAS_CROP_OUTSIDE_IMAGE: ${slot}/${cue.id}`);
    }
    const glyphs = frame.before.config.presentation.referenceCalibration?.encouragementGlyphCues;
    if (glyphs?.length) {
      this.encouragementGlyphLayer ??= new DropEncouragementGlyphLayer(this.canvas.ownerDocument);
      this.encouragementGlyphLayer.warmup(glyphs, this.uiAtlases);
    }
    this.renderAt(frame);
  }

  resize(width: number, height: number, pixelRatio = 1): void {
    this.canvas.width = Math.max(1, Math.round(width * pixelRatio));
    this.canvas.height = Math.max(1, Math.round(height * pixelRatio));
    if (this.frame) this.renderAt(this.frame);
  }

  renderAt(frame: BlockCrushDropPresentationFrame): void {
    if (frame.clearExposureSeconds && frame.physicsCueSchedule?.some((c) => !c.sequence))
      throw new Error('CRUSH_EXPOSURE_REQUIRES_TEXTURED_FIXED_CINEMATIC_RENDERER');
    this.frame = frame;
    const scale = Math.min(
      this.canvas.width / BLOCK_CRUSH_DROP_STAGE.width,
      this.canvas.height / BLOCK_CRUSH_DROP_STAGE.height,
    );
    const offsetX = (this.canvas.width - BLOCK_CRUSH_DROP_STAGE.width * scale) / 2;
    const offsetY = (this.canvas.height - BLOCK_CRUSH_DROP_STAGE.height * scale) / 2;
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.fillStyle =
      this.palette === 'moonlit-slate'
        ? '#101c32'
        : this.palette === 'honey-gold'
          ? '#12180f'
          : '#44200e';
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.setTransform(scale, 0, 0, scale, offsetX, offsetY);
    if (frame.before.config.presentation.referenceCalibration)
      drawCalibratedDropStage(this.context, frame, this.calibratedAssets(frame));
    else
      drawBlockCrushDropStage(this.context, frame, {
        ...this.boundLook.stageOptions(frame),
        palette: this.palette,
        ...(this.backgroundBinding && this.backgroundImage
          ? { backgroundBinding: this.backgroundBinding, backgroundImage: this.backgroundImage }
          : {}),
      });
    if (
      !frame.before.config.presentation.referenceCalibration &&
      frame.sequenceCueSchedule?.length
    ) {
      this.clearSequences.draw(this.context, frame);
      drawClearSequenceHeader(this.context, frame, {
        ...this.boundLook.stageOptions(frame),
        palette: this.palette,
      });
    }
    this.context.setTransform(1, 0, 0, 1, 0, 0);
  }

  captureNativeFrame(): HTMLCanvasElement {
    if (
      this.canvas.width === BLOCK_CRUSH_DROP_STAGE.width &&
      this.canvas.height === BLOCK_CRUSH_DROP_STAGE.height
    ) {
      return this.canvas;
    }
    const native = document.createElement('canvas');
    native.width = BLOCK_CRUSH_DROP_STAGE.width;
    native.height = BLOCK_CRUSH_DROP_STAGE.height;
    const context = native.getContext('2d', { alpha: false });
    if (!context || !this.frame) throw new Error('Block 落消 reference frame is unavailable.');
    if (this.frame.before.config.presentation.referenceCalibration)
      drawCalibratedDropStage(context, this.frame, this.calibratedAssets(this.frame));
    else
      drawBlockCrushDropStage(context, this.frame, {
        ...this.boundLook.stageOptions(this.frame),
        palette: this.palette,
        ...(this.backgroundBinding && this.backgroundImage
          ? { backgroundBinding: this.backgroundBinding, backgroundImage: this.backgroundImage }
          : {}),
      });
    if (
      !this.frame.before.config.presentation.referenceCalibration &&
      this.frame.sequenceCueSchedule?.length
    ) {
      this.clearSequences.draw(context, this.frame);
      drawClearSequenceHeader(context, this.frame, {
        ...this.boundLook.stageOptions(this.frame),
        palette: this.palette,
      });
    }
    return native;
  }

  private calibratedAssets(frame: BlockCrushDropPresentationFrame) {
    const native =
      frame.before.config.presentation.referenceCalibration?.clear?.nativeInertial === true;
    if (native && this.unsupportedNativeMaterials)
      throw new Error(
        'DROP_NATIVE_INERTIAL_BOUND_MATERIAL_UNSUPPORTED: piece.face, piece.atlas and effect.fragment-surfaces require a real UV consumer',
      );
    const depth = calibratedHasNativeDepthCue(frame);
    if (depth && !this.observedDepthLayer)
      this.observedDepthLayer = new ObservedFragmentDepthLayer(
        this.canvas.ownerDocument,
        native
          ? 'native-inertial'
          : frame.before.config.presentation.referenceCalibration!.clear!.fragmentGeometry ===
              'rounded-cube'
            ? 'rounded-cube'
            : 'pyramid-quarter',
      );
    const glyphs =
      !!frame.before.config.presentation.referenceCalibration?.encouragementGlyphCues?.length;
    if (glyphs && !this.encouragementGlyphLayer)
      this.encouragementGlyphLayer = new DropEncouragementGlyphLayer(this.canvas.ownerDocument);
    return {
      ...(depth ? { observedDepthLayer: this.observedDepthLayer! } : {}),
      ...(glyphs ? { encouragementGlyphs: this.encouragementGlyphLayer! } : {}),
      ...(frame.sequenceCueSchedule?.length ? { clearSequences: this.clearSequences } : {}),
      uiAtlases: this.uiAtlases,
      ...(this.backgroundBinding && this.backgroundImage
        ? { background: { binding: this.backgroundBinding, image: this.backgroundImage } }
        : {}),
      ...(this.tilePaletteBinding && this.tilePaletteImage
        ? { tilePalette: { binding: this.tilePaletteBinding, image: this.tilePaletteImage } }
        : {}),
    };
  }

  dispose(): void {
    this.observedDepthLayer?.dispose();
    this.observedDepthLayer = undefined;
    this.encouragementGlyphLayer?.dispose();
    this.encouragementGlyphLayer = undefined;
    this.clearSequences.dispose();
    this.frame = null;
  }
}
