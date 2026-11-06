import { clamp01, easeOutBack, roundedRect, colorWithAlpha } from './canvasPrimitives';
// Workbench-derived scene: the supplied reference remains frozen.
import { paintAuthoredTile } from './authoredTileLayer';
import { paintAuthoredBackground } from './authoredBackgroundLayer';
import { paintAuthoredRack, paintAuthoredPieces } from './authoredPiecesLayer';
import { paintPointer } from './pointerLayer';
import { paintAuthoredBoard } from './authoredBoardLayer';
import { AuthoredEffects } from './authoredEffects';
import { paintThumb } from './thumbLayer';
import type { BBTimelineFrame } from '../planning/bbTimelinePlan';
import { authoredBoard, authoredClearing } from './authoredFrameData';
import { ObservedLayers } from '@bb/observed-layers';
import type { ObservedLayerConfig } from '../planning/observedLayerConfig';
import {
  materialTheme,
  materialCellMetrics,
} from '../../../nativeReference/games/block-placement/render/materialThemes';
import { materialClearPalette } from '../../../nativeReference/games/block-placement/render/materialClearPalette';
import { TILE_COLORS } from '../../../nativeReference/games/block-placement/runtime/shapes';

import type {
  ClearingFrame,
  PraiseTierId,
  BoardState,
  StyleSpec,
  TileColor,
} from '../../../nativeReference/domain/types';
import {
  EMPTY_RUNTIME_ASSET_BINDINGS,
  type RuntimeAssetBindings,
  type RuntimeImageAssetBinding,
} from '../../../nativeReference/assets/runtimeAssetBindings';
import type { ReferencePassId } from '../../../nativeReference/headless/contracts';
import { REFERENCE_PASS_ORDER } from '../../../nativeReference/headless/contracts';
import { isPassEnabled, PRAISE_PASS } from '../../../nativeReference/reference2d/passes';

import { paintAuthoredHud } from './authoredHudLayer';
import { paintCandyBlastTile } from './authoredCandyTile';
import {
  BLAST_BACKGROUND,
  BLAST_FACE_PALETTE,
  BLAST_TILE_PALETTE,
  REFERENCE_CANVAS,
  REFERENCE_LAYOUT,
  REFERENCE_TILE_PALETTE,
  type ReferenceTilePalette,
} from '../../../nativeReference/reference2d/referenceProfile';

export interface BBScene2DOptions {
  quality?: 'interactive' | 'cinematic';
  alpha?: boolean;
  /** Optional appearance profile; the common frame and scene remain the same. */
  observed?: ObservedLayerConfig;
  solidBackground?: string | null;
}

interface SceneTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface RuntimeImages {
  background: HTMLImageElement | null;
  tileFace: HTMLImageElement | null;
  boardAtlas: HTMLImageElement | null;
}

export class BBScene2D {
  readonly canvas: HTMLCanvasElement;
  readonly rendererLabel = 'Canvas 2D · Reference-first';

  private readonly context: CanvasRenderingContext2D;
  private paintContext: CanvasRenderingContext2D | null = null;
  private readonly quality: 'interactive' | 'cinematic';
  private readonly observed: ObservedLayers | null;
  private readonly solidBackground: string | null;
  private board: BoardState | null = null;
  private clearing: ClearingFrame | null = null;
  private style: StyleSpec | null = null;
  private bbFrame: BBTimelineFrame | null = null;
  private transform: SceneTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  private runtimeAssets: RuntimeAssetBindings = EMPTY_RUNTIME_ASSET_BINDINGS;
  private runtimeImages: RuntimeImages = { background: null, tileFace: null, boardAtlas: null };
  private runtimeAssetFailures: string[] = [];
  private runtimeAssetsReady: Promise<void> = Promise.resolve();
  private enabledPasses: ReferencePassId[] = [...REFERENCE_PASS_ORDER];
  private disposed = false;

  private get ctx(): CanvasRenderingContext2D {
    return this.paintContext ?? this.context;
  }

  private pass(id: ReferencePassId): boolean {
    return isPassEnabled(this.enabledPasses, id);
  }

  private isBlastLook(): boolean {
    return this.style?.reference2d.tileMaterial === 'candy-blast';
  }

