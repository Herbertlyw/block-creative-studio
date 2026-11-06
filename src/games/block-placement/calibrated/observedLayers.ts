import type { BBTimelineFrame } from '../planning/bbTimelinePlan';
import { bbDesignTransform } from '../planning/geometry';
import type { ObservedLayerConfig } from '../planning/observedLayerConfig';
import { drawObservedPointerSample } from '../../../contracts/observedPointer';
import { createBBTileLayer } from '../rendering/tileLayer';
import {
  paintObservedBase,
  paintObservedCameraBackground,
} from '../rendering/observedBackgroundLayer';
import { paintObservedBoard } from '../rendering/observedBoardLayer';
import { paintObservedRack } from '../rendering/observedRackLayer';
import { paintObservedHud } from './observedHudLayer';
import { paintObservedPieces } from './observedPiecesLayer';
import { paintObservedClears } from './observedClearLayer';
import { paintObservedBoardFeedback, paintObservedOverlays } from './observedOverlayLayers';
import { createObservedPrimitives } from './observedPrimitives';
import { loadObservedAssets } from './observedAssets';
import { drawScreenAtmosphere } from './screenAtmosphere';

/** Discrete material layers; this object does not own a clock or a full-scene render loop. */
export class ObservedLayers {
  private readonly images: Record<string, HTMLImageElement> = {};
  private readonly tinted: Record<string, HTMLCanvasElement> = {};
  private readonly sprites: HTMLCanvasElement[] = [];
  private readonly faceColors: string[] = [];
  private readonly tiles: ReturnType<typeof createBBTileLayer>;
  private readonly primitives: ReturnType<typeof createObservedPrimitives>;
  private readonly board: readonly [number, number, number, number];
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly config: ObservedLayerConfig,
  ) {
    const { geometry, initial, spec, bindings } = config,
      { x, y, pitch, rows, cols } = geometry.board;
    if (
      initial.board.cells.length !== rows ||
      initial.board.cells.some((row) => row.length !== cols)
    )
      throw new Error('BB_SCENE_BOARD_GEOMETRY_MISMATCH');
    this.board = [x, y, pitch, rows];
    this.tiles = createBBTileLayer({
      ctx,
      style: spec,
      images: this.images,
      tinted: this.tinted,
      materialSprites: this.sprites,
      bindings,
      boardRows: rows,
      boardCols: cols,
    });
    this.primitives = createObservedPrimitives(ctx, spec, this.images, geometry);
  }
  async warmup(): Promise<void> {
    const { spec } = this.config;
    await loadObservedAssets(spec, this.images, this.tinted, this.sprites, this.faceColors);
  }
  /** Prepare design-space transform and background; the caller controls layer order. */
  begin(frame: BBTimelineFrame): { early: boolean; bg: string; sourceTime: number } {
    const { ctx, canvas, config } = this,
      { spec, geometry, bindings } = config;
    if (JSON.stringify(frame.geometry) !== JSON.stringify(geometry))
      throw new Error('BB_SCENE_GEOMETRY_MISMATCH');
    const t = frame.timeSeconds,
      sourceTime = t + spec.sourceOffset,
      transform = bbDesignTransform(frame.geometry, canvas.width, canvas.height);
    ctx.setTransform(transform.sx, 0, 0, transform.sy, transform.left, transform.top);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.clearRect(0, 0, 1080, 1920);
    const early = spec.theme === 'purple' && sourceTime < 16.25,
      bg = paintObservedBase(ctx, spec, bindings, this.images, t, early);
    ctx.save();
    ctx.translate(frame.camera.x, frame.camera.y);
    ctx.translate(540, 960);
    ctx.scale(frame.camera.scale, frame.camera.scale);
    ctx.translate(-540, -960);
    paintObservedCameraBackground(ctx, spec, bindings, this.images, t);
    return { early, bg, sourceTime };
  }
  hud(frame: BBTimelineFrame, early: boolean, bg: string): void {
    const { crown, gear, text } = this.primitives;
    paintObservedHud(this.ctx, this.config.spec, frame, this.images, early, bg, {
      crown,
      gear,
      text,
    });
  }
  boardLayer(frame: BBTimelineFrame, early: boolean, sourceTime: number): void {
    const { ctx, config, tiles } = this;
    paintObservedBoard(
      ctx,
      config.spec,
      frame,
      frame.renderBoard,
      this.images.background,
      tiles.tile,
      frame.timeSeconds,
      sourceTime,
      early,
    );
    paintObservedBoardFeedback(ctx, config.spec, frame, this.primitives.glow);
  }
  pieces(frame: BBTimelineFrame, sourceTime: number): void {
    paintObservedPieces(this.ctx, this.config.spec, frame, this.faceColors, sourceTime, this.tiles);
  }
  rack(frame: BBTimelineFrame, sourceTime: number): void {
    paintObservedRack(this.ctx, this.config.spec, frame, frame.timeSeconds, sourceTime, this.tiles);
  }
  clear(frame: BBTimelineFrame, sourceTime: number): void {
    const { glow, border, praise, praiseImage, text } = this.primitives;
    paintObservedClears(
      this.ctx,
      this.config.spec,
      frame,
      this.images,
      this.faceColors,
      this.tiles.tile,
      sourceTime,
      { glow, border, praise, praiseImage, text },
    );
  }
  overlays(frame: BBTimelineFrame, sourceTime: number): void {
    paintObservedOverlays(
      this.ctx,
      this.config.spec,
      frame,
      this.images,
      this.tiles.tile,
      sourceTime,
      this.primitives,
    );
  }
  /** Close camera scope and draw viewport-space overlays on the same sampled frame. */
  finish(frame: BBTimelineFrame): void {
    const { canvas, ctx, config } = this,
      { spec } = config,
      t = frame.timeSeconds;
    ctx.restore();
    const atmosphere = spec.effects?.screenAtmosphere;
    if (atmosphere?.enabled && frame.atmosphereAge !== null)
      drawScreenAtmosphere(ctx, this.board, frame.atmosphereAge, t, atmosphere);
    const pointer = frame.pointer;
    if (pointer && (pointer.space !== 'design' || pointer.radius === null))
      throw new Error('CALIBRATED_FRAME_POINTER_INVALID');
    const transform = bbDesignTransform(frame.geometry, canvas.width, canvas.height);
    drawObservedPointerSample(
      canvas,
      pointer && pointer.radius !== null
        ? { x: pointer.x, y: pointer.y, radius: pointer.radius, kind: 'ring' }
        : null,
      transform,
    );
  }
}
