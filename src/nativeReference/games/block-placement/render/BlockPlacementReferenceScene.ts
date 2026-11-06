import {clearRuleAt} from '../runtime/clearRules';
import { materialTheme, materialCellMetrics, paintMaterialStage } from './materialThemes';
import { materialClearPalette, materialFaceSwatch } from './materialClearPalette';
import { cloneBoard } from '../runtime/boardPresets';
import {
  canPlace,
  detectClear,
  pieceCellColor,
  pieceCells,
} from '../runtime/gameEngine';
import { hash32, seededFloat } from '../../../domain/rng';
import { getShape, getShapeBounds } from '../runtime/shapes';
import { blastPraiseTier, type BlastPraiseTierId } from '../../../domain/types';
import { praiseWordLabel, resolvePraiseWord } from '../../../domain/praiseWords';
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
} from '../../../domain/types';
import {
  EMPTY_RUNTIME_ASSET_BINDINGS,
  type RuntimeAssetBindings,
  type RuntimeImageAssetBinding,
} from '../../../assets/runtimeAssetBindings';
import type { ReferencePassId } from '../../../headless/contracts';
import { REFERENCE_PASS_ORDER } from '../../../headless/contracts';
import { isPassEnabled, PRAISE_PASS } from '../../../reference2d/passes';
import { boardAtlasCellSourceRect } from './boardAtlas';
import { BLAST_CROWN, paintBlastCrown, paintBlastGear } from './blastHud';
import { boardAnchorFromCenterPx, boardAnchorFromNormalizedPointer, boardPieceCenterPx } from '../profiles/layout';
import {
  BLAST_BACKGROUND,
  BLAST_BOARD_COLORS,
  BLAST_FACE_GEOMETRY,
  BLAST_FACE_PALETTE,
  BLAST_TILE_PALETTE,
  REFERENCE_BACKGROUND,
  REFERENCE_BOARD_COLORS,
  REFERENCE_CANVAS,
  REFERENCE_LAYOUT,
  REFERENCE_TILE_PALETTE,
  type BlastFaceSwatch,
  type BlastRgb,
  type ReferenceTilePalette,
} from '../../../reference2d/referenceProfile';

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
  boardAtlas: HTMLImageElement | null;
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
  context.beginPath();
  appendRoundedRect(context, x, y, width, height, radius);
}

function appendRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function colorWithAlpha(hex: string, alpha: number): string {
  const [red, green, blue] = parseHex(hex);
  return `rgba(${red},${green},${blue},${clamp01(alpha)})`;
}

/** 六段彩虹渐变(消除光带、文字光晕共用), 沿 (x0,y0)->(x1,y1)。 */
function rainbowGradient(
  context: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  alpha: number,
): CanvasGradient {
  const gradient = context.createLinearGradient(x0, y0, x1, y1);
  for (let i = 0; i <= 6; i += 1) {
    gradient.addColorStop(i / 6, `hsla(${i * 60}, 100%, 62%, ${clamp01(alpha)})`);
  }
  return gradient;
}

function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgb(red: number, green: number, blue: number): string {
  return `rgb(${Math.round(red)},${Math.round(green)},${Math.round(blue)})`;
}

function rgbFrom(color: BlastRgb, scale = 1): string {
  return rgb(
    Math.min(255, Math.max(0, color[0] * scale)),
    Math.min(255, Math.max(0, color[1] * scale)),
    Math.min(255, Math.max(0, color[2] * scale)),
  );
}

function fillTrapezoid(
  context: CanvasRenderingContext2D,
  points: ReadonlyArray<readonly [number, number]>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  start: string,
  end: string,
): void {
  const gradient = context.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, start);
  gradient.addColorStop(1, end);
  context.beginPath();
  const origin = points[0];
  if (!origin) return;
  context.moveTo(origin[0], origin[1]);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point) context.lineTo(point[0], point[1]);
  }
  context.closePath();
  context.fillStyle = gradient;
  context.fill();
}