  private tilePalette(color: TileColor): ReferenceTilePalette {
    if (this.runtimeAssets.tileFace) {
      const material = materialClearPalette(this.style?.reference2d.materialTheme);
      if (material) return material;
    }
    return this.isBlastLook() ? BLAST_TILE_PALETTE[color] : REFERENCE_TILE_PALETTE[color];
  }

  constructor(canvas: HTMLCanvasElement, options: BBScene2DOptions = {}) {
    this.canvas = canvas;
    this.quality = options.quality ?? 'interactive';
    this.solidBackground = options.solidBackground ?? null;
    const context = canvas.getContext('2d', {
      alpha: options.alpha ?? Boolean(options.observed),
      desynchronized: this.quality === 'interactive',
    });
    if (!context) throw new Error('无法创建参考 2D Canvas。');
    this.context = context;
    this.observed = options.observed ? new ObservedLayers(canvas, context, options.observed) : null;
    this.resize(540, 960, 1);
  }

  resize(width: number, height: number, pixelRatio = 1): void {
    if (this.observed) {
      this.canvas.width = Math.round(width * pixelRatio);
      this.canvas.height = Math.round(height * pixelRatio);
      this.render();
      return;
    }
    const ratio = Math.max(0.5, Math.min(this.quality === 'cinematic' ? 3 : 2, pixelRatio));
    const targetWidth = Math.max(1, Math.round(width * ratio));
    const targetHeight = Math.max(1, Math.round(height * ratio));
    if (this.canvas.width !== targetWidth) this.canvas.width = targetWidth;
    if (this.canvas.height !== targetHeight) this.canvas.height = targetHeight;
    const scale = Math.min(
      targetWidth / REFERENCE_CANVAS.width,
      targetHeight / REFERENCE_CANVAS.height,
    );
    this.transform = {
      scale,
      offsetX: (targetWidth - REFERENCE_CANVAS.width * scale) / 2,
      offsetY: (targetHeight - REFERENCE_CANVAS.height * scale) / 2,
    };
    this.render();
  }

  dispose(): void {
    this.disposed = true;
    this.board = null;
    this.clearing = null;
    this.bbFrame = null;
    this.style = null;
    this.runtimeAssets = EMPTY_RUNTIME_ASSET_BINDINGS;
    this.runtimeImages = { background: null, tileFace: null, boardAtlas: null };
    this.runtimeAssetsReady = Promise.resolve();
  }

  async warmup(frame?: BBTimelineFrame, style?: StyleSpec): Promise<void> {
    if (this.observed) {
      await this.observed.warmup();
      if (frame) this.renderAt(frame);
      return;
    }
    if (!frame || !style) throw new Error('BB_SCENE_AUTHORED_INPUT_REQUIRED');
    this.bbFrame = frame;
    this.board = authoredBoard(frame);
    this.clearing = authoredClearing(frame);
    this.style = style;
    await this.runtimeAssetsReady;
    if (this.runtimeAssetFailures.length > 0 || this.runtimeAssets.missing.length > 0) {
      this.assertRuntimeAssetsReady();
    }
    if (document.fonts?.ready) await document.fonts.ready;
    this.renderAt(frame, style);
  }

  /**
   * Authoritative native-resolution capture. Requires decoded runtime assets
   * (background / tile face / board atlas). Missing resources throw instead of comparing
   * builtin fallback pixels.
   */
  captureReferenceFrame(): HTMLCanvasElement {
    return this.captureNativeFrame({ requireAssets: true });
  }

  /**
   * Non-authoritative overlay/preview capture. May paint builtin fallbacks when
   * uploaded images are missing. Do not use for Golden Diff or formal stills.
   */
  capturePreviewFrame(): HTMLCanvasElement {
    return this.captureNativeFrame({ requireAssets: false });
  }

