import { cloneBoard } from '../domain/boardPresets';
import {
  canPlace,
  detectClear,
  pieceCellColor,
  pieceCells,
} from '../domain/gameEngine';
import { hash32, seededFloat } from '../domain/rng';
import { getShape, getShapeBounds } from '../domain/shapes';
import type {
  ClearingFrame,
  ClearResult,
  GameSnapshot,
  GridCell,
  PieceInstance,
  PraiseTierId,
  PresentationFrame,
  StyleSpec,
  TileColor,
} from '../domain/types';
import {
  EMPTY_RUNTIME_ASSET_BINDINGS,
  type RuntimeAssetBindings,
  type RuntimeImageAssetBinding,
} from '../assets/runtimeAssetBindings';
import type { ReferencePassId } from '../headless/contracts';
import { REFERENCE_PASS_ORDER } from '../headless/contracts';
import { isPassEnabled, PRAISE_PASS } from './passes';
import {
  REFERENCE_BACKGROUND,
  REFERENCE_BOARD_COLORS,
  REFERENCE_CANVAS,
  REFERENCE_LAYOUT,
  REFERENCE_TILE_PALETTE,
} from './referenceProfile';

export interface Reference2DSceneOptions {
  quality?: 'interactive' | 'cinematic';
  alpha?: boolean;
}

export type Reference2DPickResult =
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'piece'; pieceId: string }
  | null;

interface LiveClear {
  clearing: ClearingFrame;
  startedAt: number;
  durationMs: number;
}

interface DragPreview {
  pieceId: string;
  anchor: GridCell | null;
  pointer: { x: number; y: number } | null;
}

interface SceneTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface RuntimeImages {
  background: HTMLImageElement | null;
  tileFace: HTMLImageElement | null;
}

const TWO_PI = Math.PI * 2;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  const t = clamp01(value);
  return 1 - (1 - t) ** 3;
}

