import type { ReferenceCalibration } from './parseCalibration';
import type { BBTimelineFrame } from '../planning/bbTimelinePlan';
import type { createBBTileLayer } from '../rendering/tileLayer';
import { drawBoardCelebration } from './boardCelebration';
import { drawTileGlow } from './feedbackDetails';
import { drawMeasuredCombo } from './measuredCombo';
import { praisePose } from './praiseMotion';
import { drawClassicPraise } from './classicPraise';
import { drawReferenceDecoration } from './decorations';
import { drawColorGone } from './colorGone';
import { drawScorePopup } from './scoreFeedback';
import type { createObservedPrimitives } from './observedPrimitives';

type Tile = ReturnType<typeof createBBTileLayer>['tile'];
type Primitives = ReturnType<typeof createObservedPrimitives>;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
/** Board-only glow and recolor overlays, distinct from gameplay and piece drawing. */
export function paintObservedBoardFeedback(
  ctx: CanvasRenderingContext2D,
  spec: ReferenceCalibration,
  frame: BBTimelineFrame,
  glow: Primitives['glow'],
): void {
  const { x: gx, y: gy, pitch } = frame.geometry.board,
    t = frame.timeSeconds,
    board = frame.renderBoard;
  if (spec.appearance?.tileGlowEvents)
    drawTileGlow(ctx, spec.appearance.tileGlowEvents, t, board, spec.board);
  if (frame.recolorFlash) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = frame.recolorFlash.opacity;
    for (const { row: r, col: c } of frame.recolorFlash.cells) {
      glow(gx + (c + 0.5) * pitch, gy + (r + 0.5) * pitch, pitch * 0.85, '#9aedffc0');
      ctx.fillStyle = '#efffff';
      ctx.fillRect(gx + c * pitch + 3, gy + r * pitch + 3, pitch - 6, pitch - 6);
    }
    ctx.restore();
  }
}
/** Celebration, decoration, text and end-card layers; no board or Take is drawn here. */
export function paintObservedOverlays(
  ctx: CanvasRenderingContext2D,
  spec: ReferenceCalibration,
  frame: BBTimelineFrame,
  images: Record<string, HTMLImageElement>,
  tile: Tile,
  sourceTime: number,
  primitives: Primitives,
): void {
  const { x: gx, y: gy, pitch, rows: boardSize } = frame.geometry.board,
    t = frame.timeSeconds;
  const drawingBoard: readonly [number, number, number, number] = [gx, gy, pitch, boardSize];
  const { praise, trophy, round, text } = primitives;
  for (const e of spec.appearance?.boardCelebrations ?? [])
    drawBoardCelebration(
      { ctx, gx, gy, pitch, background: images.background, tile, sourceTime },
      e,
      t,
    );
  for (const e of spec.appearance?.cellCounters ?? []) {
    if (t < e.start || t >= e.end) continue;
    const age = t - e.start,
      left = e.end - t,
      alpha = Math.min(1, age / 0.03, left / 0.06);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (e.badge === 'coin') {
      const x = gx + (e.col + 0.5) * pitch,
        y = gy + (e.row + 0.5) * pitch,
        r = pitch * 0.3;
      ctx.fillStyle = '#c89546';
      ctx.fillRect(x - pitch * 0.46, y - pitch * 0.115, pitch * 0.92, pitch * 0.23);
      ctx.shadowColor = '#713f43';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = '#ffe890';
      ctx.strokeStyle = '#cb8327';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff9bb';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r - 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `900 ${pitch * 0.32}px Arial`;
      ctx.fillStyle = '#624735';
      ctx.fillText(String(e.value), x, y + 2);
    } else {
      ctx.font = `900 ${pitch * 0.7}px Arial`;
      ctx.fillStyle = e.color;
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 10;
      ctx.fillText(
        String(e.value),
        gx + (e.col + 0.5) * pitch,
        gy + (e.row + 0.5) * pitch - Math.min(25, age * 80),
      );
    }
    ctx.restore();
  }
  for (const popup of frame.scorePopups) drawScorePopup(ctx, popup);
  for (const e of spec.appearance?.decorations ?? [])
    if (!e.kind.startsWith('hud-')) drawReferenceDecoration(ctx, e, t, drawingBoard);
  for (const event of spec.appearance?.praiseEvents ?? []) {
    if (t < event.start || t >= event.end) continue;
    const pose = praisePose(event, t);
    if (event.spriteRect) {
      const rect = event.spriteRect,
        im = images.praiseAtlas;
      if (!im) throw new Error('REFERENCE_PRAISE_ATLAS_MISSING');
      const width = pose?.width ?? rect[2] * event.scale,
        height = pose?.height ?? rect[3] * event.scale;
      ctx.save();
      ctx.globalAlpha *= clamp((event.end - t) / 0.1);
      ctx.drawImage(
        im,
        ...(rect as [number, number, number, number]),
        (pose?.x ?? event.x) - width / 2,
        (pose?.y ?? event.y) - height / 2,
        width,
        height,
      );
      ctx.restore();
      continue;
    }
    if (event.style === 'measured' && event.combo && pose) {
      drawMeasuredCombo(ctx, event.combo, t - event.start, pose.x, pose.y, {
        ...pose,
        ...(event.palette !== undefined ? { palette: event.palette } : {}),
      });
      continue;
    }
    if (/colors?\s*gone/i.test(event.label)) {
      drawColorGone(
        ctx,
        event.label,
        pose?.x ?? event.x,
        pose?.y ?? event.y,
        pose?.width ?? (event.label.startsWith('Color') ? 630 : 880) * event.scale,
        pose?.height ?? 115 * event.scale,
        pose?.width ? Math.max(0.1, t - event.start) : t - event.start,
        clamp((event.end - t) / 0.1),
        event.palette,
      );
      continue;
    }
    if (pose) {
      ctx.save();
      ctx.globalAlpha *= clamp((event.end - t) / 0.1);
      drawClassicPraise(
        ctx,
        event.label,
        event.combo,
        t - event.start,
        pose.x,
        pose.y,
        event.style === 'red',
        {
          ...pose,
          ...(event.palette !== undefined ? { palette: event.palette } : {}),
          ...(spec.appearance?.comboDigitScale !== undefined
            ? { digitScale: spec.appearance.comboDigitScale }
            : {}),
        },
      );
      ctx.restore();
      continue;
    }
    ctx.save();
    ctx.translate(event.x, event.y);
    ctx.scale(event.scale, event.scale);
    praise(
      event.label,
      event.combo,
      Math.min(0.35, Math.max(0.025, t - event.start)),
      0,
      0,
      event.style,
    );
    ctx.restore();
  }
  for (const overlay of spec.appearance?.textOverlays ?? []) {
    if (t < overlay.start || t >= overlay.end) continue;
    ctx.save();
    ctx.font = `${overlay.weight ?? 600} ${overlay.size}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#17120f';
    ctx.lineWidth = overlay.strokeWidth ?? overlay.size * 0.13;
    ctx.fillStyle = '#fff';
    overlay.text.split('\n').forEach((line: string, j: number) => {
      const yy = overlay.y + j * overlay.size * 1.28;
      if (overlay.strokeWidth !== 0) ctx.strokeText(line, overlay.x, yy);
      ctx.fillText(line, overlay.x, yy);
    });
    ctx.restore();
  }
  if (spec.theme === 'grey' && spec.trophies !== false) {
    for (const when of [54.1, 78.2, 89.2])
      if (sourceTime >= when && sourceTime < when + 1.4) trophy(sourceTime - when);
  }
  if (spec.theme === 'purple' && spec.endCardStart !== undefined && t >= spec.endCardStart) {
    ctx.save();
    ctx.globalAlpha = clamp((t - spec.endCardStart) * 5);
    if (images.endCard) ctx.drawImage(images.endCard, 0, 0, 1080, 1920);
    else {
      ctx.fillStyle = '#234687';
      ctx.fillRect(0, 0, 1080, 1920);
      text('Block', 540, 650, 206, '#ffd63e', '#cf802b');
      text('Blast!', 540, 825, 206, '#ffc624', '#be7322');
      round(155, 1200, 770, 130, 48, '#12c8fa');
      text('PLAY NOW', 540, 1265, 72, '#fff');
    }
    ctx.restore();
  }
}