  captureNativeFrame(
    options: {
      requireAssets?: boolean;
      enabledPasses?: ReferencePassId[];
    } = {},
  ): HTMLCanvasElement {
    if (this.observed) throw new Error('BB_SCENE_CAPTURE_OBSERVED_UNSUPPORTED');
    if (!this.bbFrame || !this.style) throw new Error('没有可捕获的冻结帧。');
    if (options.requireAssets !== false) this.assertRuntimeAssetsReady();
    const output = document.createElement('canvas');
    output.width = REFERENCE_CANVAS.width;
    output.height = REFERENCE_CANVAS.height;
    const context = output.getContext('2d', { alpha: false });
    if (!context) throw new Error('无法创建原生设计分辨率 Canvas。');
    const previousContext = this.paintContext;
    const previousTransform = this.transform;
    const previousPasses = this.enabledPasses;
    this.paintContext = context;
    this.transform = { scale: 1, offsetX: 0, offsetY: 0 };
    if (options.enabledPasses) this.enabledPasses = [...options.enabledPasses];
    try {
      this.draw(this.bbFrame.timeSeconds, this.clearing);
    } finally {
      this.paintContext = previousContext;
      this.transform = previousTransform;
      this.enabledPasses = previousPasses;
    }
    return output;
  }

  setEnabledPasses(passes: readonly ReferencePassId[] | undefined): void {
    this.enabledPasses = passes && passes.length > 0 ? [...passes] : [...REFERENCE_PASS_ORDER];
    this.render();
  }

  private assertRuntimeAssetsReady(): void {
    if (this.runtimeAssets.missing.length > 0) {
      throw new Error(
        `运行资源缺失：${this.runtimeAssets.missing.map((item) => item.uri).join(', ')}`,
      );
    }
    if (this.runtimeAssetFailures.length > 0) {
      throw new Error(`运行资源解码失败：${this.runtimeAssetFailures.join(', ')}`);
    }
    if (this.runtimeAssets.background && !this.runtimeImages.background) {
      throw new Error('背景资源尚未就绪，正式捕获已拒绝静默回退。');
    }
    if (this.runtimeAssets.tileFace && !this.runtimeImages.tileFace) {
      throw new Error('牌面资源尚未就绪，正式捕获已拒绝静默回退。');
    }
    if (this.runtimeAssets.boardAtlas && !this.runtimeImages.boardAtlas) {
      throw new Error('盘面切图资源尚未就绪，正式捕获已拒绝静默回退。');
    }
  }

  setRuntimeAssets(bindings: RuntimeAssetBindings): void {
    if (bindings.revision === this.runtimeAssets.revision) return;
    this.runtimeAssets = bindings;
    const revision = bindings.revision;
    const failures: string[] = [];
    const load = async (
      binding: RuntimeImageAssetBinding | null,
    ): Promise<HTMLImageElement | null> => {
      if (!binding) return null;
      return new Promise<HTMLImageElement | null>((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => {
          failures.push(binding.contentHash);
          reject(new Error(`资源解码失败：${binding.fileName}`));
        };
        image.src = binding.objectUrl;
      }).catch(() => null);
    };
    this.runtimeAssetsReady = Promise.all([
      load(bindings.background),
      load(bindings.tileFace),
      load(bindings.boardAtlas),
    ]).then(([background, tileFace, boardAtlas]) => {
      if (this.runtimeAssets.revision !== revision) return;
      this.runtimeAssetFailures = failures;
      this.runtimeImages = { background, tileFace, boardAtlas };
      this.render();
    });
  }

  renderAt(frame: BBTimelineFrame, style?: StyleSpec): void {
    this.bbFrame = frame;
    if (this.observed) {
      this.draw(frame.timeSeconds, null);
      return;
    }
    if (!style) throw new Error('BB_SCENE_AUTHORED_STYLE_REQUIRED');
    this.board = authoredBoard(frame);
    this.clearing = authoredClearing(frame);
    this.style = style;
    if (style.enabledPasses) this.enabledPasses = [...style.enabledPasses];
    this.draw(frame.timeSeconds, this.clearing);
  }

  private render(): void {
    if (!this.bbFrame || this.disposed || (!this.observed && (!this.board || !this.style))) return;
    this.draw(this.bbFrame.timeSeconds, this.clearing);
  }