function easeOutBack(value: number): number {
  const t = clamp01(value);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function colorWithAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red},${green},${blue},${clamp01(alpha)})`;
}

function drawImageFitted(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  x: number,
  y: number,
  width: number,
  height: number,
  fit: RuntimeImageAssetBinding['fit'],
): void {
  const sourceWidth = Math.max(1, image.width);
  const sourceHeight = Math.max(1, image.height);
  if (fit === 'stretch') {
    context.drawImage(image, x, y, width, height);
    return;
  }
  const scale = fit === 'contain'
    ? Math.min(width / sourceWidth, height / sourceHeight)
    : Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function makeLiveFrame(snapshot: GameSnapshot): PresentationFrame {
  return {
    frame: 0,
    fps: 60,
    snapshot,
    board: cloneBoard(snapshot.board),
    cameraPunch: 0,
  };
}

function previewFor(
  snapshot: GameSnapshot,
  piece: PieceInstance,
  anchor: GridCell,
): { cells: GridCell[]; clear: ClearResult } | null {
  if (!canPlace(snapshot.board, piece, anchor)) return null;
  const board = cloneBoard(snapshot.board);
  const cells = pieceCells(piece, anchor);
  cells.forEach(({ row, col }, index) => {
    const target = board.cells[row];
    if (target) target[col] = pieceCellColor(piece, index);
  });
  return { cells, clear: detectClear(board) };
}

export class Reference2DScene {
  readonly canvas: HTMLCanvasElement;
  readonly rendererLabel = 'Canvas 2D · Reference-first';

  private readonly context: CanvasRenderingContext2D;
  private paintContext: CanvasRenderingContext2D | null = null;
  private readonly quality: 'interactive' | 'cinematic';
  private frame: PresentationFrame | null = null;
  private style: StyleSpec | null = null;
  private dragPreview: DragPreview | null = null;
  private liveClear: LiveClear | null = null;
  private transform: SceneTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  private runtimeAssets: RuntimeAssetBindings = EMPTY_RUNTIME_ASSET_BINDINGS;
  private runtimeImages: RuntimeImages = { background: null, tileFace: null };
  private runtimeAssetFailures: string[] = [];
  private runtimeAssetsReady: Promise<void> = Promise.resolve();
  private enabledPasses: ReferencePassId[] = [...REFERENCE_PASS_ORDER];
  private useLiveClock = true;
  private started = false;
  private disposed = false;
  private raf = 0;
  private clockMs = 0;

  private get ctx(): CanvasRenderingContext2D {
    return this.paintContext ?? this.context;
  }

  private pass(id: ReferencePassId): boolean {
    return isPassEnabled(this.enabledPasses, id);
  }

  constructor(canvas: HTMLCanvasElement, options: Reference2DSceneOptions = {}) {
    this.canvas = canvas;
    this.quality = options.quality ?? 'interactive';
    const context = canvas.getContext('2d', {
      alpha: options.alpha ?? false,
      desynchronized: this.quality === 'interactive',
    });
    if (!context) throw new Error('无法创建参考 2D Canvas。');
    this.context = context;
    this.resize(540, 960, 1);
  }

  resize(width: number, height: number, pixelRatio = 1): void {
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
    this.render(this.clockMs);
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const tick = (time: number): void => {
      if (!this.started || this.disposed) return;
      this.clockMs = time;
      this.render(time);
      this.raf = window.requestAnimationFrame(tick);
    };
    this.raf = window.requestAnimationFrame(tick);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    window.cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.frame = null;
    this.style = null;
    this.dragPreview = null;
    this.liveClear = null;
    this.runtimeAssets = EMPTY_RUNTIME_ASSET_BINDINGS;
    this.runtimeImages = { background: null, tileFace: null };
    this.runtimeAssetsReady = Promise.resolve();
  }

  async warmup(frame: PresentationFrame, style: StyleSpec): Promise<void> {
    this.setFrame(frame, style);
    await this.runtimeAssetsReady;
    if (this.runtimeAssetFailures.length > 0 || this.runtimeAssets.missing.length > 0) {
      this.assertRuntimeAssetsReady();
    }
    if (document.fonts?.ready) await document.fonts.ready;
    this.renderAt(frame, style);
  }

  /**
   * Authoritative native-resolution capture. Requires decoded runtime assets
   * (background / tile face). Missing resources throw instead of comparing
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

  captureNativeFrame(options: {
    requireAssets?: boolean;
    enabledPasses?: ReferencePassId[];
  } = {}): HTMLCanvasElement {
    if (!this.frame || !this.style) throw new Error('没有可捕获的冻结帧。');
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
      this.draw(this.frame.frame / Math.max(1, this.frame.fps), this.frame.clearing ?? null);
    } finally {
      this.paintContext = previousContext;
      this.transform = previousTransform;
      this.enabledPasses = previousPasses;
    }
    return output;
  }

  setEnabledPasses(passes: readonly ReferencePassId[] | undefined): void {
    this.enabledPasses = passes && passes.length > 0 ? [...passes] : [...REFERENCE_PASS_ORDER];
    this.render(this.clockMs);
  }

  private assertRuntimeAssetsReady(): void {
    if (this.runtimeAssets.missing.length > 0) {
      throw new Error(`运行资源缺失：${this.runtimeAssets.missing.map((item) => item.uri).join(', ')}`);
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
    ]).then(([background, tileFace]) => {
      if (this.runtimeAssets.revision !== revision) return;
      this.runtimeAssetFailures = failures;
      this.runtimeImages = { background, tileFace };
      this.render(this.clockMs);
    });
  }

  setFrame(frame: PresentationFrame, style: StyleSpec): void {
    this.frame = frame;
    this.style = style;
    this.dragPreview = null;
    this.useLiveClock = false;
    if (style.enabledPasses) this.enabledPasses = [...style.enabledPasses];
    this.render(this.clockMs);
  }

  setLiveSnapshot(snapshot: GameSnapshot, style: StyleSpec): void {
    this.frame = makeLiveFrame(snapshot);
    this.style = style;
    this.useLiveClock = true;
    if (style.enabledPasses) this.enabledPasses = [...style.enabledPasses];
    this.render(this.clockMs);
  }

  renderAt(frame: PresentationFrame, style: StyleSpec): void {
    this.frame = frame;
    this.style = style;
    this.dragPreview = null;
    this.useLiveClock = false;
    if (style.enabledPasses) this.enabledPasses = [...style.enabledPasses];
    this.draw(frame.frame / Math.max(1, frame.fps), frame.clearing ?? null);
  }

  triggerClear(clearing: ClearingFrame): void {
    this.liveClear = {
      clearing,
      startedAt: performance.now(),
      durationMs: this.quality === 'cinematic' ? 780 : 660,
    };
  }

  setDragPreview(
    pieceId: string | null,
    anchor: GridCell | null,
    pointer?: { x: number; y: number },
  ): void {
    this.dragPreview = pieceId
      ? { pieceId, anchor, pointer: pointer ? { ...pointer } : null }
      : null;
    this.render(this.clockMs);
  }

  pick(clientX: number, clientY: number): Reference2DPickResult {
    const point = this.clientToReference(clientX, clientY);
    if (!point || !this.frame) return null;
    const { grid } = REFERENCE_LAYOUT.board;
    const gridSize = grid.pitch * 8 - grid.gap;
    if (
      point.x >= grid.x && point.x <= grid.x + gridSize &&
      point.y >= grid.y && point.y <= grid.y + gridSize
    ) {
      const col = Math.floor((point.x - grid.x) / grid.pitch);
      const row = Math.floor((point.y - grid.y) / grid.pitch);
      const localX = (point.x - grid.x) % grid.pitch;
      const localY = (point.y - grid.y) % grid.pitch;
      if (row >= 0 && row < 8 && col >= 0 && col < 8 && localX <= grid.cell && localY <= grid.cell) {
        return { kind: 'cell', row, col };
      }
    }

    for (const piece of this.frame.snapshot.pieces) {
      if (piece.used || piece.id === this.frame.hiddenPieceId) continue;
      const shape = getShape(piece.shapeId);
      const bounds = getShapeBounds(shape);
      const centerX = REFERENCE_LAYOUT.rack.centersX[piece.slotIndex] ?? REFERENCE_CANVAS.width / 2;
      const centerY = REFERENCE_LAYOUT.rack.centerY;
      const width = bounds.cols * REFERENCE_LAYOUT.rack.cell;
      const height = bounds.rows * REFERENCE_LAYOUT.rack.cell;
      const padding = 28;
      if (
        point.x >= centerX - width / 2 - padding && point.x <= centerX + width / 2 + padding &&
        point.y >= centerY - height / 2 - padding && point.y <= centerY + height / 2 + padding
      ) {
        return { kind: 'piece', pieceId: piece.id };
      }
    }
    return null;
  }

  anchorForPiece(clientX: number, clientY: number, pieceId: string): GridCell | null {
    const point = this.clientToReference(clientX, clientY);
    const piece = this.frame?.snapshot.pieces.find((candidate) => candidate.id === pieceId);
    if (!point || !piece) return null;
    const bounds = getShapeBounds(getShape(piece.shapeId));
    const liftedCenterY = point.y - REFERENCE_LAYOUT.rack.pickupLift;
    const topLeftX = point.x - (bounds.cols * REFERENCE_LAYOUT.board.grid.pitch) / 2;
    const topLeftY = liftedCenterY - (bounds.rows * REFERENCE_LAYOUT.board.grid.pitch) / 2;
    const col = Math.round((topLeftX - REFERENCE_LAYOUT.board.grid.x) / REFERENCE_LAYOUT.board.grid.pitch);
    const row = Math.round((topLeftY - REFERENCE_LAYOUT.board.grid.y) / REFERENCE_LAYOUT.board.grid.pitch);
    if (row < 0 || col < 0 || row + bounds.rows > 8 || col + bounds.cols > 8) return null;
    return { row, col };
  }

  private clientToReference(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const px = ((clientX - rect.left) / rect.width) * this.canvas.width;
    const py = ((clientY - rect.top) / rect.height) * this.canvas.height;
    return {
      x: (px - this.transform.offsetX) / this.transform.scale,
      y: (py - this.transform.offsetY) / this.transform.scale,
    };
  }

  private render(timeMs: number): void {
    if (!this.frame || !this.style || this.disposed) return;
    const live = this.liveClear;
    let clearing = this.frame.clearing ?? null;
    if (live) {
      const progress = clamp01((timeMs - live.startedAt) / live.durationMs);
      clearing = { ...live.clearing, progress };
      if (progress >= 1) this.liveClear = null;
    }
    const seconds = this.useLiveClock
      ? timeMs / 1_000
      : this.frame.frame / Math.max(1, this.frame.fps);
    this.draw(seconds, clearing);
  }

  private draw(seconds: number, clearing: ClearingFrame | null): void {
    if (!this.frame || !this.style) return;
    const context = this.ctx;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.fillStyle = '#0b7d67';
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    context.setTransform(
      this.transform.scale,
      0,
      0,
      this.transform.scale,
      this.transform.offsetX,
      this.transform.offsetY,
    );

    if (this.pass('background')) {
      context.save();
      this.drawBackground(seconds);
      context.restore();
    }
    if (this.pass('feedback')) {
      context.save();
      this.drawHud(clearing);
      context.restore();
    }
    if (this.pass('board') || this.pass('tile')) {
      context.save();
      this.drawBoard(clearing);
      context.restore();
    }
    if (this.pass('placement')) {
      context.save();
      this.drawPlacementFeedback();
      context.restore();
    }
    if (this.pass('tray')) {
      context.save();
      this.drawRack();
      context.restore();
    }
    if (this.pass('interaction')) {
      context.save();
      this.drawDragAndPreview();
      context.restore();
    }
    if (clearing && this.pass('clear')) {
      context.save();
      this.drawClearFx(clearing, seconds);
      context.restore();
    }
    if (clearing && this.pass(PRAISE_PASS) && this.style?.reference2d.feedbackFx === 'praise-combo') {
      context.save();
      this.drawPraise(clearing);
      context.restore();
    }
    if (this.pass('interaction')) {
      context.save();
      this.drawPointer();
      context.restore();
    }
    if (this.frame.snapshot.status === 'game-over' && this.pass('endgame')) {
      context.save();
      this.drawContinueModal();
      context.restore();
    }
    context.restore();
  }

  private drawBackground(seconds: number): void {
    if (!this.style) return;
    const context = this.ctx;
    const backgroundBinding = this.runtimeAssets.background;
    const backgroundImage = this.runtimeImages.background;
    if (backgroundBinding && backgroundImage) {
      context.save();
      context.globalAlpha = backgroundBinding.opacity;
      context.globalCompositeOperation = backgroundBinding.blendMode;
      drawImageFitted(
        context,
        backgroundImage,
        0,
        0,
        REFERENCE_CANVAS.width,
        REFERENCE_CANVAS.height,
        backgroundBinding.fit,
      );
      context.restore();

      // Keep a restrained grade over uploaded art so HUD and board contrast
      // remain stable across arbitrary Agent- or designer-authored images.
      const grade = context.createLinearGradient(0, 0, 0, REFERENCE_CANVAS.height);
      grade.addColorStop(0, 'rgba(0,40,48,0.08)');
      grade.addColorStop(0.58, 'rgba(8,72,58,0.06)');
      grade.addColorStop(1, 'rgba(2,32,34,0.22)');
      context.fillStyle = grade;
      context.fillRect(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);
    } else {
      const gradient = context.createLinearGradient(0, 0, 0, REFERENCE_CANVAS.height);
      gradient.addColorStop(0, REFERENCE_BACKGROUND.top);
      gradient.addColorStop(0.48, REFERENCE_BACKGROUND.middle);
      gradient.addColorStop(1, REFERENCE_BACKGROUND.bottom);
      context.fillStyle = gradient;
      context.fillRect(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);
    }

    const halo = context.createRadialGradient(532, 730, 0, 532, 730, 760);
    halo.addColorStop(0, REFERENCE_BACKGROUND.halo);
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = halo;
    context.fillRect(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);

    if (this.style.reference2d.ambientFx === 'none') return;
    const seed = this.frame?.snapshot.seed ?? 0;
    for (let index = 0; index < 22; index += 1) {
      const baseX = seededFloat(hash32(seed + index * 17), index + 3) * REFERENCE_CANVAS.width;
      const baseY = 260 + seededFloat(hash32(seed + index * 29), index + 11) * 1420;
      const drift = Math.sin(seconds * (0.35 + (index % 5) * 0.06) + index) * (10 + (index % 4) * 5);
      const alpha = 0.08 + 0.12 * (0.5 + 0.5 * Math.sin(seconds * 0.9 + index));
      context.save();
      context.translate(baseX + drift, baseY);
      context.rotate(seconds * 0.09 + index);
      context.fillStyle = index % 3 === 0
        ? `rgba(255,235,117,${alpha})`
        : index % 3 === 1
          ? `rgba(255,113,151,${alpha})`
          : `rgba(94,228,219,${alpha})`;
      const size = 2 + (index % 4);
      context.fillRect(-size / 2, -size / 2, size, size);
      context.restore();
    }
    this.drawAmbientFlower(862, 1445, seconds);
  }

  private drawAmbientFlower(x: number, y: number, seconds: number): void {
    const context = this.ctx;
    const pulse = 0.82 + Math.sin(seconds * 1.35) * 0.12;
    context.save();
    context.translate(x, y);
    context.scale(pulse, pulse);
    context.globalAlpha = 0.18;
    context.shadowColor = '#fff47c';
    context.shadowBlur = 22;
    for (let index = 0; index < 5; index += 1) {
      context.save();
      context.rotate((index / 5) * TWO_PI);
      context.fillStyle = index % 2 === 0 ? '#ff77a8' : '#7be8c9';
      context.beginPath();
      context.ellipse(0, -27, 12, 25, 0, 0, TWO_PI);
      context.fill();
      context.restore();
    }
    context.fillStyle = '#fff16a';
    context.beginPath();
    context.arc(0, 0, 8, 0, TWO_PI);
    context.fill();
    context.restore();
  }

  private drawHud(clearing: ClearingFrame | null): void {
    if (!this.frame || !this.style) return;
    const context = this.ctx;
    const best = Math.max(this.style.reference2d.bestScore, this.frame.snapshot.score);
    this.drawCrown(118, 86, 1);
    context.save();
    context.font = '800 54px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.lineWidth = 5;
    context.strokeStyle = 'rgba(145,91,24,0.25)';
    context.strokeText(String(best), 181, 91);
    context.fillStyle = '#ffb434';
    context.shadowColor = 'rgba(113,84,24,0.35)';
    context.shadowBlur = 6;
    context.shadowOffsetY = 4;
    context.fillText(String(best), 181, 91);
    context.restore();

    const scorePulse = clearing ? 1 + Math.sin(clamp01(clearing.progress) * Math.PI) * 0.035 : 1;
    context.save();
    context.translate(REFERENCE_LAYOUT.hud.scoreCenter.x, REFERENCE_LAYOUT.hud.scoreCenter.y);
    context.scale(scorePulse, scorePulse);
    context.font = '900 102px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 6;
    context.strokeStyle = 'rgba(47,89,61,0.23)';
    context.strokeText(String(this.frame.snapshot.score), 0, 0);
    context.fillStyle = '#ffffff';
    context.shadowColor = 'rgba(34,91,60,0.45)';
    context.shadowBlur = 8;
    context.shadowOffsetY = 5;
    context.fillText(String(this.frame.snapshot.score), 0, 0);
    context.restore();

    this.drawGalleryIcon(823, 88);
    this.drawBetaRibbon(850, 61);
    this.drawGear(949, 89);
  }

  private drawCrown(x: number, y: number, scale: number): void {
    const context = this.ctx;
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    context.shadowColor = 'rgba(57,61,43,0.42)';
    context.shadowBlur = 5;
    context.shadowOffsetY = 4;
    const gradient = context.createLinearGradient(0, -42, 0, 36);
    gradient.addColorStop(0, '#f4e6cf');
    gradient.addColorStop(1, '#b79b82');
    context.fillStyle = gradient;
    context.strokeStyle = '#9b806e';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(-43, 25);
    context.lineTo(-35, -20);
    context.lineTo(-8, 5);
    context.lineTo(0, -38);
    context.lineTo(10, 5);
    context.lineTo(37, -20);
    context.lineTo(43, 25);
    context.closePath();
    context.fill();
    context.stroke();
    roundedRect(context, -42, 22, 84, 17, 7);
    context.fill();
    context.stroke();
    for (const [cx, cy] of [[-35, -21], [0, -40], [37, -21]] as const) {
      context.beginPath();
      context.arc(cx, cy, 8, 0, TWO_PI);
      context.fill();
      context.stroke();
    }
    context.restore();
  }

  private drawGalleryIcon(x: number, y: number): void {
    const context = this.ctx;
    context.save();
    context.shadowColor = 'rgba(32,72,69,0.35)';
    context.shadowBlur = 5;
    context.shadowOffsetY = 4;
    roundedRect(context, x - 38, y - 34, 76, 68, 10);
    context.fillStyle = '#a8c8f1';
    context.fill();
    context.strokeStyle = '#5483bf';
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = '#365c9f';
    context.beginPath();
    context.arc(x - 13, y - 12, 8, 0, TWO_PI);
    context.fill();
    context.beginPath();
    context.moveTo(x - 29, y + 22);
    context.lineTo(x - 5, y - 3);
    context.lineTo(x + 9, y + 9);
    context.lineTo(x + 22, y - 3);
    context.lineTo(x + 32, y + 22);
    context.closePath();
    context.fill();
    context.restore();
  }

  private drawBetaRibbon(x: number, y: number): void {
    const context = this.ctx;
    context.save();
    context.translate(x, y);
    context.rotate(-0.04);
    roundedRect(context, -31, -15, 70, 31, 7);
    const gradient = context.createLinearGradient(0, -15, 0, 16);
    gradient.addColorStop(0, '#e25df6');
    gradient.addColorStop(1, '#8c3fd5');
    context.fillStyle = gradient;
    context.fill();
    context.strokeStyle = '#7231b5';
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = '#fff';
    context.font = '900 22px "Arial Rounded MT Bold", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('Beta', 4, 1);
    context.restore();
  }

  private drawGear(x: number, y: number): void {
    const context = this.ctx;
    context.save();
    context.translate(x, y);
    context.fillStyle = '#edffdc';
    context.strokeStyle = 'rgba(70,119,72,0.28)';
    context.lineWidth = 3;
    context.shadowColor = 'rgba(36,83,55,0.35)';
    context.shadowBlur = 5;
    context.shadowOffsetY = 3;
    for (let index = 0; index < 10; index += 1) {
      context.save();
      context.rotate((index / 10) * TWO_PI);
      roundedRect(context, -7, -39, 14, 24, 4);
      context.fill();
      context.restore();
    }
    context.beginPath();
    context.arc(0, 0, 28, 0, TWO_PI);
    context.fill();
    context.stroke();
    context.fillStyle = '#76b56e';
    context.beginPath();
    context.arc(0, 0, 12, 0, TWO_PI);
    context.fill();
    context.restore();
  }

  private drawBoard(clearing: ClearingFrame | null): void {
    if (!this.frame) return;
    const context = this.ctx;
    const outer = REFERENCE_LAYOUT.board.outer;
    const combo = this.frame.snapshot.combo;
    const clearGlow = clearing ? Math.sin(clamp01(clearing.progress) * Math.PI) : 0;
    const comboGlow = combo >= 2 ? Math.min(1, 0.3 + combo * 0.06) : 0;

    if (this.pass('board')) {

    context.save();
    context.shadowColor = REFERENCE_BOARD_COLORS.shadow;
    context.shadowBlur = 17;
    context.shadowOffsetY = 9;
    roundedRect(context, outer.x, outer.y, outer.size, outer.size, outer.radius);
    context.fillStyle = REFERENCE_BOARD_COLORS.frame;
    context.fill();
    context.restore();

    if (clearGlow > 0 || comboGlow > 0) {
      context.save();
      const hue = combo >= 6 ? '#ffbc38' : combo >= 3 ? '#78ff48' : '#65e8ff';
      context.shadowColor = hue;
      context.shadowBlur = 22 + 28 * Math.max(clearGlow, comboGlow);
      context.strokeStyle = colorWithAlpha(hue, 0.35 + Math.max(clearGlow, comboGlow) * 0.55);
      context.lineWidth = 7;
      roundedRect(context, outer.x + 2, outer.y + 2, outer.size - 4, outer.size - 4, outer.radius - 2);
      context.stroke();
      context.restore();
    }

    const grid = REFERENCE_LAYOUT.board.grid;
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const x = grid.x + col * grid.pitch;
        const y = grid.y + row * grid.pitch;
        const slotGradient = context.createLinearGradient(x, y, x, y + grid.cell);
        slotGradient.addColorStop(0, REFERENCE_BOARD_COLORS.slotTop);
        slotGradient.addColorStop(1, REFERENCE_BOARD_COLORS.slot);
        roundedRect(context, x, y, grid.cell, grid.cell, 8);
        context.fillStyle = slotGradient;
        context.fill();
        context.strokeStyle = REFERENCE_BOARD_COLORS.slotEdge;
        context.lineWidth = 2;
        context.stroke();
      }
    }
    }

    const clearSet = new Set(clearing?.clear.cells.map((cell) => cellKey(cell.row, cell.col)) ?? []);
    if (!this.pass('tile')) return;
    for (let row = 0; row < this.frame.board.rows; row += 1) {
      for (let col = 0; col < this.frame.board.cols; col += 1) {
        const color = this.frame.board.cells[row]?.[col];
        if (!color) continue;
        let alpha = 1;
        let scale = 1;
        if (clearing && clearSet.has(cellKey(row, col))) {
          const dissolve = clamp01((clearing.progress - 0.34) / 0.42);
          alpha = 1 - dissolve;
          scale = 1 - dissolve * 0.2;
        }
        this.drawBoardTile(row, col, color, alpha, scale);
      }
    }

    if (clearing) {
      for (const cell of clearing.clear.cells) {
        if (this.frame.board.cells[cell.row]?.[cell.col]) continue;
        const dissolve = clamp01((clearing.progress - 0.34) / 0.42);
        this.drawBoardTile(cell.row, cell.col, cell.color, 1 - dissolve, 1 - dissolve * 0.2);
      }
    }
  }

  private drawBoardTile(row: number, col: number, color: TileColor, alpha = 1, scale = 1): void {
    const grid = REFERENCE_LAYOUT.board.grid;
    const x = grid.x + col * grid.pitch + grid.cell / 2;
    const y = grid.y + row * grid.pitch + grid.cell / 2;
    this.drawTile(x, y, grid.cell, color, alpha, scale, true);
  }

  private drawTile(
    centerX: number,
    centerY: number,
    size: number,
    color: TileColor,
    alpha: number,
    scale: number,
    motif: boolean,
  ): void {
    if (!this.style || alpha <= 0) return;
    const context = this.ctx;
    const palette = REFERENCE_TILE_PALETTE[color];
    const drawSize = size * scale;
    const x = centerX - drawSize / 2;
    const y = centerY - drawSize / 2;
    const radius = Math.max(4, drawSize * 0.075);
    context.save();
    context.globalAlpha = clamp01(alpha);
    const softBevel = this.style.reference2d.tileMaterial === 'soft-bevel';
    context.shadowColor = softBevel ? 'rgba(18,74,45,0.42)' : 'rgba(18,74,45,0.22)';
    context.shadowBlur = softBevel ? Math.max(2, drawSize * 0.045) : Math.max(1, drawSize * 0.018);
    context.shadowOffsetX = softBevel ? drawSize * 0.035 : 0;
    context.shadowOffsetY = softBevel ? drawSize * 0.055 : drawSize * 0.018;
    roundedRect(context, x, y, drawSize, drawSize, radius);
    if (softBevel) {
      const gradient = context.createLinearGradient(x, y, x, y + drawSize);
      gradient.addColorStop(0, palette.top);
      gradient.addColorStop(0.44, palette.base);
      gradient.addColorStop(1, palette.bottom);
      context.fillStyle = gradient;
    } else {
      context.fillStyle = palette.base;
    }
    context.fill();
    context.shadowColor = 'transparent';
    context.strokeStyle = palette.edge;
    context.lineWidth = Math.max(1.4, drawSize * 0.018);
    context.stroke();

    if (softBevel) {
      roundedRect(
        context,
        x + drawSize * 0.055,
        y + drawSize * 0.045,
        drawSize * 0.89,
        drawSize * 0.86,
        radius * 0.72,
      );
      context.strokeStyle = 'rgba(255,255,255,0.22)';
      context.lineWidth = Math.max(1, drawSize * 0.014);
      context.stroke();
    }

    const tileFaceBinding = this.runtimeAssets.tileFace;
    const tileFaceImage = this.runtimeImages.tileFace;
    if (motif && tileFaceBinding && tileFaceImage) {
      const inset = drawSize * tileFaceBinding.inset;
      context.save();
      roundedRect(
        context,
        x + inset,
        y + inset,
        Math.max(1, drawSize - inset * 2),
        Math.max(1, drawSize - inset * 2),
        Math.max(2, radius - inset * 0.35),
      );
      context.clip();
      context.globalAlpha *= tileFaceBinding.opacity;
      context.globalCompositeOperation = tileFaceBinding.blendMode;
      drawImageFitted(
        context,
        tileFaceImage,
        x + inset,
        y + inset,
        Math.max(1, drawSize - inset * 2),
        Math.max(1, drawSize - inset * 2),
        tileFaceBinding.fit,
      );
      context.restore();
    } else if (motif && this.style.reference2d.tileFaceSet === 'botanical-reference') {
      context.save();
      context.translate(centerX, centerY + drawSize * 0.025);
      context.fillStyle = palette.motif;
      context.globalAlpha *= 0.52;
      // The full-video audit confirms multiple botanical families but not a
      // definitive color-to-motif assignment rule. This deterministic mapping
      // is therefore a renderer approximation, not gameplay truth.
      if (color === 'lime') this.drawLeafMotif(drawSize * 0.24);
      else if (color === 'cyan') this.drawMonsteraMotif(drawSize * 0.24);
      else if (color === 'rose') this.drawRoseMotif(drawSize * 0.25);
      else if (color === 'amber') this.drawFlowerMotif(drawSize * 0.19, 7);
      else this.drawFlowerMotif(drawSize * 0.22, color === 'blue' ? 5 : 4);
      context.restore();
    }
    context.restore();
  }

  private drawLeafMotif(size: number): void {
    const context = this.ctx;
    context.save();
    context.rotate(-0.72);
    context.beginPath();
    context.moveTo(-size * 0.85, size * 0.58);
    context.bezierCurveTo(-size * 0.5, -size, size * 0.95, -size * 0.9, size, -size * 0.85);
    context.bezierCurveTo(size * 0.8, size * 0.6, -size * 0.36, size * 0.98, -size * 0.85, size * 0.58);
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,0.12)';
    context.lineWidth = Math.max(1, size * 0.08);
    context.beginPath();
    context.moveTo(-size * 0.62, size * 0.48);
    context.lineTo(size * 0.63, -size * 0.52);
    context.stroke();
    context.restore();
  }

  private drawFlowerMotif(size: number, petals: number): void {
    const context = this.ctx;
    for (let index = 0; index < petals; index += 1) {
      context.save();
      context.rotate((index / petals) * TWO_PI);
      context.beginPath();
      context.ellipse(0, -size * 0.66, size * 0.38, size * 0.7, 0, 0, TWO_PI);
      context.fill();
      context.restore();
    }
    context.globalAlpha *= 0.85;
    context.beginPath();
    context.arc(0, 0, size * 0.28, 0, TWO_PI);
    context.fill();
  }

  private drawMonsteraMotif(size: number): void {
    const context = this.ctx;
    context.save();
    context.rotate(-0.42);
    context.beginPath();
    context.moveTo(-size * 0.18, size * 0.95);
    context.bezierCurveTo(-size * 0.98, size * 0.32, -size * 0.82, -size * 0.72, 0, -size);
    context.bezierCurveTo(size * 0.86, -size * 0.68, size * 0.98, size * 0.28, size * 0.2, size * 0.94);
    context.bezierCurveTo(size * 0.08, size * 1.03, -size * 0.08, size * 1.03, -size * 0.18, size * 0.95);
    context.fill();

    context.strokeStyle = 'rgba(255,255,255,0.13)';
    context.lineWidth = Math.max(1, size * 0.075);
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(0, size * 0.92);
    context.lineTo(0, -size * 0.82);
    for (const direction of [-1, 1] as const) {
      for (let index = 0; index < 3; index += 1) {
        const y = size * (0.48 - index * 0.42);
        context.moveTo(0, y);
        context.lineTo(direction * size * (0.48 + index * 0.08), y - size * 0.24);
      }
    }
    context.stroke();
    context.restore();
  }

  private drawRoseMotif(size: number): void {
    const context = this.ctx;
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = context.fillStyle;
    context.lineWidth = Math.max(1.5, size * 0.14);
    context.beginPath();
    context.arc(0, 0, size * 0.18, -0.4, Math.PI * 1.6);
    context.arc(-size * 0.04, size * 0.02, size * 0.34, Math.PI * 1.55, Math.PI * 3.15);
    context.arc(size * 0.02, size * 0.05, size * 0.54, Math.PI * 0.05, Math.PI * 1.65);
    context.stroke();
    for (let index = 0; index < 5; index += 1) {
      context.save();
      context.rotate((index / 5) * TWO_PI + 0.3);
      context.beginPath();
      context.ellipse(0, -size * 0.55, size * 0.34, size * 0.52, 0, 0, TWO_PI);
      context.stroke();
      context.restore();
    }
    context.restore();
  }


  private drawPlacementFeedback(): void {
    const feedback = this.frame?.placementFeedback;
    if (!feedback || feedback.cells.length === 0 || feedback.progress <= 0) return;
    const context = this.ctx;
    const grid = REFERENCE_LAYOUT.board.grid;
    const overallFade = 1 - clamp01((feedback.progress - 0.72) / 0.28);

    for (const [index, cell] of feedback.cells.entries()) {
      const stagger = index / Math.max(1, feedback.cells.length) * 0.32;
      const local = clamp01((feedback.progress - stagger) / 0.42);
      if (local <= 0) continue;
      const pulse = Math.sin(Math.min(1, local) * Math.PI);
      const centerX = grid.x + cell.col * grid.pitch + grid.cell / 2;
      const centerY = grid.y + cell.row * grid.pitch + grid.cell / 2;
      const palette = REFERENCE_TILE_PALETTE[cell.color];

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
        this.drawThumb(0, 0, 0.42 * iconIn);
        context.restore();
      }
    }
  }

  private drawRack(): void {
    if (!this.frame) return;
    const trayCell = REFERENCE_LAYOUT.rack.cell;
    for (const piece of this.frame.snapshot.pieces) {
      if (piece.used || piece.id === this.frame.hiddenPieceId || piece.id === this.dragPreview?.pieceId) continue;
      const shape = getShape(piece.shapeId);
      const bounds = getShapeBounds(shape);
      const centerX = REFERENCE_LAYOUT.rack.centersX[piece.slotIndex] ?? REFERENCE_CANVAS.width / 2;
      const centerY = REFERENCE_LAYOUT.rack.centerY;
      for (const [[row, col], index] of shape.cells.map((cell, cellIndex) => [cell, cellIndex] as const)) {
        const x = centerX + (col - (bounds.cols - 1) / 2) * trayCell;
        const y = centerY + (row - (bounds.rows - 1) / 2) * trayCell;
        this.drawTile(x, y, trayCell - 2, pieceCellColor(piece, index), 1, 1, true);
      }
    }
  }

  private activeDraggedPiece(): { piece: PieceInstance; anchor: GridCell | null; pointer: { x: number; y: number } | null; progress: number } | null {
    if (!this.frame) return null;
    if (this.dragPreview) {
      const piece = this.frame.snapshot.pieces.find((candidate) => candidate.id === this.dragPreview?.pieceId);
      return piece
        ? { piece, anchor: this.dragPreview.anchor, pointer: this.dragPreview.pointer, progress: 1 }
        : null;
    }
    if (!this.frame.draggedPiece) return null;
    return {
      piece: this.frame.draggedPiece.piece,
      anchor: this.frame.draggedPiece.anchor,
      pointer: this.frame.pointer ? { x: this.frame.pointer.x, y: this.frame.pointer.y } : null,
      progress: this.frame.draggedPiece.progress,
    };
  }

  private drawDragAndPreview(): void {
    if (!this.frame || !this.style) return;
    const active = this.activeDraggedPiece();
    if (!active) return;
    const { piece, anchor, pointer, progress } = active;
    const shape = getShape(piece.shapeId);
    const bounds = getShapeBounds(shape);
    const preview = anchor ? previewFor(this.frame.snapshot, piece, anchor) : null;

    if (preview && anchor) {
      if (this.style.reference2d.previewFx === 'full-line-tint') {
        const highlightColor: TileColor = 'violet';
        const rows = new Set(preview.clear.rows);
        const cols = new Set(preview.clear.cols);
        for (let row = 0; row < 8; row += 1) {
          for (let col = 0; col < 8; col += 1) {
            if (!rows.has(row) && !cols.has(col)) continue;
            this.drawPreviewCell(row, col, highlightColor, 0.44);
          }
        }
      }
      preview.cells.forEach((cell, index) => {
        this.drawPreviewCell(cell.row, cell.col, pieceCellColor(piece, index), 0.66);
      });
    }

    const pointerReference = pointer
      ? { x: pointer.x * REFERENCE_CANVAS.width, y: pointer.y * REFERENCE_CANVAS.height }
      : null;
    let centerX: number;
    let centerY: number;
    if (pointerReference) {
      centerX = pointerReference.x;
      centerY = pointerReference.y - REFERENCE_LAYOUT.rack.pickupLift;
    } else if (anchor) {
      centerX = REFERENCE_LAYOUT.board.grid.x + (anchor.col + bounds.cols / 2) * REFERENCE_LAYOUT.board.grid.pitch - REFERENCE_LAYOUT.board.grid.gap / 2;
      centerY = REFERENCE_LAYOUT.board.grid.y + (anchor.row + bounds.rows / 2) * REFERENCE_LAYOUT.board.grid.pitch - REFERENCE_LAYOUT.board.grid.gap / 2;
    } else {
      centerX = REFERENCE_LAYOUT.rack.centersX[piece.slotIndex] ?? REFERENCE_CANVAS.width / 2;
      centerY = REFERENCE_LAYOUT.rack.centerY;
    }

    const pickupProgress = easeOutCubic(Math.min(1, progress / 0.25));
    const tileSize = REFERENCE_LAYOUT.rack.cell + (REFERENCE_LAYOUT.board.grid.cell - REFERENCE_LAYOUT.rack.cell) * pickupProgress;
    const alpha = anchor && !canPlace(this.frame.snapshot.board, piece, anchor) ? 0.58 : 0.98;
    for (const [[row, col], index] of shape.cells.map((cell, cellIndex) => [cell, cellIndex] as const)) {
      const x = centerX + (col - (bounds.cols - 1) / 2) * (tileSize + 4);
      const y = centerY + (row - (bounds.rows - 1) / 2) * (tileSize + 4);
      this.drawTile(x, y, tileSize, pieceCellColor(piece, index), alpha, 1, true);
    }
  }

  private drawPreviewCell(row: number, col: number, color: TileColor, alpha: number): void {
    const grid = REFERENCE_LAYOUT.board.grid;
    const x = grid.x + col * grid.pitch;
    const y = grid.y + row * grid.pitch;
    const palette = REFERENCE_TILE_PALETTE[color];
    const context = this.ctx;
    context.save();
    roundedRect(context, x + 2, y + 2, grid.cell - 4, grid.cell - 4, 8);
    context.fillStyle = colorWithAlpha(palette.base, alpha);
    context.fill();
    context.strokeStyle = colorWithAlpha('#ffffff', alpha * 0.65);
    context.lineWidth = 3;
    context.stroke();
    context.restore();
  }

  private drawClearFx(clearing: ClearingFrame, seconds: number): void {
    if (!this.frame || !this.style) return;
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const grid = REFERENCE_LAYOUT.board.grid;
    const boardSpan = grid.pitch * 8 - grid.gap;

    const lineFlash = Math.sin(clamp01(progress / 0.58) * Math.PI);
    const sweepProgress = clamp01((progress - 0.05) / 0.5);
    for (const row of clearing.clear.rows) {
      const y = grid.y + row * grid.pitch;
      context.save();
      roundedRect(context, grid.x, y, boardSpan, grid.cell, 6);
      context.fillStyle = `rgba(255,125,224,${0.12 + lineFlash * 0.34})`;
      context.fill();
      const sweepX = grid.x - 280 + (boardSpan + 560) * sweepProgress;
      const gradient = context.createLinearGradient(sweepX - 220, 0, sweepX + 220, 0);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(0.42, `rgba(255,255,255,${0.15 + lineFlash * 0.65})`);
      gradient.addColorStop(0.5, `rgba(255,255,255,${0.85 * lineFlash})`);
      gradient.addColorStop(0.58, `rgba(255,255,255,${0.15 + lineFlash * 0.65})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient;
      context.fillRect(grid.x, y - 5, boardSpan, grid.cell + 10);
      context.restore();
    }
    for (const col of clearing.clear.cols) {
      const x = grid.x + col * grid.pitch;
      context.save();
      roundedRect(context, x, grid.y, grid.cell, boardSpan, 6);
      context.fillStyle = `rgba(101,226,255,${0.12 + lineFlash * 0.34})`;
      context.fill();
      const sweepY = grid.y + boardSpan + 280 - (boardSpan + 560) * sweepProgress;
      const gradient = context.createLinearGradient(0, sweepY - 220, 0, sweepY + 220);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(0.42, `rgba(255,255,255,${0.15 + lineFlash * 0.65})`);
      gradient.addColorStop(0.5, `rgba(255,255,255,${0.85 * lineFlash})`);
      gradient.addColorStop(0.58, `rgba(255,255,255,${0.15 + lineFlash * 0.65})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient;
      context.fillRect(x - 5, grid.y, grid.cell + 10, boardSpan);
      context.restore();
    }

    if (this.style.reference2d.clearFx === 'sweep-score-spark') {
      const glyphProgress = clamp01((progress - 0.2) / 0.62);
      for (const [index, cell] of clearing.clear.cells.entries()) {
        const start = (index % 9) * 0.025;
        const local = clamp01((glyphProgress - start) / 0.48);
        if (local <= 0 || local >= 1) continue;
        const x = grid.x + cell.col * grid.pitch + grid.cell / 2;
        const y = grid.y + cell.row * grid.pitch + grid.cell / 2 - local * 28;
        context.save();
        context.globalAlpha = Math.sin(local * Math.PI);
        context.translate(x, y);
        context.scale(0.75 + easeOutBack(Math.min(1, local * 2)) * 0.32, 0.75 + easeOutBack(Math.min(1, local * 2)) * 0.32);
        if (index % 4 === 0) this.drawThumb(0, -2, 0.62);
        else {
          context.font = '900 30px "Arial Rounded MT Bold", sans-serif';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.lineWidth = 5;
          context.strokeStyle = '#ff6fb6';
          context.strokeText(index % 7 === 0 ? '9' : '5', 0, 0);
          context.fillStyle = '#fff58d';
          context.fillText(index % 7 === 0 ? '9' : '5', 0, 0);
        }
        context.restore();
      }
      this.drawSparkCloud(clearing, seconds);
    }
  }

  private drawThumb(x: number, y: number, scale: number): void {
    const context = this.ctx;
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    context.fillStyle = '#fff9a7';
    context.strokeStyle = '#36a862';
    context.lineWidth = 5;
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(-20, 9);
    context.lineTo(-3, 9);
    context.lineTo(4, -22);
    context.quadraticCurveTo(10, -31, 18, -24);
    context.quadraticCurveTo(23, -18, 18, -6);
    context.lineTo(31, -6);
    context.quadraticCurveTo(40, -6, 39, 3);
    context.lineTo(34, 22);
    context.quadraticCurveTo(32, 29, 23, 29);
    context.lineTo(-3, 29);
    context.lineTo(-3, 14);
    context.lineTo(-20, 14);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  private drawSparkCloud(clearing: ClearingFrame, seconds: number): void {
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const seed = clearing.seed;
    const center = clearing.clear.cells.reduce(
      (sum, cell) => ({ x: sum.x + cell.col, y: sum.y + cell.row }),
      { x: 0, y: 0 },
    );
    const count = Math.max(1, clearing.clear.cells.length);
    const cx = REFERENCE_LAYOUT.board.grid.x + (center.x / count) * REFERENCE_LAYOUT.board.grid.pitch + REFERENCE_LAYOUT.board.grid.cell / 2;
    const cy = REFERENCE_LAYOUT.board.grid.y + (center.y / count) * REFERENCE_LAYOUT.board.grid.pitch + REFERENCE_LAYOUT.board.grid.cell / 2;
    for (let index = 0; index < Math.min(72, clearing.clear.cells.length * 3); index += 1) {
      const angle = seededFloat(hash32(seed + index * 31), index + 7) * TWO_PI;
      const distance = (30 + seededFloat(hash32(seed + index * 41), index + 3) * 360) * easeOutCubic(progress);
      const x = cx + Math.cos(angle) * distance;
      const y = cy + Math.sin(angle) * distance - progress * 35;
      const alpha = Math.sin(progress * Math.PI) * (0.35 + seededFloat(seed, index + 14) * 0.6);
      const size = 3 + seededFloat(seed + 19, index) * 8;
      context.save();
      context.translate(x, y);
      context.rotate(angle + seconds);
      context.globalAlpha = alpha;
      context.fillStyle = index % 4 === 0 ? '#fff46d' : index % 4 === 1 ? '#ff78b7' : index % 4 === 2 ? '#6df2ef' : '#ffffff';
      if (index % 5 === 0) {
        context.beginPath();
        for (let point = 0; point < 8; point += 1) {
          const radius = point % 2 === 0 ? size : size * 0.35;
          const a = (point / 8) * TWO_PI;
          const px = Math.cos(a) * radius;
          const py = Math.sin(a) * radius;
          if (point === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.closePath();
        context.fill();
      } else {
        context.fillRect(-size / 2, -size / 2, size, size);
      }
      context.restore();
    }
  }

  private drawPraise(clearing: ClearingFrame): void {
    if (!this.frame) return;
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const lineCount = clearing.clear.rows.length + clearing.clear.cols.length;
    const combo = this.frame.snapshot.combo;
    // The six labels are observed across the full recording. Their exact
    // trigger thresholds remain unresolved, so this selector is explicitly a
    // prototype display heuristic rather than a reference rule claim.
    const tier: PraiseTierId = lineCount >= 4 || clearing.clear.cells.length >= 28 || combo >= 8
      ? 'unbelievable'
      : lineCount >= 3 || clearing.clear.cells.length >= 24 || combo >= 6
        ? 'fantastic'
        : clearing.clear.cells.length >= 20 || combo >= 5
          ? 'incredible'
          : clearing.clear.cells.length >= 16 || combo >= 3
            ? 'amazing'
            : lineCount >= 2 || combo >= 2
              ? 'great'
              : 'nice';
    const praiseLabels: Record<PraiseTierId, string> = {
      nice: 'Nice!',
      great: 'Great!',
      amazing: 'Amazing!',
      incredible: 'Incredible!',
      fantastic: 'Fantastic!',
      unbelievable: 'Unbelievable!',
    };
    const praise = praiseLabels[tier];
    const praiseIn = clamp01((progress - 0.28) / 0.22);
    const praiseOut = 1 - clamp01((progress - 0.82) / 0.18);
    const alpha = Math.min(praiseIn, praiseOut);
    if (alpha > 0) {
      const scale = 0.72 + easeOutBack(praiseIn) * 0.34;
      context.save();
      context.translate(REFERENCE_CANVAS.width / 2, 770);
      context.scale(scale, scale);
      context.globalAlpha = alpha;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = `900 ${tier === 'unbelievable' || tier === 'incredible' ? 55 : 68}px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif`;
      context.lineWidth = 13;
      context.strokeStyle = '#ffffff';
      context.strokeText(praise, 0, 0);
      context.lineWidth = 7;
      context.strokeStyle = tier === 'nice'
        ? '#248fda'
        : tier === 'great'
          ? '#e56f18'
          : tier === 'amazing'
            ? '#b24dd6'
            : tier === 'incredible'
              ? '#ce4e8b'
              : '#7756d8';
      context.strokeText(praise, 0, 0);
      const gradient = context.createLinearGradient(0, -42, 0, 42);
      if (tier === 'nice') {
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(1, '#64bfff');
      } else if (tier === 'great') {
        gradient.addColorStop(0, '#fff677');
        gradient.addColorStop(1, '#ff8d2d');
      } else if (tier === 'amazing') {
        gradient.addColorStop(0, '#fff68b');
        gradient.addColorStop(0.5, '#ff76cc');
        gradient.addColorStop(1, '#9a77ff');
      } else if (tier === 'incredible') {
        gradient.addColorStop(0, '#fff7a0');
        gradient.addColorStop(0.45, '#ff75b6');
        gradient.addColorStop(1, '#73e0ff');
      } else {
        gradient.addColorStop(0, '#fff6a0');
        gradient.addColorStop(0.5, '#ff75c1');
        gradient.addColorStop(1, '#77d6ff');
      }
      context.fillStyle = gradient;
      context.shadowColor = 'rgba(255,191,65,0.62)';
      context.shadowBlur = 18;
      context.fillText(praise, 0, 0);
      if (tier === 'unbelievable') {
        context.font = '900 46px "Arial Rounded MT Bold", sans-serif';
        context.fillStyle = '#fff04d';
        context.strokeStyle = '#987311';
        context.lineWidth = 5;
        context.strokeText('+300', 0, 65);
        context.fillText('+300', 0, 65);
      }
      context.restore();
    }

    if (combo >= 2) {
      const comboIn = clamp01((progress - 0.58) / 0.25);
      const comboOut = 1 - clamp01((progress - 0.94) / 0.06);
      const comboAlpha = Math.min(comboIn, comboOut);
      if (comboAlpha > 0) {
        context.save();
        context.translate(REFERENCE_CANVAS.width / 2, 850);
        const scale = 0.78 + easeOutBack(comboIn) * 0.28;
        context.scale(scale, scale);
        context.globalAlpha = comboAlpha;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.font = 'italic 900 68px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
        context.lineWidth = 12;
        context.strokeStyle = '#ffffff';
        context.strokeText(`Combo ${combo}`, 0, 0);
        context.lineWidth = 7;
        context.strokeStyle = '#188934';
        context.strokeText(`Combo ${combo}`, 0, 0);
        const gradient = context.createLinearGradient(-110, -30, 130, 30);
        gradient.addColorStop(0, '#8cff34');
        gradient.addColorStop(0.56, '#37db49');
        gradient.addColorStop(0.63, '#fff24f');
        gradient.addColorStop(1, '#ff9128');
        context.fillStyle = gradient;
        context.shadowColor = 'rgba(127,255,79,0.5)';
        context.shadowBlur = 14;
        context.fillText(`Combo ${combo}`, 0, 0);
        context.restore();
      }
    }
  }

  private drawPointer(): void {
    if (!this.frame?.pointer || !this.style?.showPointer) return;
    const x = this.frame.pointer.x * REFERENCE_CANVAS.width;
    const y = this.frame.pointer.y * REFERENCE_CANVAS.height;
    const context = this.ctx;
    context.save();
    context.globalAlpha = this.frame.pointer.pressed ? 0.9 : 0.55;
    context.strokeStyle = '#ffffff';
    context.lineWidth = 5;
    context.shadowColor = 'rgba(75,235,205,0.8)';
    context.shadowBlur = 15;
    context.beginPath();
    context.arc(x, y, this.frame.pointer.pressed ? 22 : 16, 0, TWO_PI);
    context.stroke();
    context.restore();
  }

  private drawContinueModal(): void {
    if (!this.frame) return;
    const context = this.ctx;
    context.save();
    context.fillStyle = 'rgba(4,31,26,0.72)';
    context.fillRect(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = 'italic 900 76px "Arial Rounded MT Bold", sans-serif';
    context.lineWidth = 12;
    context.strokeStyle = '#263d8b';
    const title = this.frame.snapshot.combo > 0
      ? `Combo ${this.frame.snapshot.combo}`
      : 'Game Over';
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