/** Kimik3 ZTC4F4273 painter: sharp square, 2px outline, 17px 45° bevels, 3-stop face. */
function paintCandyBlastTile(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  swatch: BlastFaceSwatch,
): void {
  if (size <= 1) return;
  const scale = size / BLAST_FACE_GEOMETRY.unitPx;
  const outline = Math.max(0.5, BLAST_FACE_GEOMETRY.outlinePx * scale);
  const bevel = Math.max(1, BLAST_FACE_GEOMETRY.bevelPx * scale);
  const inner = size - outline * 2;
  const faceSize = inner - bevel * 2;

  context.fillStyle = rgbFrom(swatch.outline);
  context.fillRect(x, y, size, size);
  if (inner <= 1) return;

  const ox = x + outline;
  const oy = y + outline;
  const right = ox + inner;
  const bottom = oy + inner;

  context.save();
  context.beginPath();
  context.rect(ox, oy, inner, inner);
  context.clip();

  if (faceSize <= 1) {
    context.fillStyle = rgbFrom(swatch.faceMid);
    context.fillRect(ox, oy, inner, inner);
    context.restore();
    return;
  }

  const fx = ox + bevel;
  const fy = oy + bevel;
  const faceRight = fx + faceSize;
  const faceBottom = fy + faceSize;

  fillTrapezoid(
    context,
    [
      [ox, oy],
      [fx, fy],
      [fx, faceBottom],
      [ox, bottom],
    ],
    ox,
    oy,
    fx,
    oy,
    rgbFrom(swatch.bevelLeft, 1.02),
    rgbFrom(swatch.bevelLeft, 0.95),
  );
  fillTrapezoid(
    context,
    [
      [right, oy],
      [right, bottom],
      [faceRight, faceBottom],
      [faceRight, fy],
    ],
    faceRight,
    oy,
    right,
    oy,
    rgbFrom(swatch.bevelRight),
    rgbFrom(swatch.bevelRight, 0.72),
  );
  fillTrapezoid(
    context,
    [
      [ox, oy],
      [right, oy],
      [faceRight, fy],
      [fx, fy],
    ],
    ox,
    oy,
    ox,
    fy,
    rgbFrom(swatch.bevelTop, 0.985),
    rgbFrom(swatch.bevelTop, 1.02),
  );
  fillTrapezoid(
    context,
    [
      [ox, bottom],
      [right, bottom],
      [faceRight, faceBottom],
      [fx, faceBottom],
    ],
    ox,
    faceBottom,
    ox,
    bottom,
    rgbFrom(swatch.bevelBottom),
    rgbFrom(swatch.bevelBottom, 0.78),
  );

  const face = context.createLinearGradient(fx, fy, fx, faceBottom);
  face.addColorStop(0, rgbFrom(swatch.faceTop));
  face.addColorStop(0.5, rgbFrom(swatch.faceMid));
  face.addColorStop(1, rgbFrom(swatch.faceBottom));
  context.fillStyle = face;
  context.fillRect(fx, fy, faceSize, faceSize);
  context.restore();
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

const BLAST_CONFETTI = ['#ffd24a', '#ff8a3a', '#c86bff', '#5ad6ff', '#ff6bb5', '#7dff6a'] as const;

function burstTravel(progress: number): number {
  return 1 - (1 - clamp01(progress)) ** 2;
}

function blastBurstPose(
  cell: GridCell,
  clear: ClearResult,
  progress: number,
  seed: number,
  index: number,
  copy = 0,
): { dx: number; dy: number; rotation: number; scale: number; alpha: number } {
  const t = burstTravel(progress);
  const punch = progress < 0.14 ? 1 + (1 - progress / 0.14) * 0.2 : 1;
  const spin = seededFloat(hash32(seed + index * 97 + copy * 13), index + 4);
  const scatter = seededFloat(hash32(seed + index * 53 + copy * 19), index + 11);
  const lift = seededFloat(hash32(seed + index * 71 + copy * 29), index + 19);
  const inRow = clear.rows.includes(cell.row);
  const inCol = clear.cols.includes(cell.col);
  const copySpread = copy * (34 + scatter * 18);
  let vx = (scatter - 0.5) * 110 + (copy === 1 ? copySpread : copy === 2 ? -copySpread : 0);
  let vy = -90 - lift * 170 + (scatter - 0.42) * 70;
  if (inRow) vx += (cell.col - 3.5) * (42 + spin * 30);
  if (inCol) vy += (cell.row - 3.5) * 18 - 36;
  return {
    dx: vx * t,
    dy: vy * t + 190 * progress * progress,
    rotation: (spin - 0.5) * 0.9 * Math.PI * t,
    scale: punch * (1.06 - progress * 0.1),
    alpha: 1 - clamp01((progress - 0.58) / 0.42),
  };
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
  const rule=clearRuleAt(snapshot);return { cells, clear: detectClear(board,rule.axes,rule.trigger) };
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
  private runtimeImages: RuntimeImages = { background: null, tileFace: null, boardAtlas: null };
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

  private boardColors() {
    const themed = materialTheme(this.style?.reference2d.materialTheme);
    if (themed) return themed.board;
    return this.isBlastLook() ? BLAST_BOARD_COLORS : REFERENCE_BOARD_COLORS;
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
    this.runtimeImages = { background: null, tileFace: null, boardAtlas: null };
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
    return boardAnchorFromCenterPx(point, bounds);
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
    if (this.isBlastLook() && this.frame.cameraPunch > 0) {
      const punch = this.frame.cameraPunch;
      context.translate(
        Math.sin(seconds * 94 + punch * 9) * punch * 10,
        Math.cos(seconds * 81) * punch * 7,
      );
    }
    // 消除冲击震屏: 起爆瞬间 ±6px, 按冲击包络二次衰减
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
      this.drawBoard(clearing, seconds);
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
      this.drawPraise(clearing, seconds);
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
    const themed = materialTheme(this.style.reference2d.materialTheme);
    const backgroundBinding = this.runtimeAssets.background;
    const backgroundImage = this.runtimeImages.background;
    if (themed && !(backgroundBinding && backgroundImage)) {
      paintMaterialStage(context, themed, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);
    } else if (backgroundBinding && backgroundImage) {
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
      if (this.isBlastLook()) {
        grade.addColorStop(0, 'rgba(12,20,48,0.08)');
        grade.addColorStop(0.58, 'rgba(16,28,64,0.05)');
        grade.addColorStop(1, 'rgba(8,12,36,0.18)');
      } else {
        grade.addColorStop(0, 'rgba(0,40,48,0.08)');
        grade.addColorStop(0.58, 'rgba(8,72,58,0.06)');
        grade.addColorStop(1, 'rgba(2,32,34,0.22)');
      }
      context.fillStyle = grade;
      context.fillRect(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);
    } else {
      const background = this.isBlastLook() ? BLAST_BACKGROUND : REFERENCE_BACKGROUND;
      const gradient = context.createLinearGradient(0, 0, 0, REFERENCE_CANVAS.height);
      gradient.addColorStop(0, background.top);
      gradient.addColorStop(0.48, background.middle);
      gradient.addColorStop(1, background.bottom);
      context.fillStyle = gradient;
      context.fillRect(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);
    }

    if (!this.isBlastLook()) {
      const halo = context.createRadialGradient(532, 730, 0, 532, 730, 760);
      halo.addColorStop(0, REFERENCE_BACKGROUND.halo);
      halo.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = halo;
      context.fillRect(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);
    }

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
    const blast = this.isBlastLook();
    if (blast) {
      const crown = REFERENCE_LAYOUT.hud.blastCrown;
      paintBlastCrown(context, crown.x, crown.y);
      context.save();
      context.font = '800 54px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.fillStyle = materialTheme(this.style.reference2d.materialTheme)?.hud.best ?? '#ffb434';
      context.shadowColor = 'rgba(113,84,24,0.35)';
      context.shadowBlur = 6;
      context.shadowOffsetY = 4;
      context.fillText(String(best), crown.x + BLAST_CROWN.width + 8, crown.y + BLAST_CROWN.height * 0.58);
      context.restore();
    } else {
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
    }

    const scorePulse = clearing ? 1 + Math.sin(clamp01(clearing.progress) * Math.PI) * (this.isBlastLook() ? 0.12 : 0.035) : 1;
    context.save();
    context.translate(REFERENCE_LAYOUT.hud.scoreCenter.x, REFERENCE_LAYOUT.hud.scoreCenter.y);
    context.scale(scorePulse, scorePulse);
    context.font = '900 102px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    if (this.isBlastLook()) {
      if (clearing) {
        context.shadowColor = 'rgba(255, 230, 120, 0.85)';
        context.shadowBlur = 28 + Math.sin(clamp01(clearing.progress) * Math.PI) * 18;
      } else {
        context.shadowColor = 'rgba(16,28,64,0.45)';
        context.shadowBlur = 8;
      }
      context.fillStyle = materialTheme(this.style.reference2d.materialTheme)?.hud.score ?? '#ffffff';
      context.shadowOffsetY = 5;
      context.fillText(String(this.frame.snapshot.score), 0, 0);
    } else {
      context.lineWidth = 6;
      context.strokeStyle = 'rgba(47,89,61,0.23)';
      context.strokeText(String(this.frame.snapshot.score), 0, 0);
      context.fillStyle = materialTheme(this.style.reference2d.materialTheme)?.hud.score ?? '#ffffff';
      context.shadowColor = 'rgba(34,91,60,0.45)';
      context.shadowBlur = 8;
      context.shadowOffsetY = 5;
      context.fillText(String(this.frame.snapshot.score), 0, 0);
    }
    context.restore();

    if (!blast) {
      this.drawGalleryIcon(823, 88);
      this.drawBetaRibbon(850, 61);
    }
    if (blast) {
      paintBlastGear(context, REFERENCE_LAYOUT.hud.blastGear.x, REFERENCE_LAYOUT.hud.blastGear.y);
    } else {
      this.drawGear(949, 89);
    }
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
    const blast = this.isBlastLook();
    context.save();
    context.translate(x, y);
    context.fillStyle = blast ? '#d7f0ff' : '#edffdc';
    context.strokeStyle = blast ? 'rgba(90,140,190,0.28)' : 'rgba(70,119,72,0.28)';
    context.lineWidth = 3;
    context.shadowColor = blast ? 'rgba(16,28,64,0.35)' : 'rgba(36,83,55,0.35)';
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
    context.fillStyle = this.isBlastLook() ? '#4a7cb0' : '#76b56e';
    context.beginPath();
    context.arc(0, 0, 12, 0, TWO_PI);
    context.fill();
    context.restore();
  }

  private drawBoard(clearing: ClearingFrame | null, seconds = 0): void {
    if (!this.frame) return;
    const context = this.ctx;
    const outer = REFERENCE_LAYOUT.board.outer;
    const combo = this.frame.snapshot.combo;
    const clearGlow = clearing ? Math.sin(clamp01(clearing.progress) * Math.PI) : 0;
    const comboGlow = combo >= 2 ? Math.min(1, 0.3 + combo * 0.06) : 0;

    if (this.pass('board')) {
    const board = this.boardColors();
    const grid = REFERENCE_LAYOUT.board.grid;
    const wellRadius = this.isBlastLook() ? Math.max(8, grid.cell * 0.18) : 8;

    context.save();
    context.shadowColor = board.shadow;
    context.shadowBlur = this.isBlastLook() ? 10 : 17;
    context.shadowOffsetY = this.isBlastLook() ? 6 : 9;
    roundedRect(context, outer.x, outer.y, outer.size, outer.size, outer.radius);
    context.fillStyle = board.frame;
    context.fill();
    context.restore();

    if (this.style?.reference2d.materialTheme) {
      context.save();
      context.strokeStyle = board.frameHighlight;
      context.lineWidth = 2;
      context.globalAlpha = .65;
      roundedRect(context, outer.x + 1, outer.y + 1, outer.size - 2, outer.size - 2, outer.radius - 1);
      context.stroke();
      context.restore();
    }

    const screenFxId = this.style?.reference2d.screenFx;
    // 侧边霓虹: blast 皮肤默认开; 显式 screenFx 时只在含 edge-glow 的档位开
    const edgeGlowOn = this.isBlastLook()
      && (screenFxId === undefined || screenFxId === 'edge-glow' || screenFxId === 'edge-glow+clear-bloom');
    if (screenFxId !== 'none' && (clearGlow > 0 || comboGlow > 0 || edgeGlowOn)) {
      if (edgeGlowOn) {
        // ---- 常驻霓虹框: 呼吸粉光, 连击增强, 高档(combo>=4)流动彩虹 ----
        const breathe = 0.5 + 0.5 * Math.sin(seconds * 2.4);
        const boost = Math.max(clearGlow, comboGlow);
        const neon = 0.3 + 0.1 * breathe + boost * 0.6;
        context.save();
        // 外层软光晕
        context.shadowColor = '#ff5fc8';
        context.shadowBlur = 30 + 26 * boost + 8 * breathe;
        context.strokeStyle = colorWithAlpha('#ff5fc8', Math.min(1, neon * 0.55));
        context.lineWidth = 13 + 6 * boost;
        roundedRect(context, outer.x - 4, outer.y - 4, outer.size + 8, outer.size + 8, outer.radius + 4);
        context.stroke();
        // 内层亮线(combo>=4 变流动彩虹)
        context.shadowBlur = 12 + 10 * boost;
        context.shadowColor = '#ffd7f2';
        if (combo >= 4) {
          const flow = context.createLinearGradient(outer.x, outer.y, outer.x + outer.size, outer.y + outer.size);
          for (let i = 0; i <= 6; i += 1) {
            flow.addColorStop(i / 6, `hsla(${(i * 60 + seconds * 70) % 360}, 100%, 62%, ${Math.min(1, 0.55 + 0.35 * boost)})`);
          }
          context.strokeStyle = flow;
        } else {
          context.strokeStyle = colorWithAlpha('#ffd7f2', Math.min(1, neon * 0.9));
        }
        context.lineWidth = 3.5 + 1.5 * boost;
        roundedRect(context, outer.x + 1.5, outer.y + 1.5, outer.size - 3, outer.size - 3, outer.radius - 1);
        context.stroke();
        context.restore();
        // ---- 周边漂浮光点(加法, 沿周长漂移 + 闪烁) ----
        const sparkCount = 10 + Math.round(boost * 14);
        context.save();
        context.globalCompositeOperation = 'lighter';
        for (let i = 0; i < sparkCount; i += 1) {
          const t0 = seededFloat(hash32(7100 + i * 13), i);
          const speed = 0.02 + seededFloat(hash32(7200 + i * 7), i) * 0.05;
          const perimeter = outer.size * 4;
          const d = ((t0 + seconds * speed) % 1) * perimeter;
          let sx = outer.x;
          let sy = outer.y;
          if (d < outer.size) { sx += d; }
          else if (d < outer.size * 2) { sx += outer.size; sy += d - outer.size; }
          else if (d < outer.size * 3) { sx += outer.size - (d - outer.size * 2); sy += outer.size; }
          else { sy += outer.size - (d - outer.size * 3); }
          const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(seconds * (2.5 + (i % 3)) + i * 1.7));
          context.globalAlpha = twinkle * (0.32 + boost * 0.6);
          const radius = 1.4 + seededFloat(hash32(7300 + i), i) * 2.2 + boost * 1.2;
          context.fillStyle = i % 4 === 0 ? '#ffffff' : '#ffc7ec';
          context.beginPath();
          context.arc(sx, sy, radius, 0, TWO_PI);
          context.fill();
        }
        context.restore();
      } else {
        context.save();
        const hue = combo >= 6 ? '#ffbc38' : combo >= 3 ? '#78ff48' : '#65e8ff';
        const glow = Math.max(clearGlow, comboGlow);
        context.shadowColor = hue;
        context.shadowBlur = 22 + 28 * glow;
        context.strokeStyle = colorWithAlpha(hue, 0.35 + glow * 0.55);
        context.lineWidth = 7;
        roundedRect(context, outer.x + 2, outer.y + 2, outer.size - 4, outer.size - 4, outer.radius - 2);
        context.stroke();
        context.restore();
      }
    }

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const x = grid.x + col * grid.pitch;
        const y = grid.y + row * grid.pitch;
        const slotGradient = context.createLinearGradient(x, y, x, y + grid.cell);
        slotGradient.addColorStop(0, board.slotTop);
        slotGradient.addColorStop(1, board.slot);
        if (this.isBlastLook()) {
          // 原视频样式: 平涂小圆角 + 细缝(内缩留出缝), 不要大圆井
          const inset = materialCellMetrics(this.style?.reference2d.cellGapPx).slotInset;
          const radius = Math.max(3, grid.cell * 0.05);
          roundedRect(context, x + inset, y + inset, grid.cell - inset * 2, grid.cell - inset * 2, radius);
          context.fillStyle = slotGradient;
          context.fill();
        } else {
          roundedRect(context, x, y, grid.cell, grid.cell, wellRadius);
          context.fillStyle = slotGradient;
          context.fill();
          context.strokeStyle = board.slotEdge;
          context.lineWidth = 2;
          context.stroke();
        }
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
          if (this.isBlastLook()) {
            // 白闪阶段(progress 0~0.22): 原块微放大 + 白色叠加, 之后由爆裂复制体接管
            const flash = Math.sin(clamp01(clearing.progress / 0.22) * Math.PI);
            if (flash > 0.01 && this.pass('clear')) {
              this.drawBoardTile(row, col, color, 1, 1 + flash * 0.06);
              const cellGrid = REFERENCE_LAYOUT.board.grid;
              const gx = cellGrid.x + col * cellGrid.pitch;
              const gy = cellGrid.y + row * cellGrid.pitch;
              context.save();
              context.globalCompositeOperation = 'lighter';
              context.globalAlpha = flash * 0.9;
              context.fillStyle = '#ffffff';
              roundedRect(context, gx - 1, gy - 1, cellGrid.cell + 2, cellGrid.cell + 2, 6);
              context.fill();
              context.restore();
            }
            continue;
          }
          const dissolve = clamp01((clearing.progress - 0.34) / 0.42);
          alpha = 1 - dissolve;
          scale = 1 - dissolve * 0.2;
        }
        this.drawBoardTile(row, col, color, alpha, scale);
      }
    }

    if (clearing && !this.isBlastLook()) {
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
    this.drawTile(x, y, materialCellMetrics(this.style?.reference2d.cellGapPx).boardSize, color, alpha, scale, true, { row, col });
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
    const context = this.ctx;
    const palette = this.tilePalette(color);
    const drawSize = size * scale;
    const x = centerX - drawSize / 2;
    const y = centerY - drawSize / 2;
    const candyBlast = this.style.reference2d.tileMaterial === 'candy-blast';
    const radius = candyBlast ? Math.max(1.2, drawSize * 0.055) : Math.max(4, drawSize * 0.075);
    context.save();
    context.globalAlpha = clamp01(alpha);
    if (candyBlast) {
      const materialFace = this.runtimeAssets.tileFace ? materialFaceSwatch(this.style.reference2d.materialTheme) : undefined;
      paintCandyBlastTile(context, x, y, drawSize, materialFace ?? BLAST_FACE_PALETTE[color]);
    } else {
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
    }

    const tileFaceBinding = this.runtimeAssets.tileFace;
    const tileFaceImage = this.runtimeImages.tileFace;
    const atlasBinding = this.runtimeAssets.boardAtlas;
    const atlasImage = this.runtimeImages.boardAtlas;
    const atlasSource = atlasCell && this.frame && atlasBinding && atlasImage
      ? boardAtlasCellSourceRect({
        imageWidth: Math.max(1, atlasImage.naturalWidth || atlasBinding.width || 1),
        imageHeight: Math.max(1, atlasImage.naturalHeight || atlasBinding.height || 1),
        rows: this.frame.board.rows,
        cols: this.frame.board.cols,
        row: atlasCell.row,
        col: atlasCell.col,
        fit: atlasBinding.fit,
      })
      : null;
    if (motif && atlasSource && atlasBinding && atlasImage) {
      const inset = drawSize * atlasBinding.inset;
      const destX = x + inset;
      const destY = y + inset;
      const destSize = Math.max(1, drawSize - inset * 2);
      context.save();
      roundedRect(
        context,
        destX,
        destY,
        destSize,
        destSize,
        Math.max(2, radius - inset * 0.35),
      );
      context.clip();
      context.globalAlpha *= atlasBinding.opacity;
      context.globalCompositeOperation = atlasBinding.blendMode;
      context.drawImage(
        atlasImage,
        atlasSource.sx,
        atlasSource.sy,
        atlasSource.sw,
        atlasSource.sh,
        destX,
        destY,
        destSize,
        destSize,
      );
      context.restore();
    } else if (tileFaceBinding && tileFaceImage) {
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
    } else if (motif && !candyBlast && this.style.reference2d.tileFaceSet === 'botanical-reference') {
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
        this.drawTile(x, y, materialCellMetrics(this.style?.reference2d.cellGapPx).rackSize, pieceCellColor(piece, index), 1, 1, true);
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
    const { piece, pointer, progress } = active;
    const shape = getShape(piece.shapeId);
    const bounds = getShapeBounds(shape);
    const hover = pointer
      ? boardAnchorFromNormalizedPointer(pointer, bounds)
      : active.anchor && active.anchor.row >= 0
        ? active.anchor
        : null;
    const preview = hover ? previewFor(this.frame.snapshot, piece, hover) : null;

    if (preview && hover) {
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
    const gridCenter = hover ? boardPieceCenterPx(hover, bounds) : null;
    let centerX: number;
    let centerY: number;
    if (pointerReference) {
      centerX = pointerReference.x;
      centerY = pointerReference.y;
    } else if (gridCenter) {
      centerX = gridCenter.x;
      centerY = gridCenter.y;
    } else {
      centerX = REFERENCE_LAYOUT.rack.centersX[piece.slotIndex] ?? REFERENCE_CANVAS.width / 2;
      centerY = REFERENCE_LAYOUT.rack.centerY;
    }

    const pickupProgress = easeOutCubic(Math.min(1, progress / 0.25));
    const metrics = materialCellMetrics(this.style.reference2d.cellGapPx, pickupProgress);
    const tileSize = metrics.dragSize;
    const alpha = hover && !canPlace(this.frame.snapshot.board, piece, hover) ? 0.58 : 0.98;
    for (const [[row, col], index] of shape.cells.map((cell, cellIndex) => [cell, cellIndex] as const)) {
      const x = centerX + (col - (bounds.cols - 1) / 2) * metrics.dragPitch;
      const y = centerY + (row - (bounds.rows - 1) / 2) * metrics.dragPitch;
      this.drawTile(x, y, tileSize, pieceCellColor(piece, index), alpha, 1, true);
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
      this.drawTile(x + grid.cell / 2, y + grid.cell / 2,
        materialCellMetrics(this.style?.reference2d.cellGapPx).boardSize, color, alpha, 1, true, { row, col });
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

  private drawBlastClearFx(clearing: ClearingFrame, seconds: number): void {
    if (!this.frame || !this.style) return;
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const grid = REFERENCE_LAYOUT.board.grid;
    const outer = REFERENCE_LAYOUT.board.outer;
    const boardSpan = grid.pitch * 8 - grid.gap;
    const combo = this.frame.snapshot.combo;
    const lineCount = clearing.clear.rows.length + clearing.clear.cols.length;
    const lineFlash = Math.sin(clamp01(progress / 0.55) * Math.PI);
    const sweepProgress = clamp01(progress / 0.42);
    const intensity = 1 + Math.min(1.2, combo * 0.12 + Math.max(0, lineCount - 1) * 0.3);
    const impact = Math.max(0, 1 - progress / 0.16);

    // ---- 全屏光爆(可选: screenFx 含 clear-bloom, 径向光爆 + 旋转光束, 加法) ----
    const screenFx = this.style.reference2d.screenFx;
    if (screenFx === 'clear-bloom' || screenFx === 'edge-glow+clear-bloom') {
      const bloomEnv = clamp01(progress / 0.10) * (1 - clamp01((progress - 0.55) / 0.40));
      if (bloomEnv > 0.01) {
        const cx = REFERENCE_CANVAS.width / 2;
        const cy = outer.y + outer.size * 0.45;
        context.save();
        context.globalCompositeOperation = 'lighter';
        const radius = REFERENCE_CANVAS.width * 1.15;
        const core = Math.min(1, 0.5 * intensity) * bloomEnv;
        const bloom = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
        bloom.addColorStop(0, `rgba(255, 250, 232, ${core})`);
        bloom.addColorStop(0.35, `rgba(190, 220, 255, ${core * 0.55})`);
        bloom.addColorStop(1, 'rgba(120, 160, 255, 0)');
        context.fillStyle = bloom;
        context.fillRect(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);
        const rayCount = 12;
        const rayLen = radius * 1.15;
        const spin = seconds * 0.7;
        for (let i = 0; i < rayCount; i += 1) {
          const a0 = (i / rayCount) * TWO_PI + spin;
          const width = 0.045 + (i % 2) * 0.02;
          const twinkle = 0.5 + 0.5 * Math.sin(seconds * 3 + i * 1.9);
          context.fillStyle = `rgba(255, 245, 215, ${0.1 * bloomEnv * (0.4 + 0.6 * twinkle) * intensity})`;
          context.beginPath();
          context.moveTo(cx, cy);
          context.arc(cx, cy, rayLen, a0 - width, a0 + width);
          context.closePath();
          context.fill();
        }
        context.restore();
      }
    }

    // ---- 棋盘压暗(光带与文字的衬底) ----
    const dim = Math.sin(clamp01((progress - 0.05) / 0.95) * Math.PI) * 0.22;
    if (dim > 0.01) {
      context.save();
      roundedRect(context, outer.x, outer.y, outer.size, outer.size, outer.radius);
      context.fillStyle = `rgba(7, 9, 30, ${dim})`;
      context.fill();
      context.restore();
    }

    if (impact > 0) {
      context.save();
      roundedRect(
        context,
        outer.x,
        outer.y,
        outer.size,
        outer.size,
        outer.radius,
      );
      context.fillStyle = `rgba(255,255,255,${0.28 * impact * intensity})`;
      context.fill();
      context.restore();
    }

    // ---- 彩虹光带: 全宽彩虹渐变(加法) + 扫光 + 镜头光斑 ----
    const bandAlpha = clamp01(progress / 0.08) * (1 - clamp01((progress - 0.58) / 0.34));
    if (bandAlpha > 0.01) {
      context.save();
      roundedRect(context, outer.x, outer.y, outer.size, outer.size, outer.radius);
      context.clip();
      context.globalCompositeOperation = 'lighter';
      const glow = Math.min(1, 0.6 * intensity) * bandAlpha;
      for (const row of clearing.clear.rows) {
        const y = grid.y + row * grid.pitch + grid.cell / 2;
        const bandH = grid.cell * 1.26;
        context.fillStyle = rainbowGradient(context, grid.x - 12, y, grid.x + boardSpan + 12, y, glow * 0.85);
        roundedRect(context, grid.x - 12, y - bandH / 2, boardSpan + 24, bandH, bandH / 2);
        context.fill();
        const sx = grid.x - 60 + (boardSpan + 120) * sweepProgress;
        const core = context.createRadialGradient(sx, y, 0, sx, y, bandH * 1.5);
        core.addColorStop(0, `rgba(255,255,255,${0.85 * bandAlpha})`);
        core.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = core;
        context.fillRect(grid.x - 12, y - bandH, boardSpan + 24, bandH * 2);
        // 镜头光斑(横竖十字亮斑, 带闪烁)
        for (let f = 0; f < 2; f += 1) {
          const fx = grid.x + boardSpan * (f === 0 ? 0.28 : 0.74);
          const twinkle = 0.55 + 0.45 * Math.sin(seconds * 16 + f * 2.1 + row);
          const fs = grid.cell * (0.52 + 0.1 * f);
          context.globalAlpha = bandAlpha * twinkle;
          context.fillStyle = '#ffffff';
          context.beginPath();
          context.ellipse(fx, y, fs * 1.9, fs * 0.15, 0, 0, TWO_PI);
          context.fill();
          context.beginPath();
          context.ellipse(fx, y, fs * 0.15, fs * 0.95, 0, 0, TWO_PI);
          context.fill();
          context.globalAlpha = 1;
        }
        // 金色描边脉动
        context.strokeStyle = `rgba(255,255,210,${0.65 * lineFlash})`;
        context.lineWidth = 6 + 5 * lineFlash;
        context.shadowColor = '#fff6a0';
        context.shadowBlur = 22;
        roundedRect(context, grid.x - 2, y - grid.cell / 2 - 4, boardSpan + 4, grid.cell + 8, 8);
        context.stroke();
        context.shadowBlur = 0;
      }
      for (const col of clearing.clear.cols) {
        const x = grid.x + col * grid.pitch + grid.cell / 2;
        const bandW = grid.cell * 1.26;
        context.fillStyle = rainbowGradient(context, x, grid.y - 12, x, grid.y + boardSpan + 12, glow * 0.85);
        roundedRect(context, x - bandW / 2, grid.y - 12, bandW, boardSpan + 24, bandW / 2);
        context.fill();
        const sy = grid.y - 60 + (boardSpan + 120) * sweepProgress;
        const core = context.createRadialGradient(x, sy, 0, x, sy, bandW * 1.5);
        core.addColorStop(0, `rgba(255,255,255,${0.85 * bandAlpha})`);
        core.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = core;
        context.fillRect(x - bandW, grid.y - 12, bandW * 2, boardSpan + 24);
        context.strokeStyle = `rgba(255,255,210,${0.65 * lineFlash})`;
        context.lineWidth = 6 + 5 * lineFlash;
        context.shadowColor = '#fff6a0';
        context.shadowBlur = 22;
        roundedRect(context, x - grid.cell / 2 - 4, grid.y - 2, grid.cell + 8, boardSpan + 4, 8);
        context.stroke();
        context.shadowBlur = 0;
      }
      context.restore();
    }

    // ---- 冲击扩散环 ----
    context.save();
    roundedRect(context, outer.x, outer.y, outer.size, outer.size, outer.radius);
    context.clip();
    context.globalCompositeOperation = 'lighter';
    const ring = easeOutCubic(progress);
    context.strokeStyle = `rgba(255,255,255,${0.45 * (1 - progress)})`;
    context.lineWidth = 10 * (1 - ring * 0.55);
    context.shadowColor = '#ffe56a';
    context.shadowBlur = 18;
    for (const row of clearing.clear.rows) {
      const y = grid.y + row * grid.pitch + grid.cell / 2;
      const grow = 20 + ring * 70;
      roundedRect(context, grid.x - grow, y - grid.cell / 2 - 10, boardSpan + grow * 2, grid.cell + 20, 16);
      context.stroke();
    }
    context.restore();

    // ---- 爆裂复制体 + 碎片 ----
    const copies = combo >= 3 || lineCount >= 2 ? 3 : 2;
    for (const [index, cell] of clearing.clear.cells.entries()) {
      for (let copy = 0; copy < copies; copy += 1) {
        const pose = blastBurstPose(cell, clearing.clear, progress, clearing.seed, index, copy);
        if (pose.alpha <= 0.02) continue;
        const cx = grid.x + cell.col * grid.pitch + grid.cell / 2 + pose.dx;
        const cy = grid.y + cell.row * grid.pitch + grid.cell / 2 + pose.dy;
        const palette = this.tilePalette(cell.color);
        context.save();
        context.translate(cx, cy);
        context.rotate(pose.rotation);
        context.beginPath();
        context.arc(0, 0, grid.cell * 0.58, 0, TWO_PI);
        context.fillStyle = colorWithAlpha(palette.glow, 0.38 * pose.alpha);
        context.fill();
        this.drawTile(0, 0, grid.cell, cell.color, pose.alpha * (copy === 0 ? 1 : 0.7), pose.scale, copy === 0);
        context.restore();
      }

      const shardCount = 4;
      for (let shard = 0; shard < shardCount; shard += 1) {
        const local = clamp01((progress - shard * 0.03) / 0.85);
        if (local <= 0) continue;
        const fly = burstTravel(local);
        const angle = seededFloat(hash32(clearing.seed + index * 17 + shard * 9), shard) * TWO_PI;
        const dist = (40 + seededFloat(hash32(clearing.seed + shard * 23), index) * 130) * fly;
        const size = grid.cell * (0.11 + seededFloat(hash32(clearing.seed + 3), index + shard) * 0.15);
        const originX = grid.x + cell.col * grid.pitch + grid.cell / 2;
        const originY = grid.y + cell.row * grid.pitch + grid.cell / 2;
        const sx = originX + Math.cos(angle) * dist;
        const sy = originY + Math.sin(angle) * dist - local * 46;
        context.save();
        context.translate(sx, sy);
        context.rotate(angle + local * 5);
        this.drawTile(0, 0, size, cell.color, (1 - local) * 0.9, 1, false);
        context.restore();
      }
    }

    // ---- 余烬上升(combo>=2, 橙色光点, 加法) ----
    if (combo >= 2) {
      context.save();
      context.globalCompositeOperation = 'lighter';
      const emberCount = Math.min(44, Math.round(16 * intensity));
      for (let index = 0; index < emberCount; index += 1) {
        const cell = clearing.clear.cells[index % clearing.clear.cells.length]!;
        const born = seededFloat(hash32(clearing.seed + index * 7), index) * 0.3;
        const local = clamp01((progress - 0.06 - born) / 0.8);
        if (local <= 0 || local >= 1) continue;
        const jitterX = (seededFloat(hash32(clearing.seed + index * 13), index + 2) - 0.5) * grid.cell * 1.6;
        const sway = Math.sin(local * 7 + index) * 9 * local;
        const ex = grid.x + cell.col * grid.pitch + grid.cell / 2 + jitterX + sway;
        const ey = grid.y + cell.row * grid.pitch + grid.cell / 2
          - local * (150 + seededFloat(hash32(clearing.seed + index), index) * 130);
        const alpha = Math.sin(local * Math.PI) * 0.9;
        const radius = 1.6 + seededFloat(hash32(clearing.seed + index * 3), index) * 2.6;
        context.globalAlpha = alpha;
        context.fillStyle = index % 3 === 0 ? '#ff6a20' : '#ffa030';
        context.beginPath();
        context.arc(ex, ey, radius * (1 - local * 0.5), 0, TWO_PI);
        context.fill();
      }
      context.restore();
    }

    this.drawBlastSparks(clearing, seconds, intensity);
    this.drawBlastFloatScores(clearing);
    this.drawBlastConfetti(clearing, seconds, intensity);
  }

  /** 变体共用: 棋盘压暗。 */
  private drawFxBoardDim(progress: number, strength = 0.2): void {
    const outer = REFERENCE_LAYOUT.board.outer;
    const dim = Math.sin(clamp01((progress - 0.05) / 0.95) * Math.PI) * strength;
    if (dim <= 0.01) return;
    const context = this.ctx;
    context.save();
    roundedRect(context, outer.x, outer.y, outer.size, outer.size, outer.radius);
    context.fillStyle = `rgba(7, 9, 30, ${dim})`;
    context.fill();
    context.restore();
  }

  /** 像素爆裂: 方块碎成 3x3 像素块向外飞溅+重力下坠, 黄白扫描条+像素冲击波, 复古街机感。 */
  private drawPixelBurstFx(clearing: ClearingFrame, seconds: number): void {
    if (!this.frame || !this.style) return;
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const grid = REFERENCE_LAYOUT.board.grid;
    const outer = REFERENCE_LAYOUT.board.outer;
    const boardSpan = grid.pitch * 8 - grid.gap;
    const combo = this.frame.snapshot.combo;
    const lineCount = clearing.clear.rows.length + clearing.clear.cols.length;
    const intensity = 1 + Math.min(1.2, combo * 0.12 + Math.max(0, lineCount - 1) * 0.3);
    this.drawFxBoardDim(progress);

    const scan = easeOutCubic(clamp01(progress / 0.3));
    const flashA = Math.sin(clamp01(progress / 0.55) * Math.PI);
    // 黄白扫描条(扫过区域留亮底)
    context.save();
    roundedRect(context, outer.x, outer.y, outer.size, outer.size, outer.radius);
    context.clip();
    context.globalCompositeOperation = 'lighter';
    for (const row of clearing.clear.rows) {
      const y = grid.y + row * grid.pitch + grid.cell / 2;
      const sweepX = grid.x + boardSpan * scan;
      context.fillStyle = `rgba(255, 235, 130, ${0.32 * flashA})`;
      context.fillRect(grid.x - 4, y - grid.cell * 0.62, sweepX - grid.x + 4, grid.cell * 1.24);
      const head = context.createLinearGradient(sweepX - 90, y, sweepX, y);
      head.addColorStop(0, 'rgba(255,255,255,0)');
      head.addColorStop(1, `rgba(255,255,255,${0.9 * flashA})`);
      context.fillStyle = head;
      context.fillRect(sweepX - 90, y - grid.cell * 0.62, 92, grid.cell * 1.24);
    }
    for (const col of clearing.clear.cols) {
      const x = grid.x + col * grid.pitch + grid.cell / 2;
      const sweepY = grid.y + boardSpan * scan;
      context.fillStyle = `rgba(255, 235, 130, ${0.32 * flashA})`;
      context.fillRect(x - grid.cell * 0.62, grid.y - 4, grid.cell * 1.24, sweepY - grid.y + 4);
      const head = context.createLinearGradient(x, sweepY - 90, x, sweepY);
      head.addColorStop(0, 'rgba(255,255,255,0)');
      head.addColorStop(1, `rgba(255,255,255,${0.9 * flashA})`);
      context.fillStyle = head;
      context.fillRect(x - grid.cell * 0.62, sweepY - 90, grid.cell * 1.24, 92);
    }
    // 像素冲击波(虚线方波扩张)
    const wave = easeOutCubic(clamp01(progress / 0.8));
    if (wave > 0.02 && wave < 1) {
      const w = 40 + wave * boardSpan;
      context.setLineDash([12, 8]);
      context.strokeStyle = `rgba(255, 255, 190, ${0.55 * (1 - wave)})`;
      context.lineWidth = 6 * (1 - wave) + 2;
      for (const row of clearing.clear.rows) {
        const y = grid.y + row * grid.pitch + grid.cell / 2;
        context.strokeRect(grid.x + (boardSpan - w) / 2, y - w * 0.12, w, w * 0.24);
      }
      context.setLineDash([]);
    }
    context.restore();

    // 像素碎块: 每格 3x3, 向外飞溅 + 重力
    for (const [index, cell] of clearing.clear.cells.entries()) {
      const originX = grid.x + cell.col * grid.pitch;
      const originY = grid.y + cell.row * grid.pitch;
      const mini = grid.cell / 3 - 2;
      const palette = this.tilePalette(cell.color);
      for (let gy = 0; gy < 3; gy += 1) {
        for (let gx = 0; gx < 3; gx += 1) {
          const seedBase = clearing.seed + index * 91 + (gy * 3 + gx) * 17;
          const born = seededFloat(hash32(seedBase), 3) * 0.08;
          const local = clamp01((progress - born) / 0.8);
          if (local <= 0) continue;
          const angle = Math.atan2(gy - 1, gx - 1) + (seededFloat(hash32(seedBase), 5) - 0.5) * 1.1;
          const speed = 90 + seededFloat(hash32(seedBase), 7) * 260 * intensity;
          const fly = burstTravel(local);
          const px = originX + (gx + 0.5) * (grid.cell / 3) + Math.cos(angle) * speed * fly;
          const py = originY + (gy + 0.5) * (grid.cell / 3) + Math.sin(angle) * speed * fly + local * local * 170;
          const alpha = 1 - clamp01((local - 0.55) / 0.45);
          if (alpha <= 0.02) continue;
          context.save();
          context.globalAlpha = alpha;
          context.fillStyle = (gy === 0 ? palette.top : gy === 2 ? palette.bottom : palette.base);
          context.fillRect(px - mini / 2, py - mini / 2, mini, mini);
          context.restore();
        }
      }
    }

    this.drawBlastSparks(clearing, seconds, intensity);
    this.drawBlastFloatScores(clearing);
  }

  /** 激光切割: 蓝白激光束扫过, 方块被切成上下两半滑开, 切缝辉光 + 锯齿电弧。 */
  private drawLaserSliceFx(clearing: ClearingFrame, seconds: number): void {
    if (!this.frame || !this.style) return;
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const grid = REFERENCE_LAYOUT.board.grid;
    const outer = REFERENCE_LAYOUT.board.outer;
    const boardSpan = grid.pitch * 8 - grid.gap;
    this.drawFxBoardDim(progress, 0.16);

    // 方块切半滑开
    const split = easeOutCubic(clamp01((progress - 0.1) / 0.5));
    for (const cell of clearing.clear.cells) {
      const x = grid.x + cell.col * grid.pitch + grid.cell / 2;
      const y = grid.y + cell.row * grid.pitch + grid.cell / 2;
      const gap = split * grid.cell * 0.32;
      const alpha = 1 - clamp01((progress - 0.55) / 0.4);
      if (alpha <= 0.02) continue;
      context.save();
      context.beginPath();
      context.rect(x - grid.cell / 2 - 2, y - grid.cell / 2 - gap - 2, grid.cell + 4, grid.cell / 2);
      context.clip();
      this.drawTile(x, y - gap, grid.cell, cell.color, alpha, 1, false);
      context.restore();
      context.save();
      context.beginPath();
      context.rect(x - grid.cell / 2 - 2, y + gap, grid.cell + 4, grid.cell / 2 + 2);
      context.clip();
      this.drawTile(x, y + gap, grid.cell, cell.color, alpha, 1, false);
      context.restore();
      if (split > 0.02) {
        context.save();
        context.globalCompositeOperation = 'lighter';
        context.fillStyle = `rgba(160, 230, 255, ${0.75 * alpha * Math.min(1, split * 2)})`;
        context.fillRect(x - grid.cell / 2 - 3, y - gap - 3, grid.cell + 6, gap * 2 + 6);
        context.restore();
      }
    }

    // 激光束(0.02~0.4 快速扫过)
    const beamP = clamp01((progress - 0.02) / 0.38);
    if (beamP > 0 && beamP < 1) {
      context.save();
      roundedRect(context, outer.x, outer.y, outer.size, outer.size, outer.radius);
      context.clip();
      context.globalCompositeOperation = 'lighter';
      for (const row of clearing.clear.rows) {
        const y = grid.y + row * grid.pitch + grid.cell / 2;
        const bx = grid.x - 20 + (boardSpan + 40) * beamP;
        const halo = context.createLinearGradient(bx - 26, 0, bx + 26, 0);
        halo.addColorStop(0, 'rgba(90,200,255,0)');
        halo.addColorStop(0.5, 'rgba(160,225,255,0.75)');
        halo.addColorStop(1, 'rgba(90,200,255,0)');
        context.fillStyle = halo;
        context.fillRect(bx - 26, y - grid.cell * 0.7, 52, grid.cell * 1.4);
        context.fillStyle = 'rgba(255,255,255,0.95)';
        context.fillRect(bx - 3, y - grid.cell * 0.7, 6, grid.cell * 1.4);
        context.beginPath();
        context.ellipse(bx, y, 30, 7, 0, 0, TWO_PI);
        context.fill();
      }
      for (const col of clearing.clear.cols) {
        const x = grid.x + col * grid.pitch + grid.cell / 2;
        const by = grid.y - 20 + (boardSpan + 40) * beamP;
        const halo = context.createLinearGradient(0, by - 26, 0, by + 26);
        halo.addColorStop(0, 'rgba(90,200,255,0)');
        halo.addColorStop(0.5, 'rgba(160,225,255,0.75)');
        halo.addColorStop(1, 'rgba(90,200,255,0)');
        context.fillStyle = halo;
        context.fillRect(x - grid.cell * 0.7, by - 26, grid.cell * 1.4, 52);
        context.fillStyle = 'rgba(255,255,255,0.95)';
        context.fillRect(x - grid.cell * 0.7, by - 3, grid.cell * 1.4, 6);
        context.beginPath();
        context.ellipse(x, by, 7, 30, 0, 0, TWO_PI);
        context.fill();
      }
      context.restore();
    }

    // 锯齿电弧(0.1~0.6 沿消行闪烁)
    const arcA = Math.sin(clamp01((progress - 0.1) / 0.5) * Math.PI);
    if (arcA > 0.02) {
      context.save();
      context.globalCompositeOperation = 'lighter';
      context.strokeStyle = `rgba(190, 235, 255, ${0.85 * arcA})`;
      context.lineWidth = 3;
      context.shadowColor = '#7fd0ff';
      context.shadowBlur = 8;
      const phase = Math.floor(seconds * 24);
      for (const row of clearing.clear.rows) {
        const y = grid.y + row * grid.pitch + grid.cell / 2;
        context.beginPath();
        const steps = 24;
        for (let i = 0; i <= steps; i += 1) {
          const x = grid.x + (boardSpan * i) / steps;
          const jitter = (seededFloat(hash32(clearing.seed + i * 13 + row * 7 + phase * 3), i) - 0.5) * 26 * arcA;
          if (i === 0) context.moveTo(x, y + jitter);
          else context.lineTo(x, y + jitter);
        }
        context.stroke();
      }
      for (const col of clearing.clear.cols) {
        const x = grid.x + col * grid.pitch + grid.cell / 2;
        context.beginPath();
        const steps = 24;
        for (let i = 0; i <= steps; i += 1) {
          const y = grid.y + (boardSpan * i) / steps;
          const jitter = (seededFloat(hash32(clearing.seed + i * 13 + col * 7 + phase * 3), i) - 0.5) * 26 * arcA;
          if (i === 0) context.moveTo(x + jitter, y);
          else context.lineTo(x + jitter, y);
        }
        context.stroke();
      }
      context.restore();
    }

    this.drawBlastFloatScores(clearing);
  }

  /** 火焰冲击: 红橙火墙扫过(顶部火苗), 方块烧红收缩, 重余烬与黑烟。 */
  private drawFireWaveFx(clearing: ClearingFrame, seconds: number): void {
    if (!this.frame || !this.style) return;
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const grid = REFERENCE_LAYOUT.board.grid;
    const outer = REFERENCE_LAYOUT.board.outer;
    const boardSpan = grid.pitch * 8 - grid.gap;
    const combo = this.frame.snapshot.combo;
    const lineCount = clearing.clear.rows.length + clearing.clear.cols.length;
    const intensity = 1 + Math.min(1.2, combo * 0.12 + Math.max(0, lineCount - 1) * 0.3);
    this.drawFxBoardDim(progress, 0.18);

    // 火墙
    const sweep = clamp01(progress / 0.45);
    const fireA = clamp01(progress / 0.08) * (1 - clamp01((progress - 0.6) / 0.35));
    if (fireA > 0.01) {
      context.save();
      roundedRect(context, outer.x, outer.y, outer.size, outer.size, outer.radius);
      context.clip();
      context.globalCompositeOperation = 'lighter';
      for (const row of clearing.clear.rows) {
        const y = grid.y + row * grid.pitch + grid.cell / 2;
        const fx0 = grid.x - 40;
        const fx1 = grid.x + (boardSpan + 80) * sweep;
        const wall = context.createLinearGradient(fx1 - 240, y, fx1, y);
        wall.addColorStop(0, 'rgba(255,60,10,0)');
        wall.addColorStop(0.6, `rgba(255,90,15,${0.5 * fireA})`);
        wall.addColorStop(1, `rgba(255,220,90,${0.85 * fireA})`);
        context.fillStyle = wall;
        context.fillRect(fx0, y - grid.cell * 0.75, fx1 - fx0, grid.cell * 1.5);
        context.fillStyle = `rgba(255, 120, 20, ${0.5 * fireA})`;
        context.beginPath();
        context.moveTo(fx0, y - grid.cell * 0.75);
        const steps = 26;
        for (let i = 0; i <= steps; i += 1) {
          const x = fx0 + ((fx1 - fx0) * i) / steps;
          const flame = (Math.sin(i * 1.7 + seconds * 14 + row) * 0.5 + 0.5) * grid.cell * 0.5;
          context.lineTo(x, y - grid.cell * 0.75 - flame);
        }
        context.lineTo(fx1, y - grid.cell * 0.75);
        context.closePath();
        context.fill();
      }
      for (const col of clearing.clear.cols) {
        const x = grid.x + col * grid.pitch + grid.cell / 2;
        const fy0 = grid.y - 40;
        const fy1 = grid.y + (boardSpan + 80) * sweep;
        const wall = context.createLinearGradient(x, fy1 - 240, x, fy1);
        wall.addColorStop(0, 'rgba(255,60,10,0)');
        wall.addColorStop(0.6, `rgba(255,90,15,${0.5 * fireA})`);
        wall.addColorStop(1, `rgba(255,220,90,${0.85 * fireA})`);
        context.fillStyle = wall;
        context.fillRect(x - grid.cell * 0.75, fy0, grid.cell * 1.5, fy1 - fy0);
      }
      context.restore();
    }

    // 方块烧红收缩
    for (const cell of clearing.clear.cells) {
      const cx = grid.x + cell.col * grid.pitch + grid.cell / 2;
      const cy = grid.y + cell.row * grid.pitch + grid.cell / 2;
      const burn = clamp01((progress - 0.06) / 0.55);
      const alpha = 1 - clamp01((progress - 0.5) / 0.45);
      if (alpha <= 0.02) continue;
      this.drawTile(cx, cy, grid.cell, cell.color, alpha, 1 - burn * 0.45, false);
      context.save();
      context.globalCompositeOperation = 'lighter';
      context.globalAlpha = alpha * (0.8 - burn * 0.35);
      const heat = context.createRadialGradient(cx, cy, 2, cx, cy, grid.cell * 0.7);
      heat.addColorStop(0, 'rgba(255,230,140,0.95)');
      heat.addColorStop(0.5, 'rgba(255,90,20,0.55)');
      heat.addColorStop(1, 'rgba(120,20,0,0)');
      context.fillStyle = heat;
      context.beginPath();
      context.arc(cx, cy, grid.cell * 0.7, 0, TWO_PI);
      context.fill();
      context.restore();
    }

    // 重余烬 + 黑烟
    context.save();
    context.globalCompositeOperation = 'lighter';
    const emberCount = Math.min(60, Math.round(26 * intensity));
    for (let index = 0; index < emberCount; index += 1) {
      const cell = clearing.clear.cells[index % clearing.clear.cells.length]!;
      const born = seededFloat(hash32(clearing.seed + index * 7), index) * 0.28;
      const local = clamp01((progress - 0.05 - born) / 0.85);
      if (local <= 0 || local >= 1) continue;
      const jitterX = (seededFloat(hash32(clearing.seed + index * 13), index + 2) - 0.5) * grid.cell * 1.5;
      const sway = Math.sin(local * 7 + index) * 10 * local;
      const ex = grid.x + cell.col * grid.pitch + grid.cell / 2 + jitterX + sway;
      const ey = grid.y + cell.row * grid.pitch + grid.cell / 2
        - local * (170 + seededFloat(hash32(clearing.seed + index), index) * 150);
      context.globalAlpha = Math.sin(local * Math.PI) * 0.9;
      const radius = 1.8 + seededFloat(hash32(clearing.seed + index * 3), index) * 3;
      context.fillStyle = index % 4 === 0 ? '#ffd040' : index % 3 === 0 ? '#ff6a20' : '#ffa030';
      context.beginPath();
      context.arc(ex, ey, radius * (1 - local * 0.5), 0, TWO_PI);
      context.fill();
    }
    context.restore();
    for (let index = 0; index < 12; index += 1) {
      const cell = clearing.clear.cells[index % clearing.clear.cells.length]!;
      const local = clamp01((progress - 0.4 - index * 0.02) / 0.6);
      if (local <= 0 || local >= 1) continue;
      const ex = grid.x + cell.col * grid.pitch + grid.cell / 2 + (seededFloat(hash32(clearing.seed + index), index) - 0.5) * 40;
      const ey = grid.y + cell.row * grid.pitch + grid.cell / 2 - local * 130;
      context.save();
      context.globalAlpha = (1 - local) * 0.3;
      context.fillStyle = '#3a3a44';
      context.beginPath();
      context.arc(ex, ey, 4 + local * 6, 0, TWO_PI);
      context.fill();
      context.restore();
    }

    this.drawBlastFloatScores(clearing);
    this.drawBlastConfetti(clearing, seconds, intensity);
  }

  /** 闪电链: 紫白锯齿闪电按序连接消除格, 链式引爆白爆, 紫色火花。 */
  private drawLightningChainFx(clearing: ClearingFrame, seconds: number): void {
    if (!this.frame || !this.style) return;
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const grid = REFERENCE_LAYOUT.board.grid;
    this.drawFxBoardDim(progress, 0.16);

    const cells = [...clearing.clear.cells].sort((a, b) => a.row - b.row || a.col - b.col);
    const centers = cells.map((cell) => ({
      x: grid.x + cell.col * grid.pitch + grid.cell / 2,
      y: grid.y + cell.row * grid.pitch + grid.cell / 2,
    }));
    const boltProgress = clamp01((progress - 0.04) / 0.5);

    // 命中格: 白爆 + 弹缩消失
    const fadeAll = 1 - clamp01((progress - 0.62) / 0.3);
    for (const [index, cell] of cells.entries()) {
      const hitP = clamp01((boltProgress * cells.length - index) / 2);
      const gone = clamp01((progress - 0.45 - index * 0.008) / 0.4);
      const alpha = (1 - gone) * (hitP > 0 ? 1 : 0.4);
      if (alpha <= 0.02) continue;
      const pop = hitP > 0 ? easeOutBack(clamp01(hitP)) : 0;
      this.drawTile(centers[index]!.x, centers[index]!.y, grid.cell, cell.color, alpha, 0.65 + pop * 0.45, false);
      if (hitP > 0 && hitP < 1.8) {
        context.save();
        context.globalCompositeOperation = 'lighter';
        context.globalAlpha = Math.max(0, 0.9 - hitP * 0.5);
        context.fillStyle = '#ffffff';
        context.beginPath();
        context.arc(centers[index]!.x, centers[index]!.y, grid.cell * 0.6, 0, TWO_PI);
        context.fill();
        context.restore();
      }
    }

    // 链式闪电
    const links = Math.max(0, Math.min(centers.length - 1, Math.floor(centers.length * boltProgress)));
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (let i = 0; i < links; i += 1) {
      const a = centers[i]!;
      const b = centers[i + 1]!;
      const appear = clamp01((boltProgress * centers.length - i - 1) / 1.5);
      const alpha = Math.min(appear, fadeAll);
      if (alpha <= 0.02) continue;
      context.beginPath();
      context.moveTo(a.x, a.y);
      const segs = 7;
      for (let s = 1; s < segs; s += 1) {
        const t = s / segs;
        const nx = a.x + (b.x - a.x) * t + (seededFloat(hash32(clearing.seed + i * 31 + s * 7), s) - 0.5) * 30;
        const ny = a.y + (b.y - a.y) * t + (seededFloat(hash32(clearing.seed + i * 31 + s * 11), s + 2) - 0.5) * 30;
        context.lineTo(nx, ny);
      }
      context.lineTo(b.x, b.y);
      context.strokeStyle = `rgba(150, 90, 255, ${0.55 * alpha})`;
      context.lineWidth = 9;
      context.shadowColor = '#a060ff';
      context.shadowBlur = 14;
      context.stroke();
      context.strokeStyle = `rgba(255, 255, 255, ${0.9 * alpha})`;
      context.lineWidth = 2.5;
      context.shadowBlur = 6;
      context.stroke();
    }
    context.restore();

    // 紫色火花
    context.save();
    context.globalCompositeOperation = 'lighter';
    const sparkCount = Math.min(40, cells.length * 3);
    for (let index = 0; index < sparkCount; index += 1) {
      const center = centers[index % centers.length]!;
      const born = seededFloat(hash32(clearing.seed + index * 11), index) * 0.2;
      const local = clamp01((progress - 0.06 - born) / 0.7);
      if (local <= 0 || local >= 1) continue;
      const angle = seededFloat(hash32(clearing.seed + index * 31), index + 7) * TWO_PI;
      const dist = (30 + seededFloat(hash32(clearing.seed + index * 41), index + 3) * 160) * burstTravel(local);
      const x = center.x + Math.cos(angle) * dist;
      const y = center.y + Math.sin(angle) * dist - local * 40;
      const alpha = Math.sin(local * Math.PI) * 0.9;
      const size = 2 + seededFloat(clearing.seed + 19, index) * 5;
      context.globalAlpha = alpha;
      context.fillStyle = index % 3 === 0 ? '#ffffff' : index % 3 === 1 ? '#c89aff' : '#9a5cff';
      context.fillRect(x - size / 2, y - size / 2, size, size);
    }
    context.restore();

    this.drawBlastFloatScores(clearing);
  }

  private drawBlastSparks(clearing: ClearingFrame, seconds: number, intensity: number): void {
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const grid = REFERENCE_LAYOUT.board.grid;
    const colors = ['#fff46d', '#ffffff', '#ff9ad8', '#7ef7ff', '#ffd24a'];
    const count = Math.min(96, Math.round(clearing.clear.cells.length * 5 * intensity));
    for (let index = 0; index < count; index += 1) {
      const cell = clearing.clear.cells[index % clearing.clear.cells.length]!;
      const born = seededFloat(hash32(clearing.seed + index * 11), index) * 0.12;
      const local = clamp01((progress - born) / 0.75);
      if (local <= 0) continue;
      const angle = seededFloat(hash32(clearing.seed + index * 31), index + 7) * TWO_PI;
      const distance = (24 + seededFloat(hash32(clearing.seed + index * 41), index + 3) * 220) * burstTravel(local);
      const x = grid.x + cell.col * grid.pitch + grid.cell / 2 + Math.cos(angle) * distance;
      const y = grid.y + cell.row * grid.pitch + grid.cell / 2 + Math.sin(angle) * distance - local * 50;
      const alpha = Math.sin(Math.min(1, local * 1.2) * Math.PI) * 0.95;
      const size = 3 + seededFloat(clearing.seed + 19, index) * 9 * intensity;
      context.save();
      context.translate(x, y);
      context.rotate(angle + seconds * 3);
      context.globalAlpha = alpha;
      context.fillStyle = colors[index % colors.length]!;
      context.shadowColor = context.fillStyle;
      context.shadowBlur = 8;
      if (index % 3 === 0) {
        context.beginPath();
        for (let point = 0; point < 8; point += 1) {
          const radius = point % 2 === 0 ? size : size * 0.32;
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

  private drawBlastFloatScores(clearing: ClearingFrame): void {
    if (!this.frame) return;
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const grid = REFERENCE_LAYOUT.board.grid;
    const pop = this.frame.snapshot.combo >= 2 ? 9 : 5;
    for (const [index, cell] of clearing.clear.cells.entries()) {
      const start = (index % 8) * 0.03;
      const local = clamp01((progress - 0.08 - start) / 0.55);
      if (local <= 0 || local >= 1) continue;
      const x = grid.x + cell.col * grid.pitch + grid.cell / 2;
      const y = grid.y + cell.row * grid.pitch + grid.cell / 2 - local * 54;
      context.save();
      context.globalAlpha = Math.sin(local * Math.PI);
      context.translate(x, y);
      context.scale(0.82 + easeOutBack(Math.min(1, local * 1.6)) * 0.4, 0.82 + easeOutBack(Math.min(1, local * 1.6)) * 0.4);
      context.font = '900 34px "Arial Rounded MT Bold", sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineWidth = 6;
      context.strokeStyle = '#c45a12';
      context.strokeText(`+${pop}`, 0, 0);
      context.fillStyle = '#fff46d';
      context.shadowColor = 'rgba(255, 200, 40, 0.8)';
      context.shadowBlur = 10;
      context.fillText(`+${pop}`, 0, 0);
      context.restore();
    }
  }

  private drawBlastConfetti(clearing: ClearingFrame, seconds: number, intensity = 1): void {
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const seed = clearing.seed;
    const originX = REFERENCE_CANVAS.width / 2;
    const originY = REFERENCE_LAYOUT.board.outer.y + REFERENCE_LAYOUT.board.outer.size * 0.42;
    const count = Math.round((48 + Math.min(36, clearing.clear.cells.length * 2)) * intensity);
    for (let index = 0; index < count; index += 1) {
      const born = seededFloat(hash32(seed + index * 13), index) * 0.14;
      const local = clamp01((progress - born) / 0.86);
      if (local <= 0) continue;
      const fly = burstTravel(local);
      const angle = seededFloat(hash32(seed + index * 29), index + 5) * TWO_PI;
      const dist = (80 + seededFloat(hash32(seed + index * 31), index + 8) * 340) * fly;
      const x = originX + Math.cos(angle) * dist;
      const y = originY + Math.sin(angle) * dist * 0.72 - local * 48 + local * local * 110;
      const alpha = Math.sin(Math.min(1, local * 1.12) * Math.PI) * 0.98;
      const color = BLAST_CONFETTI[index % BLAST_CONFETTI.length]!;
      const kind = index % 5;
      context.save();
      context.translate(x, y);
      context.rotate(angle + seconds * (index % 2 === 0 ? 3.1 : -2.2) + local * 4);
      context.globalAlpha = alpha;
      context.fillStyle = color;
      context.strokeStyle = color;
      context.shadowColor = color;
      context.shadowBlur = 6;
      if (kind === 0) {
        context.lineWidth = 6;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(-20, 0);
        context.quadraticCurveTo(2, 16, 20, -8);
        context.stroke();
      } else if (kind === 1) {
        context.beginPath();
        context.moveTo(0, -13);
        context.lineTo(9, 0);
        context.lineTo(0, 13);
        context.lineTo(-9, 0);
        context.closePath();
        context.fill();
      } else if (kind === 2) {
        roundedRect(context, -8, -6, 16, 12, 2);
        context.fill();
      } else {
        context.fillRect(-6, -6, 12, 12);
      }
      context.restore();
    }
  }

  private drawClearFx(clearing: ClearingFrame, seconds: number): void {
    if (!this.frame || !this.style) return;
    if (this.isBlastLook()) {
      // candy-blast 特效库: 未指定/旧值时走默认霓虹爆裂
      switch (this.style.reference2d.clearFx) {
        case 'pixel-burst':
          this.drawPixelBurstFx(clearing, seconds);
          return;
        case 'laser-slice':
          this.drawLaserSliceFx(clearing, seconds);
          return;
        case 'fire-wave':
          this.drawFireWaveFx(clearing, seconds);
          return;
        case 'lightning-chain':
          this.drawLightningChainFx(clearing, seconds);
          return;
        default:
          this.drawBlastClearFx(clearing, seconds);
          return;
      }
    }
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

  private drawBlastPraise(clearing: ClearingFrame, seconds: number): void {
    if (!this.frame) return;
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const lineCount = clearing.clear.rows.length + clearing.clear.cols.length;
    const combo = this.frame.snapshot.combo;
    const showCombo = combo >= 2;
    const popIn = clamp01((progress - 0.05) / 0.16);
    const fadeOut = 1 - clamp01((progress - 0.76) / 0.24);
    const alpha = Math.min(popIn, fadeOut);
    if (alpha <= 0) return;

    const tier = blastPraiseTier(combo, lineCount);
    const praiseLabel: Record<BlastPraiseTierId, string> = {
      good: 'Good!',
      great: 'Great!',
      amazing: 'Amazing!',
      fantastic: 'Fantastic!',
      unbelievable: 'Unbelievable!',
    };
    praiseLabel[tier] = praiseWordLabel(this.frame.praiseWord ?? resolvePraiseWord(combo, lineCount, this.style?.reference2d.praiseWords));
    const praiseStroke: Record<BlastPraiseTierId, string> = {
      good: '#1c8a3c',
      great: '#e56f18',
      amazing: '#b24dd6',
      fantastic: '#ce4e8b',
      unbelievable: '#7756d8',
    };
    const praiseMid: Record<BlastPraiseTierId, string> = {
      good: '#b6ff5e',
      great: '#ffe95a',
      amazing: '#ff8ad8',
      fantastic: '#ff9ec8',
      unbelievable: '#c9a8ff',
    };

    const centerX = REFERENCE_CANVAS.width / 2;
    const centerY = REFERENCE_LAYOUT.board.outer.y + REFERENCE_LAYOUT.board.outer.size * 0.42;

    // ---- 彩虹光晕带(文字衬底, 加法, 呼吸脉动) ----
    context.save();
    context.globalCompositeOperation = 'lighter';
    const pulse = 0.5 + 0.16 * Math.sin(seconds * 9);
    context.fillStyle = rainbowGradient(
      context,
      centerX - 252,
      centerY,
      centerX + 252,
      centerY,
      alpha * pulse * (showCombo ? 0.62 : 0.42),
    );
    roundedRect(context, centerX - 252, centerY - 66, 504, 132, 66);
    context.fill();
    context.restore();

    const scale = 0.55 + easeOutBack(popIn) * 0.65;
    context.save();
    context.translate(centerX, centerY);
    context.rotate(-0.03);
    context.scale(scale, scale);
    context.globalAlpha = alpha;
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.miterLimit = 2;

    // ---- 评价词(Combo 上方 / 单 Combo 时居中) ----
    const praiseY = showCombo ? -118 : -8;
    context.textAlign = 'center';
    const praiseSize = tier === 'unbelievable' || tier === 'fantastic' ? 54 : 62;
    context.font = `italic 900 ${praiseSize}px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif`;
    context.lineWidth = 13;
    context.strokeStyle = '#ffffff';
    context.strokeText(praiseLabel[tier], 0, praiseY);
    context.lineWidth = 7;
    context.strokeStyle = praiseStroke[tier];
    context.strokeText(praiseLabel[tier], 0, praiseY);
    const praiseFill = context.createLinearGradient(0, praiseY - 36, 0, praiseY + 36);
    praiseFill.addColorStop(0, '#ffffff');
    praiseFill.addColorStop(0.55, praiseMid[tier]);
    praiseFill.addColorStop(1, praiseStroke[tier]);
    context.fillStyle = praiseFill;
    context.shadowColor = 'rgba(255, 200, 60, 0.6)';
    context.shadowBlur = 16;
    context.fillText(praiseLabel[tier], 0, praiseY);
    context.shadowColor = 'transparent';

    if (showCombo) {
      const comboLabel = 'Combo';
      const comboValue = String(combo);
      const numberSize = Math.min(208, 164 + Math.max(0, combo - 2) * 12);
      context.textAlign = 'left';
      context.font = 'italic 900 66px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
      const labelWidth = context.measureText(`${comboLabel} `).width;
      context.font = `italic 900 ${numberSize}px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif`;
      const valueWidth = context.measureText(comboValue).width;
      const total = labelWidth + valueWidth + 12;
      const start = -total / 2;
      const numberX = start + labelWidth + 8;
      const numberCx = numberX + valueWidth / 2;

      // 数字背后的光球 + 放射线
      const orb = context.createRadialGradient(numberCx, 8, 8, numberCx, 8, 130);
      orb.addColorStop(0, 'rgba(255,255,220,0.95)');
      orb.addColorStop(0.35, 'rgba(255,210,60,0.55)');
      orb.addColorStop(1, 'rgba(255,160,0,0)');
      context.fillStyle = orb;
      context.beginPath();
      context.arc(numberCx, 8, 130, 0, TWO_PI);
      context.fill();
      context.save();
      context.translate(numberCx, 8);
      context.strokeStyle = 'rgba(255, 230, 120, 0.75)';
      context.lineWidth = 3;
      for (let ray = 0; ray < 10; ray += 1) {
        const a = (ray / 10) * TWO_PI + popIn + seconds * 0.6;
        context.beginPath();
        context.moveTo(Math.cos(a) * 28, Math.sin(a) * 28);
        context.lineTo(Math.cos(a) * (82 + (ray % 2) * 18), Math.sin(a) * (82 + (ray % 2) * 18));
        context.stroke();
      }
      context.restore();

      context.font = 'italic 900 66px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
      context.lineWidth = 18;
      context.strokeStyle = '#163a8a';
      context.strokeText(comboLabel, start, -6);
      context.lineWidth = 8;
      context.strokeStyle = '#2f7dff';
      context.strokeText(comboLabel, start, -6);
      const comboFill = context.createLinearGradient(start, -36, start, 28);
      comboFill.addColorStop(0, '#ffffff');
      comboFill.addColorStop(1, '#8fd0ff');
      context.fillStyle = comboFill;
      context.shadowColor = 'rgba(40, 110, 255, 0.55)';
      context.shadowBlur = 14;
      context.fillText(comboLabel, start, -6);
      context.shadowColor = 'transparent';

      context.font = `italic 900 ${numberSize}px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif`;
      context.lineWidth = 22;
      context.strokeStyle = '#ffffff';
      context.strokeText(comboValue, numberX, 12);
      context.lineWidth = 12;
      context.strokeStyle = '#e86a12';
      context.strokeText(comboValue, numberX, 12);
      const numberFill = context.createLinearGradient(numberX, -80, numberX, 80);
      numberFill.addColorStop(0, '#fffbe0');
      numberFill.addColorStop(0.5, '#ffe14a');
      numberFill.addColorStop(1, '#ff9a1a');
      context.fillStyle = numberFill;
      context.shadowColor = 'rgba(255, 200, 40, 0.9)';
      context.shadowBlur = 24;
      context.fillText(comboValue, numberX, 12);
      context.shadowColor = 'transparent';

      // 闪烁星星(呼吸)
      const starSpots: ReadonlyArray<readonly [number, number, number]> = [
        [valueWidth * 0.7, -70, 16],
        [-18, -54, 10],
        [valueWidth * 0.2, 64, 12],
      ];
      for (const [i, [sx, sy, sr]] of starSpots.entries()) {
        context.save();
        context.translate(numberX + sx, sy);
        context.globalAlpha = alpha * (0.45 + 0.55 * Math.abs(Math.sin(seconds * 6 + i * 2.1)));
        context.fillStyle = '#fffce8';
        context.beginPath();
        for (let point = 0; point < 8; point += 1) {
          const radius = point % 2 === 0 ? sr : sr * 0.35;
          const a = (point / 8) * TWO_PI + seconds * 1.5;
          if (point === 0) context.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
          else context.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
        }
        context.closePath();
        context.fill();
        context.restore();
      }
    }

    // ---- 总飘分(+N, 金色, 上飘) ----
    const total = clearing.clear.cells.length * 5 * Math.max(1, combo);
    const scoreIn = clamp01((progress - 0.14) / 0.2);
    const scoreAlpha = Math.min(scoreIn, fadeOut);
    if (scoreAlpha > 0) {
      const rise = -26 * easeOutCubic(clamp01((progress - 0.14) / 0.7));
      const sy = showCombo ? 108 : 62;
      context.globalAlpha = scoreAlpha;
      context.textAlign = 'center';
      context.font = '900 44px "Arial Rounded MT Bold", sans-serif';
      context.lineWidth = 9;
      context.strokeStyle = '#8a4a08';
      context.strokeText(`+${total}`, 0, sy + rise);
      const scoreFill = context.createLinearGradient(0, sy - 24 + rise, 0, sy + 24 + rise);
      scoreFill.addColorStop(0, '#fffbe0');
      scoreFill.addColorStop(1, '#ffb321');
      context.fillStyle = scoreFill;
      context.shadowColor = 'rgba(255, 190, 40, 0.7)';
      context.shadowBlur = 12;
      context.fillText(`+${total}`, 0, sy + rise);
      context.shadowColor = 'transparent';
    }
    context.restore();
  }

  private drawPraise(clearing: ClearingFrame, seconds: number): void {
    if (!this.frame) return;
    if (this.isBlastLook()) {
      this.drawBlastPraise(clearing, seconds);
      return;
    }
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
