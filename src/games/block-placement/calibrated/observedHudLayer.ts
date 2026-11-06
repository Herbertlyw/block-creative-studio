import type { ReferenceCalibration } from './parseCalibration';
import type { BBTimelineFrame } from '../planning/bbTimelinePlan';
import { drawProgressHud } from './progressHud';
import { drawMeasuredDiamond } from './feedbackDetails';
import { drawReferenceDecoration } from './decorations';
import { drawHudPulse } from './referenceFeedback';

interface HudPainters {
  crown: (x: number, y: number) => void;
  gear: (x: number, y: number, color: string, dot: boolean) => void;
  text: (
    label: string,
    x: number,
    y: number,
    size: number,
    fill: string,
    stroke?: string,
    italic?: boolean,
  ) => void;
}
/** HUD and decorations consume the common frame's score and clock. */
export function paintObservedHud(
  ctx: CanvasRenderingContext2D,
  spec: ReferenceCalibration,
  frame: BBTimelineFrame,
  images: Record<string, HTMLImageElement>,
  early: boolean,
  bg: string,
  painters: HudPainters,
): void {
  const { x: gx, y: gy, pitch, rows: boardSize } = frame.geometry.board,
    t = frame.timeSeconds;
  const drawingBoard: readonly [number, number, number, number] = [gx, gy, pitch, boardSize];
  const { crown, gear, text } = painters;
  const hud = frame.hud,
    score = hud.score;
  for (const e of spec.appearance?.decorations ?? [])
    if (e.kind.startsWith('hud-')) drawReferenceDecoration(ctx, e, t, drawingBoard);
  if (spec.appearance?.hudDiamondTrack)
    drawMeasuredDiamond(ctx, spec.appearance.hudDiamondTrack, t);
  const best = spec.theme === 'grey' ? Math.max(spec.bestScore, score) : spec.bestScore;
  if ((!images.hudLeft || early) && !spec.appearance?.bestScore && !spec.appearance?.staticHud) {
    const crownY = spec.theme === 'pink' ? 54 : spec.theme === 'grey' ? 42 : 64;
    if (!images.crown) crown(spec.theme === 'pink' ? 51 : 44, crownY);
    ctx.save();
    ctx.font = 'italic 900 70px Arial';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    // The procedural crown spans -9..93 around crownY. Align visible glyph ink,
    // not the alphabetic baseline, to the same vertical center in every theme.
    const centerY = images.crown ? 75 : crownY + 42,
      metrics = ctx.measureText(String(best));
    const baseline =
      centerY + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
    ctx.fillStyle = '#ffd32c';
    ctx.shadowColor = '#b6813d';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 3;
    ctx.fillText(String(best), spec.theme === 'pink' ? 169 : 151, baseline);
    ctx.restore();
  }
  if (!spec.appearance?.staticHud)
    gear(
      spec.theme === 'pink' ? 981 : 981,
      spec.theme === 'purple' ? 108 : 88,
      early ? '#087aca' : spec.theme === 'pink' ? '#c0eaff' : '#edf3f3',
      spec.theme === 'purple',
    );
  if (images.hudLeft && !early) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 380, 150);
    ctx.drawImage(images.hudLeft, 0, 0, 380, 150);
  }
  if (images.hudGear && !early) {
    ctx.fillStyle = bg;
    ctx.fillRect(915, 35, 150, 135);
    ctx.drawImage(images.hudGear, 915, 35, 150, 135);
  }
  if (images.hudControls && !early) ctx.drawImage(images.hudControls, 775, 30, 282, 145);
  if (images.crown) {
    const r = spec.appearance?.crownRect ?? [20, 20, 125, 110];
    ctx.drawImage(images.crown, r[0], r[1], r[2], r[3]);
  }
  if (spec.appearance?.bestScore) {
    const h = spec.appearance.bestScore;
    ctx.save();
    ctx.font = `${h.italic ? 'italic ' : ''}900 ${h.size}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = h.color;
    ctx.shadowColor = '#715c5260';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillText(String(best), h.x, h.y);
    ctx.restore();
  }
  if (spec.appearance?.score?.diamond ?? spec.theme !== 'pink') {
    ctx.save();
    ctx.translate(540, spec.theme === 'purple' ? 235 : 211);
    ctx.rotate(Math.PI / 4);
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#1599ed';
    const g = ctx.createLinearGradient(-60, -60, 60, 60);
    g.addColorStop(0, '#3cb7ff');
    g.addColorStop(1, '#1566b4');
    ctx.fillStyle = g;
    ctx.fillRect(-63, -63, 126, 126);
    ctx.restore();
  }
  drawHudPulse(ctx, spec.theme, hud.pulse);
  if (spec.appearance?.score?.enabled !== false) {
    if (spec.appearance?.score) {
      const h = spec.appearance.score;
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.scale(h.scaleX ?? 1, 1);
      if (h.weight) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${h.italic ? 'italic ' : ''}${h.weight} ${h.size}px Arial`;
        ctx.fillStyle = '#fff';
        ctx.fillText((h.prefix ?? '') + String(score), 0, 0);
      } else text((h.prefix ?? '') + String(score), 0, 0, h.size, '#fff', undefined, h.italic);
      ctx.restore();
    } else
      text(
        String(score),
        540,
        spec.theme === 'purple' ? 246 : spec.theme === 'pink' ? 246 : 228,
        spec.theme === 'pink' ? 110 : early ? 148 : 160,
        early ? '#25414e' : '#fff',
        undefined,
        spec.theme === 'pink',
      );
  }
  for (const meter of spec.appearance?.progressHud ?? []) drawProgressHud(ctx, meter, t);
}
