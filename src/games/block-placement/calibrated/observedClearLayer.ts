import type { ReferenceCalibration } from './parseCalibration';
import type { BBTimelineFrame } from '../planning/bbTimelinePlan';
import type { createBBTileLayer } from '../rendering/tileLayer';
import { drawClearSweep } from './clearSweep';
import { drawReferenceClear } from './clearEffects';
import { drawLibraryClear } from './libraryClear';
import { drawLibraryRim, drawLibraryCelebration } from './libraryFeedback';
import { drawButterflyRim, drawLikes, drawPerfectCelebration } from './referenceFeedback';
import { referenceFaceAt } from '../../../nativeReference/games/block-placement/presentation/referenceAppearance';
import { tintForColor } from './tileColors';

type Tile = ReturnType<typeof createBBTileLayer>['tile'];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};
interface ClearPainters {
  glow: (x: number, y: number, r: number, color: string, alpha?: number) => void;
  border: (time: number, amount: number, combo: number) => void;
  praise: (
    label: string,
    combo: number,
    age: number,
    x: number,
    y: number,
    variant?: string,
  ) => void;
  praiseImage: (label: string, x: number, y: number) => boolean;
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
/** Clear effects consume pre-sampled transitions and do not replay game state. */
export function paintObservedClears(
  ctx: CanvasRenderingContext2D,
  spec: ReferenceCalibration,
  frame: BBTimelineFrame,
  images: Record<string, HTMLImageElement>,
  materialFaceColors: string[],
  tile: Tile,
  sourceTime: number,
  painters: ClearPainters,
): void {
  const { x: gx, y: gy, pitch, rows: boardSize } = frame.geometry.board,
    t = frame.timeSeconds,
    board = frame.renderBoard;
  const drawingBoard: readonly [number, number, number, number] = [gx, gy, pitch, boardSize];
  const { glow, border, praise, praiseImage, text } = painters,
    library = spec.effects?.library;
  for (const { effect: clearEffect, render } of frame.clearRenders) {
    const { index: i, age, clearAge, combo, feedback } = clearEffect;
    const st = render.step,
      a = render.timing;
    if (clearEffect.praiseLabel === null) throw new Error('CALIBRATED_FRAME_PRAISE_MISSING');
    if (
      t >= a.release &&
      clearAge <
        (a.clearStyle === 'prism-fracture'
          ? 1.6
          : a.clearStyle === 'stone-spray'
            ? Math.max(1.05, 0.7 * (spec.effects?.stoneLifeScale ?? 1))
            : 1.05)
    ) {
      if (spec.effects?.clearSweep?.enabled && age >= 0)
        drawClearSweep(
          { ctx, gx, gy, pitch, tile },
          st,
          clearAge,
          sourceTime,
          board,
          spec.effects.clearSweep,
        );
      else
        drawReferenceClear(
          {
            ctx,
            gx,
            gy,
            pitch,
            stoneFragments: images.stoneFragments,
            stoneFragmentRects: spec.effects?.stoneFragmentRects,
            stoneFragmentScale: spec.effects?.stoneFragmentScale,
            stoneDustGlow: spec.effects?.stoneDustGlow,
            stoneLiftScale: spec.effects?.stoneLiftScale,
            stoneGravityScale: spec.effects?.stoneGravityScale,
            stoneLifeScale: spec.effects?.stoneLifeScale,
            theme: spec.theme,
            style: a.clearStyle,
            rainbowGapSeconds: a.rainbowGapSeconds,
            rainbowReverse: a.rainbowReverse,
            rainbowCells: a.rainbowCells,
            polish: spec.effects?.clearPolish === true,
            tintForColor: (color: string) => tintForColor(spec.tileColors, color),
            tile,
            glow,
            faceColor: (face: string) =>
              spec.appearance && face?.startsWith('observed-face:')
                ? materialFaceColors[
                    referenceFaceAt(spec.appearance, Number(face.split(':')[1]), sourceTime)
                  ]
                : face === 'coral'
                  ? '#efa9a6'
                  : face === 'cyan'
                    ? '#7dc0e2'
                    : '#d0dbe6',
            layers: library
              ? {
                  preClear: library.preClear === undefined,
                  beam: library.beam === undefined,
                  particles: library.particles === undefined,
                }
              : undefined,
          },
          st,
          clearAge,
          sourceTime,
          board,
        );
      if (library && !spec.effects?.clearSweep?.enabled)
        drawLibraryClear(
          { ctx, gx, gy, pitch, tile },
          st,
          clearAge,
          sourceTime,
          board,
          library,
          Math.max(0, a.clear - a.release),
          i * 101,
        );
    }
    if (age < 0 || age > 1.0) continue;
    if (library?.rim !== undefined) {
      if (combo >= 2) drawLibraryRim(ctx, drawingBoard, age, library.rim, i * 101);
    } else if (feedback?.rim)
      drawButterflyRim(ctx, drawingBoard, age, t, spec.effects!.butterflyRim!.density);
    if (feedback?.like) drawLikes(ctx, spec, st, age, feedback.like, i);
    if (library?.celebration !== undefined) {
      if (a.perfect || /^Combo|Perfect/i.test(clearEffect.praiseLabel))
        drawLibraryCelebration(ctx, drawingBoard, age, library.celebration, i * 101, !!a.perfect);
    } else if (feedback?.celebrate)
      drawPerfectCelebration(ctx, drawingBoard, age, i, spec.effects!.perfectCelebration!.density);
    if (
      spec.appearance?.boardRim !== false &&
      (spec.theme === 'grey' || (spec.theme === 'purple' && sourceTime < 18))
    )
      border(t, ease((age - 0.08) / 0.08) * clamp((0.65 - age) / 0.3), combo);
    const lineCount = st.clear.rows.length + st.clear.cols.length;
    if (age < 0.9 && !spec.appearance?.hideDefaultPraise) {
      const label = clearEffect.praiseLabel;
      const py =
        gy +
        pitch *
          (a.perfect && spec.effects?.perfectCelebration?.enabled
            ? 3.35
            : spec.theme === 'pink'
              ? 4.9
              : spec.theme === 'purple'
                ? 2.65
                : /^Combo/i.test(label)
                  ? 6.6
                  : 4.3) *
          (boardSize / 8);
      praise(label, combo, age, 540, spec.appearance?.praiseY ?? py);
      if (a.perfect) {
        ctx.save();
        ctx.globalAlpha = clamp(age / 0.1) * clamp((0.9 - age) * 4);
        if (!praiseImage('Perfect!', 540, py + 119))
          text('Perfect!', 540, py + 119, 85, '#fff9de', '#f44932', true);
        ctx.restore();
      }
    }
    if (
      spec.appearance?.showAllClear !== false &&
      st.after.board.cells.every((row: any[]) => row.every((c) => c === null)) &&
      age > 0.2
    ) {
      ctx.save();
      const alpha = clamp((age - 0.2) * 5) * clamp((1.3 - age) * 3);
      ctx.globalAlpha = alpha;
      glow(540, gy + (pitch * boardSize) / 2, 460, '#0c8bef80');
      for (const yy of [gy + 30 + age * 80, gy + pitch * boardSize - age * 70]) {
        ctx.save();
        ctx.translate(540, yy);
        ctx.scale(1, 0.08);
        glow(0, 0, 490, '#198aff99');
        ctx.restore();
        ctx.fillStyle = '#91fbff';
        ctx.fillRect(gx, yy - 3, pitch * boardSize, 6);
      }
      text('ALL CLEAR', 540, gy + (pitch * boardSize) / 2, 90, '#b3fff4', '#078fae');
      ctx.restore();
    }
  }
}