  /** One frame orchestration for both appearances; individual material layers differ. */
  private draw(seconds: number, clearing: ClearingFrame | null): void {
    const frame = this.bbFrame,
      style = this.style,
      board = this.board,
      observed = this.observed,
      context = this.ctx;
    if (!frame || (!observed && (!style || !board))) return;
    const observedLook = observed?.begin(frame) ?? null;
    if (!observed) {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, context.canvas.width, context.canvas.height);
      context.fillStyle = this.isBlastLook() ? BLAST_BACKGROUND.top : '#0b7d67';
      context.fillRect(0, 0, context.canvas.width, context.canvas.height);
      context.setTransform(
        this.transform.scale,
        0,
        0,
        this.transform.scale,
        this.transform.offsetX,
        this.transform.offsetY,
      );
      if (this.isBlastLook() && frame.cameraPunch > 0) {
        const punch = frame.cameraPunch;
        context.translate(
          Math.sin(seconds * 94 + punch * 9) * punch * 10,
          Math.cos(seconds * 81) * punch * 7,
        );
      }
      if (clearing && this.isBlastLook()) {
        const impact = Math.max(0, 1 - clamp01(clearing.progress) / 0.16);
        if (impact > 0) {
          const seed = clearing.seed;
          context.translate(
            Math.sin(seed * 12.9898 + seconds * 151) * impact * impact * 6,
            Math.cos(seed * 78.233 + seconds * 173) * impact * impact * 5,
          );
        }
      }
      if (style && this.pass('background')) {
        context.save();
        paintAuthoredBackground(
          context,
          style,
          this.runtimeAssets,
          this.runtimeImages.background,
          frame.visualState.seed,
          seconds,
          this.solidBackground,
        );
        context.restore();
      }
    }
    if (observed && observedLook) observed.hud(frame, observedLook.early, observedLook.bg);
    else if (style && this.pass('feedback')) {
      context.save();
      paintAuthoredHud(context, style, frame.hud.score, clearing);
      context.restore();
    }
    if (observed && observedLook)
      observed.boardLayer(frame, observedLook.early, observedLook.sourceTime);
    else if (style && board && (this.pass('board') || this.pass('tile'))) {
      context.save();
      paintAuthoredBoard(
        context,
        style,
        board,
        frame,
        clearing,
        seconds,
        (id) => this.pass(id),
        (row, col, color, alpha, scale) => this.drawBoardTile(row, col, color, alpha, scale),
      );
      context.restore();
    }
    if (!observed && this.pass('placement')) {
      context.save();
      this.drawPlacementFeedback();
      context.restore();
    }
    // The observed appearance places its dragged piece below the tray layer.
    if (observed && observedLook) observed.pieces(frame, observedLook.sourceTime);
    if (observed && observedLook) observed.rack(frame, observedLook.sourceTime);
    else if (this.pass('tray')) {
      context.save();
      paintAuthoredRack(frame, (x, y, size, color, alpha, scale, motif) =>
        this.drawTile(x, y, size, color, alpha, scale, motif),
      );
      context.restore();
    }
    if (!observed && style && this.pass('interaction')) {
      context.save();
      paintAuthoredPieces(
        style,
        frame,
        (x, y, size, color, alpha, scale, motif) =>
          this.drawTile(x, y, size, color, alpha, scale, motif),
        (row, col, color, alpha) => this.drawPreviewCell(row, col, color, alpha),
      );
      context.restore();
    }
    if (observed && observedLook) observed.clear(frame, observedLook.sourceTime);
    else if (style && clearing) {
      const effects = new AuthoredEffects(
        context,
        style,
        frame,
        (color) => this.tilePalette(color),
        (x, y, size, color, alpha, scale, motif) =>
          this.drawTile(x, y, size, color, alpha, scale, motif),
      );
      if (this.pass('clear')) {
        context.save();
        effects.drawClearFx(clearing, seconds);
        context.restore();
      }
      if (this.pass(PRAISE_PASS) && style.reference2d.feedbackFx === 'praise-combo') {
        context.save();
        effects.drawPraise(clearing, seconds);
        context.restore();
      }
    }
    if (observed && observedLook) observed.overlays(frame, observedLook.sourceTime);
    if (!observed && this.pass('interaction')) {
      context.save();
      this.drawPointer();
      context.restore();
    }
    if (!observed && frame.visualState.status === 'game-over' && this.pass('endgame')) {
      context.save();
      this.drawContinueModal();
      context.restore();
    }
    if (observed) observed.finish(frame);
    else context.restore();
  }

  private drawBoardTile(row: number, col: number, color: TileColor, alpha = 1, scale = 1): void {
    const grid = REFERENCE_LAYOUT.board.grid;
    const x = grid.x + col * grid.pitch + grid.cell / 2;
    const y = grid.y + row * grid.pitch + grid.cell / 2;
    this.drawTile(
      x,
      y,
      materialCellMetrics(this.style?.reference2d.cellGapPx).boardSize,
      color,
      alpha,
      scale,
      true,
      { row, col },
    );
  }

  private drawTile(
    centerX: number,
    centerY: number,
    size: number,
    color: TileColor,
    alpha: number,
    scale: number,
    motif: boolean,
    atlasCell?: { row: number; col: number },
  ): void {
    if (!this.style || alpha <= 0) return;
    paintAuthoredTile(
      this.ctx,
      this.style,
      this.tilePalette(color),
      this.runtimeAssets,
      this.runtimeImages,
      this.board,
      centerX,
      centerY,
      size,
      color,
      alpha,
      scale,
      motif,
      atlasCell,
    );
  }

  private drawPlacementFeedback(): void {
    const placement = this.bbFrame?.placement;
    const feedback = placement
      ? {
          cells: placement.cells.map((cell) => {
            if (!(TILE_COLORS as readonly string[]).includes(cell.logicalColor))
              throw new Error(`BB_SCENE_PLACEMENT_COLOR_UNSUPPORTED:${cell.logicalColor}`);
            return { row: cell.row, col: cell.col, color: cell.logicalColor as TileColor };
          }),
          progress: placement.progress ?? 0,
          placementPoints: placement.placementPoints,
        }
      : null;
    if (!feedback || feedback.cells.length === 0 || feedback.progress <= 0) return;
    const context = this.ctx;
    const grid = REFERENCE_LAYOUT.board.grid;
    const overallFade = 1 - clamp01((feedback.progress - 0.72) / 0.28);

    for (const [index, cell] of feedback.cells.entries()) {
      const stagger = (index / Math.max(1, feedback.cells.length)) * 0.32;
      const local = clamp01((feedback.progress - stagger) / 0.42);
      if (local <= 0) continue;
      const pulse = Math.sin(Math.min(1, local) * Math.PI);
      const centerX = grid.x + cell.col * grid.pitch + grid.cell / 2;
      const centerY = grid.y + cell.row * grid.pitch + grid.cell / 2;
      const palette = this.tilePalette(cell.color);

      context.save();
      context.globalAlpha = overallFade * (0.35 + pulse * 0.65);
      context.strokeStyle = '#fff9b0';
      context.lineWidth = 4 + pulse * 3;
      context.shadowColor = palette.glow;
      context.shadowBlur = 10 + pulse * 24;
      roundedRect(
        context,
        centerX - grid.cell / 2 + 3,
        centerY - grid.cell / 2 + 3,
        grid.cell - 6,
        grid.cell - 6,
        8,
      );
      context.stroke();
      context.restore();

      if (this.style?.reference2d.feedbackFx === 'praise-combo' && local > 0.18) {
        const iconIn = easeOutBack(clamp01((local - 0.18) / 0.42));
        context.save();
        context.globalAlpha = overallFade * clamp01((local - 0.12) / 0.3);
        context.translate(centerX, centerY - 4 - pulse * 5);
        paintThumb(context, 0, 0, 0.42 * iconIn);
        context.restore();
      }
    }
  }

  private drawPreviewCell(row: number, col: number, color: TileColor, alpha: number): void {
    const grid = REFERENCE_LAYOUT.board.grid;
    const x = grid.x + col * grid.pitch;
    const y = grid.y + row * grid.pitch;
    const palette = this.tilePalette(color);
    const context = this.ctx;
    if (this.runtimeAssets.tileFace && this.runtimeImages.tileFace) {
      // A material stamp must never turn into a violet/native candy tile on hover.
      this.drawTile(
        x + grid.cell / 2,
        y + grid.cell / 2,
        materialCellMetrics(this.style?.reference2d.cellGapPx).boardSize,
        color,
        alpha,
        1,
        true,
        { row, col },
      );
      context.save();
      context.strokeStyle = colorWithAlpha(palette.glow, alpha);
      context.lineWidth = 3;
      roundedRect(context, x + 2, y + 2, grid.cell - 4, grid.cell - 4, 5);
      context.stroke();
      context.restore();
      return;
    }
    context.save();
    context.globalAlpha = clamp01(alpha);
    if (this.isBlastLook()) {
      paintCandyBlastTile(context, x + 2, y + 2, grid.cell - 4, BLAST_FACE_PALETTE[color]);
    } else {
      roundedRect(context, x + 2, y + 2, grid.cell - 4, grid.cell - 4, 8);
      context.fillStyle = palette.base;
      context.fill();
      context.strokeStyle = colorWithAlpha('#ffffff', 0.65);
      context.lineWidth = 3;
      context.stroke();
    }
    context.restore();
  }

  private drawPointer(): void {
    const pointer = this.bbFrame?.pointer;
    if (!pointer || !this.style?.showPointer) return;
    if ('space' in pointer && pointer.space !== 'normalized')
      throw new Error('BB_SCENE_POINTER_SPACE_UNSUPPORTED');
    paintPointer(
      this.ctx,
      { x: pointer.x * REFERENCE_CANVAS.width, y: pointer.y * REFERENCE_CANVAS.height },
      { kind: 'authored', pressed: pointer.pressed },
    );
  }

  private drawContinueModal(): void {
    if (!this.bbFrame) return;
    const context = this.ctx;
    context.save();
    context.fillStyle = 'rgba(4,31,26,0.72)';
    context.fillRect(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = 'italic 900 76px "Arial Rounded MT Bold", sans-serif';
    context.lineWidth = 12;
    context.strokeStyle = '#263d8b';
    const title =
      this.bbFrame.visualState.combo > 0 ? `Combo ${this.bbFrame.visualState.combo}` : 'Game Over';
    context.strokeText(title, 532, 522);
    context.fillStyle = '#ffffff';
    context.fillText(title, 532, 522);

    const cardX = 212;
    const cardY = 603;
    const cardW = 640;
    const cardH = 560;
    const gradient = context.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    gradient.addColorStop(0, '#e5f06c');
    gradient.addColorStop(0.5, '#ffb36e');
    gradient.addColorStop(1, '#f7eb6f');
    roundedRect(context, cardX, cardY, cardW, cardH, 23);
    context.fillStyle = gradient;
    context.shadowColor = 'rgba(0,35,28,0.45)';
    context.shadowBlur = 22;
    context.shadowOffsetY = 10;
    context.fill();
    context.shadowColor = 'transparent';
    context.fillStyle = '#ffffff';
    context.font = '700 31px "Trebuchet MS", sans-serif';
    context.fillText('Continue with 3 small blocks', 532, 657);

    roundedRect(context, cardX + 70, cardY + 95, cardW - 140, 230, 16);
    context.fillStyle = 'rgba(146,65,70,0.25)';
    context.fill();
    for (const cx of [380, 532, 684]) {
      for (let i = 0; i < (cx === 532 ? 4 : 1); i += 1) {
        const px = cx + (i - (cx === 532 ? 1.5 : 0)) * 29;
        const miniGradient = context.createLinearGradient(px, 0, px + 24, 0);
        miniGradient.addColorStop(0, '#55d85a');
        miniGradient.addColorStop(0.5, '#ffca3a');
        miniGradient.addColorStop(1, '#58a7ef');
        roundedRect(context, px - 12, cardY + 205, 24, 24, 4);
        context.fillStyle = miniGradient;
        context.fill();
      }
    }

    roundedRect(context, cardX + 92, cardY + 365, cardW - 184, 104, 12);
    const button = context.createLinearGradient(0, cardY + 365, 0, cardY + 469);
    button.addColorStop(0, '#39e427');
    button.addColorStop(1, '#16b91c');
    context.fillStyle = button;
    context.fill();
    context.fillStyle = '#ffffff';
    context.font = '800 45px "Arial Rounded MT Bold", sans-serif';
    context.fillText('▣   Sure', 532, cardY + 418);
    context.font = '600 24px "Trebuchet MS", sans-serif';
    context.fillText('No, thanks', 532, cardY + 520);
    context.restore();
  }
}
