import {
  calibratedNativeFragmentPackets,
  type NativeCalibratedFragmentPacket,
} from './calibratedNativeFragments';
import { drawRuntimeImage } from '../../../agent-assets/runtimeImage';
import type { RuntimeImageAssetBinding } from '../../../assets/runtimeAssetBindings';
import type { DropReferenceCalibration } from '../profiles/referenceCalibration';
import type { BlockCrushDropPresentationFrame } from '../presentation/presentationAdapter';
import {
  BLOCK_CRUSH_DROP_OBSERVED_INTERPOLATION_MIN_COVERAGE,
  blockCrushDropScreenPosition,
  cellsForBlockCrushDropFrame,
  simulateClearSheet,
} from './stagePainter';
import { rotatedShape } from '../runtime';
import { blockCrushFieldClock } from '../fieldClock';
import {
  calibratedFieldRiseBoardFrame,
  calibratedFieldRiseCompensation,
  calibratedFieldRiseTick,
  calibratedVisualFieldRise,
} from './calibratedFieldRise';
import { calibratedClearFieldAdvection } from './clearFieldAdvection';
import { calibratedFragmentPhysicsPose } from '../profiles/fragmentPhysics';
import { calibratedLayeredCurvePoses } from '../profiles/layeredCurve';
import { calibratedLocalDetachFragments } from '../profiles/localFragmentSupport';
import { calibratedSampledBallisticFragments } from '../profiles/sampledBallisticFragments';
import { ballisticPrefracturePartition } from '../profiles/ballisticPrefracturePartition';
import { calibratedFragmentDisplaySeconds } from '../profiles/localFragmentDetach';
import { prefractureRefinementPartition } from '../profiles/prefractureRefinement';
import { drawRoundedFragmentCube } from '../../../rendering/roundedFragmentCube';
import { drawRoundedPolyhedronFragment } from '../../../rendering/roundedPolyhedronFragment';
import { drawFracturedBlock } from '../../../rendering/fracturedBlock';
import { drawFracturedVolume } from '../../../rendering/fracturedVolume';
import { drawReliefFragmentCube } from '../../../rendering/reliefFragmentCube';
import { drawPyramidQuarterFragment } from '../../../rendering/pyramidQuarterFragment';
import { drawDropImpactBeams } from './impactBeam';
import { drawDropLandingSurfaceFlash } from './landingSurfaceFlash';
import type { DropEncouragementGlyphLayerService } from './encouragementGlyphLayer';
import type {
  ObservedFragmentDepthLayerService,
  ObservedFragmentDepthPacket,
} from './observedFragmentDepthLayer';
import { drawPartitionedSolid } from '../../../rendering/partitionedSolid';
import {
  dropObservedFragmentHeldParentIds,
  isDropObservedFragmentMotionV2,
  sampleDropObservedFragmentMotionV2,
  type DropObservedFragmentPose,
} from '../profiles/observedFragmentMotion';
export {
  calibratedFragmentPhysicsPose,
  calibratedFragmentFlightSeconds,
} from '../profiles/fragmentPhysics';
export { calibratedLayeredCurveDrops, calibratedLayeredCurvePoses } from '../profiles/layeredCurve';

function shade(hex: string, amount: number) {
  const v = parseInt(hex.slice(1), 16);
  return `rgb(${[v >> 16, (v >> 8) & 255, v & 255].map((x) => Math.round(Math.max(0, Math.min(255, amount > 1 ? x + (255 - x) * (amount - 1) : x * amount)))).join(',')})`;
}
function polygon(c: CanvasRenderingContext2D, p: number[][], color: string) {
  c.beginPath();
  p.forEach(([x, y], i) => (i ? c.lineTo(x!, y!) : c.moveTo(x!, y!)));
  c.closePath();
  c.fillStyle = color;
  c.fill();
}
/** Vector-only faceted surface, including fragment faces; deterministic under random access. */
export function drawCalibratedDropTile(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  a: DropReferenceCalibration,
) {
  const inset = size * a.seam,
    l = x + inset,
    t = y + inset,
    r = x + size - inset,
    b = y + size - inset,
    v = (size - 2 * inset) * a.bevel;
  if (a.shadow) {
    c.fillStyle = `rgba(0,0,0,${0.27 * a.shadow})`;
    polygon(
      c,
      [
        [r, t + v],
        [r + size * 0.36 * a.shadow, t + size * 0.5],
        [r + size * 0.36 * a.shadow, b + size * 0.4],
        [l + size * 0.36 * a.shadow, b + size * 0.4],
        [l, b],
        [r, b],
      ],
      c.fillStyle,
    );
  }
  c.fillStyle = shade(color, 0.8);
  c.fillRect(l, t, r - l, b - t);
  const k = a.material === 'ice' ? 1.1 : 1;
  if (a.material === 'pyramid') {
    const cx = (l + r) / 2,
      cy = (t + b) / 2;
    polygon(
      c,
      [
        [l, t],
        [r, t],
        [cx, cy],
      ],
      shade(color, 1.45),
    );
    polygon(
      c,
      [
        [r, t],
        [r, b],
        [cx, cy],
      ],
      shade(color, 0.8),
    );
    polygon(
      c,
      [
        [r, b],
        [l, b],
        [cx, cy],
      ],
      shade(color, 0.62),
    );
    polygon(
      c,
      [
        [l, b],
        [l, t],
        [cx, cy],
      ],
      shade(color, 1.12),
    );
  } else {
    polygon(
      c,
      [
        [l, t],
        [r, t],
        [r - v, t + v],
        [l + v, t + v],
      ],
      shade(color, (a.faceShading?.top ?? 1.47) * k),
    );
    polygon(
      c,
      [
        [l, t],
        [l + v, t + v],
        [l + v, b - v],
        [l, b],
      ],
      shade(color, a.faceShading?.left ?? 1.06),
    );
    polygon(
      c,
      [
        [r, t],
        [r, b],
        [r - v, b - v],
        [r - v, t + v],
      ],
      shade(color, a.faceShading?.right ?? 0.63),
    );
    polygon(
      c,
      [
        [r, b],
        [l, b],
        [l + v, b - v],
        [r - v, b - v],
      ],
      shade(color, a.faceShading?.bottom ?? 0.46),
    );
    const g = c.createLinearGradient(l, t, l, b);
    g.addColorStop(0, shade(color, 1.05 * k));
    g.addColorStop(1, shade(color, 0.92));
    c.fillStyle = g;
    c.fillRect(l + v, t + v, r - l - 2 * v, b - t - 2 * v);
    if (a.material === 'wood-star') {
      c.globalAlpha *= 0.35;
      c.strokeStyle = shade(color, 0.5);
      c.lineWidth = Math.max(0.5, size * 0.015);
      for (let j = 0; j < 4; j++) {
        c.beginPath();
        c.moveTo(l + v, t + v + j * size * 0.16);
        c.lineTo(r - v, t + v + j * size * 0.16 + size * 0.025);
        c.stroke();
      }
      const pts = Array.from({ length: 10 }, (_, j) => {
        const rad = j % 2 ? size * 0.09 : size * 0.2,
          angle = (j * Math.PI) / 5 - Math.PI / 2;
        return [(l + r) / 2 + Math.cos(angle) * rad, (t + b) / 2 + Math.sin(angle) * rad];
      });
      polygon(c, pts, shade(color, 0.48));
    }
  }
}
function fCueCell(f: BlockCrushDropPresentationFrame, id: string) {
  return f.lingeringClear?.eliminatedCells.find((c) => c.id === id);
}
export function calibratedCellColor(
  id: string,
  kind: string,
  frame: BlockCrushDropPresentationFrame,
  a: DropReferenceCalibration,
): string {
  const seconds = frame.frameIndex / frame.fps,
    keys = a.boardColorKeys;
  const parent = id.replace(/:fragment-[0-7]-[0-7]$/, '');
  const cellKey = a.cellColorKeys
    ?.filter((k) => k.id === parent && k.seconds <= seconds + 1e-8)
    .at(-1);
  if (cellKey) return cellKey.color;
  const colorKey = keys?.filter((k) => k.seconds <= seconds).at(-1);
  if (colorKey) {
    const next = keys?.find((k) => k.seconds > seconds);
    if (!next) return colorKey.color;
    const u = (seconds - colorKey.seconds) / (next.seconds - colorKey.seconds),
      v = parseInt(colorKey.color.slice(1), 16),
      w = parseInt(next.color.slice(1), 16);
    return (
      '#' +
      [16, 8, 0]
        .map((s) =>
          Math.round(((v >> s) & 255) * (1 - u) + ((w >> s) & 255) * u)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  }
  const incoming = parent.match(/^(?:rising-row|field-preview|field-preview-partial)-(\d+)-(\d+)$/);
  if (incoming && a.incomingCellColors?.length) {
    const row = a.incomingCellColors[Number(incoming[1]) % a.incomingCellColors.length];
    if (row?.[Number(incoming[2])]) return row[Number(incoming[2])]!;
  }
  if (incoming && a.incomingRowColors?.length)
    return a.incomingRowColors[Number(incoming[1]) % a.incomingRowColors.length]!;
  if (incoming && a.columnColors?.length)
    return a.columnColors[Number(incoming[2]) % a.columnColors.length]!;
  const original =
    frame.before.config.initialCells.find((c) => c.id === parent) ??
    frame.before.cells.find((c) => c.id === parent) ??
    frame.after.cells.find((c) => c.id === parent) ??
    fCueCell(frame, parent);
  if (a.colorMode === 'columns' && a.columnColors?.length && original)
    return a.columnColors[original.x % a.columnColors.length]!;
  if (/^#[\da-f]{6}$/i.test(kind)) return kind;
  if (original && /^#[\da-f]{6}$/i.test(original.kind)) return original.kind;
  const rising = parent.match(/^(?:rising-row|field-preview|field-preview-partial)-\d+-(\d+)$/);
  if (rising && a.columnColors?.length)
    return a.columnColors[Number(rising[1]) % a.columnColors.length]!;
  const placed = parent.match(/-batch-(\d+)-slot-(\d+)-/);
  if (placed) {
    const pieceId =
      frame.before.config.trayBatches[Number(placed[1])]?.[Number(placed[2])]?.pieceId;
    const piece = frame.before.config.pieces.find((p) => p.id === pieceId);
    if (piece && /^#[\da-f]{6}$/i.test(piece.kind)) return piece.kind;
  }
  return a.tileColor;
}
/** Cue ownership survives overlap with later actions and random-access evaluation. */
export function calibratedClearColor(
  id: string,
  kind: string,
  f: BlockCrushDropPresentationFrame,
  a: DropReferenceCalibration,
  fragmentKey?: string,
): string {
  const e = a.clear,
    cue = f.lingeringClear;
  if (fragmentKey && e?.fragmentPalette?.length)
    return e.fragmentPalette[
      Math.floor(random(fragmentKey + ':palette') * e.fragmentPalette.length)
    ]!;
  const measured =
    cue?.actionIndex === undefined || cue.cycleIndex === undefined
      ? undefined
      : e?.colorByAction?.[cue.actionIndex]?.[cue.cycleIndex];
  if (measured) return measured;
  if (e?.colorSource === 'action-piece' && cue?.pieceKind && /^#[\da-f]{6}$/i.test(cue.pieceKind))
    return cue.pieceKind;
  return e?.fragmentColor ?? calibratedCellColor(id, kind, f, a);
}
/** Only one layer owns the piece at contact; the final sample is the settled pose. */
export function calibratedFallTrailLength(
  speed: number,
  trail: NonNullable<DropReferenceCalibration['fallTrail']>,
) {
  return (
    trail.lengthPixels * Math.max(0, Math.min(1, (speed - trail.minSpeedPixelsPerSecond) / 1200))
  );
}
export function calibratedTrackVisible(
  track: NonNullable<DropReferenceCalibration['pieceTracks']>[number],
  seconds: number,
) {
  return seconds >= track.samples[0]!.seconds && seconds < track.samples.at(-1)!.seconds;
}
/** Sampled affine flips are presentation-only; the final pose still hands off to native contact. */
export function calibratedTrackPoseAt(
  track: NonNullable<DropReferenceCalibration['pieceTracks']>[number],
  seconds: number,
) {
  const next = track.samples.findIndex((p) => p.seconds >= seconds),
    end = track.samples[next < 0 ? track.samples.length - 1 : next]!,
    start = track.samples[Math.max(0, (next < 0 ? track.samples.length - 1 : next) - 1)]!;
  const u =
    end.seconds === start.seconds
      ? 0
      : Math.max(0, Math.min(1, (seconds - start.seconds) / (end.seconds - start.seconds)));
  return {
    x: start.x + (end.x - start.x) * u,
    y: start.y + (end.y - start.y) * u,
    angle: start.angle + (end.angle - start.angle) * u,
    scaleX: (start.scaleX ?? 1) + ((end.scaleX ?? 1) - (start.scaleX ?? 1)) * u,
    scaleY: (start.scaleY ?? 1) + ((end.scaleY ?? 1) - (start.scaleY ?? 1)) * u,
  };
}
/** The lighting atlas samples the displayed cell centre, including affine flips and board stretch. */
export function calibratedTrackCellWorldY(
  pose: ReturnType<typeof calibratedTrackPoseAt>,
  x: number,
  y: number,
  board: DropReferenceCalibration['board'],
) {
  const angle = (pose.angle * Math.PI) / 180;
  return (
    pose.y +
    (Math.sin(angle) * x * pose.scaleX + Math.cos(angle) * y * pose.scaleY) *
      (board.verticalScale ?? 1)
  );
}
/** Preserve the signed affine centre and footprint; only the face image's light direction changes. */
export function calibratedTrackCellSurface(
  pose: ReturnType<typeof calibratedTrackPoseAt>,
  x: number,
  y: number,
  size: number,
) {
  const angle = (pose.angle * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const affine = (dx: number, dy: number) => ({
    x: cos * dx * pose.scaleX - sin * dy * pose.scaleY,
    y: sin * dx * pose.scaleX + cos * dy * pose.scaleY,
  });
  const center = affine(x, y),
    half = size / 2,
    corners = [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ].map(([dx, dy]) => affine(dx!, dy!));
  return {
    ...center,
    width: 2 * Math.max(...corners.map((p) => Math.abs(p.x))),
    height: 2 * Math.max(...corners.map((p) => Math.abs(p.y))),
    corners,
  };
}
export function calibratedLandingPaint(
  id: string,
  kind: string,
  f: BlockCrushDropPresentationFrame,
  a: DropReferenceCalibration,
) {
  const target = calibratedCellColor(id, kind, f, a);
  const match = id.match(/^runtime-(\d+)-tick-(\d+)-batch-(\d+)-slot-(\d+)-/);
  if (!match || !a.landingColorSeconds || a.colorMode !== 'columns')
    return { source: target, target, mix: 1 };
  const ref = f.before.config.trayBatches[Number(match[3])]?.[Number(match[4])];
  const piece = f.before.config.pieces.find((p) => p.id === ref?.pieceId);
  const source = piece && /^#[\da-f]{6}$/i.test(piece.kind) ? piece.kind : target;
  const elapsed = f.frameIndex / f.fps - Number(match[2]) / 30;
  const u = Math.max(0, Math.min(1, elapsed / a.landingColorSeconds));
  return { source, target, mix: u * u * (3 - 2 * u) };
}
function drawHud(
  c: CanvasRenderingContext2D,
  f: BlockCrushDropPresentationFrame,
  a: DropReferenceCalibration,
) {
  const h = a.hud;
  if (h.kind === 'none') {
    if (a.counterTracks?.length) {
      c.fillStyle = h.background;
      c.fillRect(0, 0, 1080, h.height);
    }
    return;
  }
  if (h.kind === 'queue-panel') {
    c.fillStyle = h.background;
    c.strokeStyle = h.color;
    c.lineWidth = 12;
    c.beginPath();
    c.roundRect(24, 24, 1032, h.height - 24, 8);
    c.fill();
    c.stroke();
    return;
  }
  c.fillStyle = h.background;
  c.fillRect(0, 0, 1080, h.height);
  c.fillStyle = h.color;
  c.textBaseline = 'middle';
  const score = String(
    Math.round(
      Math.min(h.scoreCeiling ?? Infinity, h.initialScore + (f.displayScore ?? f.before.score)),
    ),
  );
  if (h.kind === 'level-score') {
    c.font = '54px Arial';
    c.textAlign = 'left';
    c.fillText(h.levelLabel, 10, h.height * 0.51);
    c.textAlign = 'right';
    c.font = `${h.scoreLabelSize ?? 54}px Arial`;
    c.fillText(h.scoreLabel, 1068, h.height * 0.51);
    c.fillStyle = '#101d2e';
    c.beginPath();
    c.roundRect(200, h.height * 0.17, 240, h.height * 0.67, 6);
    c.roundRect(642, h.height * 0.17, 240, h.height * 0.67, 6);
    c.fill();
    c.fillStyle = h.color;
    c.textAlign = 'center';
    c.font = '52px Arial';
    c.fillText(h.level, 320, h.height * 0.51);
    c.fillText(score, 762, h.height * 0.51);
    polygon(
      c,
      [
        [510, 36],
        [540, 10],
        [570, 36],
        [562, 36],
        [562, 65],
        [547, 65],
        [547, 48],
        [533, 48],
        [533, 65],
        [518, 65],
        [518, 36],
      ],
      '#cceff1',
    );
  } else if (h.kind === 'timer-score') {
    ['time', 'score', 'level'].forEach((label, i) => {
      const x = 90 + i * 450;
      c.fillStyle = h.color;
      c.textAlign = 'center';
      c.font = 'bold 26px Arial';
      c.fillText(label, x, 20);
      c.font = 'bold 43px Arial';
      c.fillText(
        i === 0
          ? String(Math.max(0, Math.ceil(h.countdown - f.frameIndex / f.fps)))
          : i === 1
            ? score
            : h.level,
        x,
        58,
      );
    });
  } else {
    c.font = 'bold 84px Arial';
    c.textAlign = 'center';
    c.fillText(score, 540, h.height * 0.6);
  }
}
/** Random-access atlas animation uses elapsed seconds, never render frame count. */
export function calibratedSpriteSource(
  cue: NonNullable<DropReferenceCalibration['spriteCues']>[number],
  seconds: number,
) {
  const anim = cue.animation,
    raw = anim
      ? Math.max(0, Math.floor((seconds - cue.startSeconds) / anim.frameSeconds + 1e-8))
      : 0,
    index = anim ? (anim.loop ? raw % anim.frames : Math.min(anim.frames - 1, raw)) : 0;
  return {
    x: cue.sourceX + (anim ? (index % anim.columns) * cue.sourceWidth : 0),
    y: cue.sourceY + (anim ? Math.floor(index / anim.columns) * cue.sourceHeight : 0),
  };
}
/** Validate every animated cell, including a wider earlier row than the final one. */
export function calibratedSpriteFits(
  cue: NonNullable<DropReferenceCalibration['spriteCues']>[number],
  width: number,
  height: number,
): boolean {
  const frames = cue.animation?.frames ?? 1,
    columns = cue.animation?.columns ?? 1;
  return (
    cue.sourceX + Math.min(frames, columns) * cue.sourceWidth <= width &&
    cue.sourceY + Math.ceil(frames / columns) * cue.sourceHeight <= height
  );
}
export function calibratedSpriteAtlas<T>(
  cue: NonNullable<DropReferenceCalibration['spriteCues']>[number],
  atlases: Partial<Record<string, T>> | undefined,
  legacy?: T,
): T | undefined {
  const slot = cue.atlasSlot ?? 'ui.atlas';
  return atlases?.[slot] ?? (slot === 'ui.atlas' ? legacy : undefined);
}
/** Track coordinates stay in output pixels even when the reference grid is stretched. */
export function calibratedTrackLogicalY(
  y: number,
  board: DropReferenceCalibration['board'],
): number {
  return board.y + (y - board.y) / (board.verticalScale ?? 1);
}
type BoundImage = { binding: RuntimeImageAssetBinding; image: CanvasImageSource };

export type CalibratedTilePainter = ((
  x: number,
  y: number,
  size: number,
  color: string,
  layer?: 'all' | 'depth' | 'face',
  depth?: number,
  worldY?: number,
) => void) & {
  /** True only when an actual tile.palette bitmap and its color entries are bound. */
  paletteBound?: boolean;
  /** Paint a reusable face into the supplied context, never the captured output. */
  paintToContext?: (
    target: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
    layer?: 'all' | 'depth' | 'face',
    depth?: number,
    worldY?: number,
  ) => void;
  /** Unlit mother-quarter image. Geometry/angle/frame/particle identity are not keys. */
  frontTexture?: (
    ix: number,
    iy: number,
    count: number,
    color: string,
    worldY?: number,
  ) => CanvasImageSource;
};
export const CALIBRATED_FRONT_TEXTURE_CACHE_LIMIT = 64;
const quarterTextures = new Map<string, CanvasImageSource>(),
  quarterSourceIds = new WeakMap<object, number>();
let nextQuarterSourceId = 1;
/** Renderer-owned bounded face cache; the geometry helper has no canvas factory. */
export function createCalibratedTilePainter(
  output: CanvasRenderingContext2D,
  a: DropReferenceCalibration,
  palette?: BoundImage,
): CalibratedTilePainter {
  const paint = (
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
    layer: 'all' | 'depth' | 'face' = 'all',
    depth = a.paletteDepth,
    worldY?: number,
  ) => {
    const colors = a.tilePaletteColors;
    if (!palette || !colors) {
      if (layer !== 'depth') drawCalibratedDropTile(c, x, y, size, color, a);
      return;
    }
    const rgb = (s: string) => {
      const v = parseInt(s.slice(1), 16);
      return [v >> 16, (v >> 8) & 255, v & 255];
    };
    const target = rgb(color);
    let index = 0,
      best = Infinity;
    colors.forEach((color, i) => {
      const d = rgb(color).reduce((sum, v, j) => sum + (v - target[j]!) ** 2, 0);
      if (d < best) {
        best = d;
        index = i;
      }
    });
    const w = palette.binding.width!,
      h = palette.binding.height!,
      crop = a.tilePaletteCropPixels ?? { top: 0, right: 0, bottom: 0, left: 0 };
    let other = index,
      mix = 0;
    if (a.boardColorKeys && best > 9) {
      for (let i = 0; i < colors.length; i++)
        for (let j = i + 1; j < colors.length; j++) {
          const u = rgb(colors[i]!),
            v = rgb(colors[j]!),
            d = v.map((x, k) => x - u[k]!),
            norm = d.reduce((s, x) => s + x * x, 0);
          const t = Math.max(
            0,
            Math.min(1, d.reduce((s, x, k) => s + x * (target[k]! - u[k]!), 0) / Math.max(1, norm)),
          );
          const error = u.reduce((s, x, k) => s + (x + t * d[k]! - target[k]!) ** 2, 0);
          if (error < best) {
            best = error;
            index = i;
            other = j;
            mix = t;
          }
        }
    }
    if (depth && layer !== 'face') {
      const d = size * depth;
      c.save();
      c.shadowColor = `rgba(0,0,0,${Math.min(0.8, a.shadow * 0.65)})`;
      c.shadowBlur = size * 0.24;
      c.shadowOffsetX = d * 0.65;
      c.shadowOffsetY = d * 1.2;
      c.fillStyle = a.paletteDepthColor ?? shade(color, 0.46);
      c.fillRect(x, y, size, size + d);
      c.restore();
      polygon(
        c,
        [
          [x, y + size],
          [x + size, y + size],
          [x + size + d * 0.25, y + size + d],
          [x + d * 0.25, y + size + d],
        ],
        a.paletteDepthColor ?? shade(color, 0.52),
      );
      polygon(
        c,
        [
          [x + size, y],
          [x + size + d * 0.25, y + d],
          [x + size + d * 0.25, y + size + d],
          [x + size, y + size],
        ],
        a.paletteDepthColor ? shade(a.paletteDepthColor, 0.82) : shade(color, 0.42),
      );
    }
    if (layer === 'depth') return;
    const lighting = a.tilePaletteLighting,
      rowHeight = h / (lighting?.rows ?? 1),
      row =
        lighting && worldY !== undefined
          ? Math.max(
              0,
              Math.min(
                lighting.rows - 1,
                ((worldY - lighting.top) / (lighting.bottom - lighting.top)) * (lighting.rows - 1),
              ),
            )
          : 0,
      lower = Math.floor(row),
      rowMix = row - lower;
    const paintRow = (i: number, j: number) =>
      c.drawImage(
        palette.image,
        (i * w) / colors.length + crop.left,
        j * rowHeight + crop.top,
        w / colors.length - crop.left - crop.right,
        rowHeight - crop.top - crop.bottom,
        x,
        y,
        size,
        size,
      );
    const paint = (i: number) => {
      paintRow(i, lower);
      if (rowMix > 0) {
        c.save();
        c.globalAlpha *= rowMix;
        paintRow(i, lower + 1);
        c.restore();
      }
    };
    paint(index);
    if (mix > 0) {
      c.save();
      c.globalAlpha *= mix;
      paint(other);
      c.restore();
    }
  };
  const tile: CalibratedTilePainter = (...args) => paint(output, ...args);
  tile.paintToContext = paint;
  tile.paletteBound = !!(palette && a.tilePaletteColors?.length);
  tile.frontTexture = (ix, iy, count, color, worldY) => {
    const source = palette?.image as object | undefined;
    let identity = 0;
    if (source) {
      identity = quarterSourceIds.get(source) ?? nextQuarterSourceId++;
      quarterSourceIds.set(source, identity);
    }
    const lighting = a.tilePaletteLighting,
      row =
        lighting && worldY !== undefined
          ? Math.max(
              0,
              Math.min(
                lighting.rows - 1,
                ((worldY - lighting.top) / (lighting.bottom - lighting.top)) * (lighting.rows - 1),
              ),
            )
          : 0;
    // Fixed 64px quarters avoid pose-dependent resampling or cache growth. Parent
    // palette row blending is preserved exactly; its continuous values are LRU-
    // bounded, not rounded to a different authored appearance.
    const pixels = 64,
      key = JSON.stringify([
        identity,
        palette?.binding.width,
        palette?.binding.height,
        a.tilePaletteColors,
        a.tilePaletteCropPixels,
        !!a.boardColorKeys,
        lighting?.rows,
        row,
        ix,
        iy,
        count,
        color,
        pixels,
        palette && a.tilePaletteColors
          ? null
          : [a.material, a.bevel, a.seam, a.shadow, a.faceShading],
      ]);
    const cached = quarterTextures.get(key);
    if (cached) {
      quarterTextures.delete(key);
      quarterTextures.set(key, cached);
      return cached;
    }
    const owner = (output.canvas as HTMLCanvasElement | undefined)?.ownerDocument;
    const canvas = owner
      ? owner.createElement('canvas')
      : typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(pixels, pixels)
        : undefined;
    if (!canvas) throw new Error('ROUNDED_FRAGMENT_FRONT_TEXTURE_CANVAS_UNAVAILABLE');
    canvas.width = pixels;
    canvas.height = pixels;
    const target = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!target) throw new Error('ROUNDED_FRAGMENT_FRONT_TEXTURE_CONTEXT_UNAVAILABLE');
    target.save();
    try {
      target.beginPath();
      target.rect(0, 0, pixels, pixels);
      target.clip();
      paint(
        target,
        ix ? -ix * pixels : 0,
        iy ? -iy * pixels : 0,
        pixels * count,
        color,
        'face',
        0,
        worldY,
      );
    } finally {
      target.restore();
    }
    if (quarterTextures.size >= CALIBRATED_FRONT_TEXTURE_CACHE_LIMIT)
      quarterTextures.delete(quarterTextures.keys().next().value!);
    quarterTextures.set(key, canvas);
    return canvas;
  };
  return tile;
}

/** Imported sequences own their whole cue, including a transparent tail after their final frame. */
export function calibratedHasNativeDepthCue(f: BlockCrushDropPresentationFrame): boolean {
  return (
    (f.before.config.presentation.referenceCalibration?.clear?.nativeInertial === true ||
      f.before.config.presentation.referenceCalibration?.clear?.fragmentDepthRenderer ===
        'webgl-opaque') &&
    (f.lingeringClears ?? (f.lingeringClear ? [f.lingeringClear] : [])).some((cue) => !cue.sequence)
  );
}

export function drawCalibratedDropStage(
  c: CanvasRenderingContext2D,
  f: BlockCrushDropPresentationFrame,
  assets?: {
    background?: BoundImage;
    tilePalette?: BoundImage;
    uiAtlas?: BoundImage;
    uiAtlases?: Partial<Record<string, BoundImage>>;
    observedDepthLayer?: ObservedFragmentDepthLayerService;
    encouragementGlyphs?: DropEncouragementGlyphLayerService;
    clearSequences?: {
      draw(context: CanvasRenderingContext2D, frame: BlockCrushDropPresentationFrame): void;
    };
  },
): void {
  const a = f.before.config.presentation.referenceCalibration!;
  const cfg = f.before.config,
    b = a.board;
  const boardFrame = calibratedFieldRiseBoardFrame(f, a);
  c.save();
  const saturationKeys = a.sceneSaturationKeys;
  if (saturationKeys) {
    const t = f.frameIndex / f.fps,
      i = saturationKeys.findIndex((k) => k.seconds >= t),
      end = saturationKeys[i < 0 ? saturationKeys.length - 1 : i]!,
      start = saturationKeys[Math.max(0, (i < 0 ? saturationKeys.length - 1 : i) - 1)]!,
      u =
        end.seconds === start.seconds
          ? 0
          : Math.max(0, Math.min(1, (t - start.seconds) / (end.seconds - start.seconds)));
    const value = start.value + (end.value - start.value) * u;
    if (value < 1) c.filter = `saturate(${value})`;
  }
  c.fillStyle = a.background;
  c.fillRect(0, 0, 1080, 1920);
  c.fillStyle = b.background;
  c.fillRect(b.x, b.y, b.cell * cfg.columns, b.height ?? b.cell * cfg.rows);
  if (assets?.background)
    drawRuntimeImage(c, assets.background.image, assets.background.binding, 1080, 1920);
  const seconds = f.frameIndex / f.fps;
  const drawSprites = (layer: 'background' | 'overlay') => {
    for (const cue of a.spriteCues ?? []) {
      if ((cue.layer ?? 'overlay') !== layer) continue;
      const atlas = calibratedSpriteAtlas(cue, assets?.uiAtlases, assets?.uiAtlas);
      if (seconds < cue.startSeconds || seconds >= cue.endSeconds || !atlas) continue;
      c.save();
      if (cue.preserveColor) c.filter = 'none';
      if (cue.clipToBoard) {
        c.beginPath();
        c.rect(
          b.x,
          Math.max(b.y, a.hud.height),
          cfg.columns * b.cell,
          1920 - Math.max(b.y, a.hud.height),
        );
        c.clip();
      }
      c.globalAlpha = Math.min(
        1,
        cue.fadeInSeconds ? (seconds - cue.startSeconds) / cue.fadeInSeconds : 1,
        cue.fadeOutSeconds ? (cue.endSeconds - seconds) / cue.fadeOutSeconds : 1,
      );
      const source = calibratedSpriteSource(cue, seconds);
      c.drawImage(
        atlas.image,
        source.x,
        source.y,
        cue.sourceWidth,
        cue.sourceHeight,
        cue.x,
        cue.y,
        cue.width,
        cue.height,
      );
      c.restore();
    }
  };
  drawSprites('background');
  const tile = createCalibratedTilePainter(c, a, assets?.tilePalette);
  c.save();
  c.beginPath();
  c.rect(
    b.x,
    Math.min(b.y, b.gridY ?? b.y),
    b.cell * cfg.columns,
    Math.min(1920 - Math.min(b.y, b.gridY ?? b.y), b.height ?? b.cell * cfg.rows),
  );
  c.clip();
  const verticalScale = b.verticalScale ?? 1;
  c.translate(0, b.y);
  c.scale(1, verticalScale);
  c.translate(0, -b.y);
  c.strokeStyle = b.line;
  c.lineWidth = b.lineWidth ?? Math.max(0.5, b.cell * 0.027);
  if (b.verticalLines !== false)
    for (let x = 0; x <= cfg.columns; x++) {
      c.beginPath();
      c.moveTo(b.x + x * b.cell, Math.min(b.y, b.gridY ?? b.y));
      c.lineTo(b.x + x * b.cell, 1920);
      c.stroke();
    }
  if (b.horizontalLines)
    for (let y = 0; y <= cfg.rows; y++) {
      c.beginPath();
      c.moveTo(b.x, (b.gridY ?? b.y) + y * b.cell);
      c.lineTo(b.x + cfg.columns * b.cell, (b.gridY ?? b.y) + y * b.cell);
      c.stroke();
    }
  const semanticTrack = a.pieceTracks?.find((t) => t.actionIndex === f.before.turn);
  const track = a.pieceTracks?.find(
    (t) => calibratedTrackVisible(t, seconds) && (t.pieceId || t.actionIndex === f.before.turn),
  );
  const allClearCues = f.lingeringClears ?? (f.lingeringClear ? [f.lingeringClear] : []);
  const clearCues = allClearCues.filter((cue) => !cue.sequence);
  const nativeMode = a.clear?.nativeInertial === true;
  const nativePackets = nativeMode
    ? calibratedNativeFragmentPackets(f, a, (id, kind, fragmentId) => {
        const owner = allClearCues.find((cue) =>
          cue.eliminatedCells.some((cell) => cell.id === id),
        );
        const colorFrame = owner
          ? {
              ...f,
              lingeringClear: owner,
              ...(a.clear?.freezeColorAtRelease
                ? { frameIndex: f.frameIndex - owner.elapsedFrames }
                : {}),
            }
          : f;
        return calibratedClearColor(id, kind, colorFrame, a, fragmentId);
      })
    : undefined;
  const depthPackets: ObservedFragmentDepthPacket[] | undefined =
    !nativeMode && calibratedHasNativeDepthCue(f) ? [] : undefined;
  if (nativePackets?.length && !assets?.observedDepthLayer?.drawNative)
    throw new Error('DROP_NATIVE_INERTIAL_DEPTH_LAYER_REQUIRED');
  if (depthPackets && !assets?.observedDepthLayer)
    throw new Error('OBSERVED_FRAGMENT_DEPTH_LAYER_REQUIRED');
  const measuredWave = (cue: NonNullable<BlockCrushDropPresentationFrame['lingeringClear']>) =>
    isDropObservedFragmentMotionV2(
      cue.observedFragmentMotionV2 ??
        a.observedFragmentMotionCues?.find(
          (q) => q.actionIndex === cue.actionIndex && q.cycleIndex === cue.cycleIndex,
        )?.motion,
    );
  // Sequence replacement also removes its intact parents; filtering the ownership
  // set together with the native draw queue would make those mothers reappear.
  const clearIds = new Set(
    a.clear ? allClearCues.flatMap((cue) => cue.eliminatedCells.map((cell) => cell.id)) : [],
  );
  const tileFrame = { ...boardFrame };
  if (a.clear) {
    delete tileFrame.lingeringClear;
    delete tileFrame.lingeringClears;
  }
  const stageCells = cellsForBlockCrushDropFrame(tileFrame);
  const tileLayers: Array<'all' | 'depth' | 'face'> =
    a.paletteDepth || a.airbornePaletteDepth ? ['depth', 'face'] : ['all'];
  for (const layer of tileLayers)
    for (const cell of stageCells) {
      if (clearIds.has(cell.id)) continue;
      if (
        semanticTrack &&
        cell.presentationLayer === 'interaction' &&
        (a.respectPieceTrackWindows === true || calibratedTrackVisible(semanticTrack, seconds))
      )
        continue;
      if (a.clear && cell.appearance === 'debris-fragment') continue;
      const p = blockCrushDropScreenPosition(
        f.before,
        cell.x,
        cell.y,
        boardFrame.fieldRiseOffsetCells,
      );
      c.save();
      c.globalAlpha = cell.alpha ?? 1;
      c.translate(p.x + b.cell / 2, p.y + b.cell / 2);
      c.rotate(cell.rotationZ ?? 0);
      const s = cell.scale ?? 1;
      c.scale(s, s);
      const paint = calibratedLandingPaint(cell.id, cell.kind, f, a);
      tile(
        -b.cell / 2,
        -b.cell / 2,
        b.cell,
        paint.mix < 1 ? paint.source : paint.target,
        layer,
        a.paletteDepth,
        b.y + (p.y + b.cell / 2 - b.y) * verticalScale,
      );
      if (paint.mix > 0 && paint.mix < 1) {
        c.globalAlpha *= paint.mix;
        tile(
          -b.cell / 2,
          -b.cell / 2,
          b.cell,
          paint.target,
          layer,
          a.paletteDepth,
          b.y + (p.y + b.cell / 2 - b.y) * verticalScale,
        );
      }
      if (layer !== 'depth' && a.landingSurfaceFlashCues?.length) {
        // Crossfade paint alpha belongs only to the source/target textures, not the flash.
        c.globalAlpha = cell.alpha ?? 1;
        drawDropLandingSurfaceFlash(
          c,
          a.landingSurfaceFlashCues,
          f.landingSurfaceFlashes,
          cell,
          f.fps,
          -b.cell / 2,
          -b.cell / 2,
          b.cell,
        );
      }
      c.restore();
    }
  for (const cue of a.introCellCues ?? []) {
    if (seconds < cue.startSeconds || seconds >= cue.endSeconds + cue.shatterSeconds) continue;
    const p = blockCrushDropScreenPosition(
      f.before,
      cue.x,
      cue.y + f.fieldPreviewRows + f.fieldIncomingRowIndex,
      boardFrame.fieldRiseOffsetCells,
    );
    if (seconds < cue.endSeconds) {
      tile(p.x, p.y, b.cell, cue.color);
      continue;
    }
    const age = seconds - cue.endSeconds,
      u = age / Math.max(0.001, cue.shatterSeconds);
    for (let iy = 0; iy < 4; iy++)
      for (let ix = 0; ix < 4; ix++) {
        const r = random(`${cue.id}:${ix}:${iy}`),
          q = random(`${cue.id}:${ix}:${iy}:b`),
          size = (b.cell / 4) * (1.1 + r * 0.8),
          flow = 1 - Math.exp(-age * 5);
        c.save();
        c.globalAlpha = 1 - Math.pow(u, 4);
        c.translate(
          p.x + ((ix + 0.5) * b.cell) / 4 + (r - 0.5) * b.cell * 4 * flow,
          p.y + ((iy + 0.5) * b.cell) / 4 + (q - 0.5) * b.cell * 2 * flow + 650 * age * age,
        );
        c.rotate(age * (r - 0.5) * 12);
        drawFacetedChip(c, size, cue.color, age, r, q, 0.7, 0.35);
        c.restore();
      }
  }
  if (a.clear && !nativeMode && !a.clear.fragmentPhysics && a.clear.motionModel !== 'layered-curve')
    for (const cue of clearCues)
      if (!measuredWave(cue))
        drawCalibratedFragments(c, { ...f, lingeringClear: cue }, a, tile, depthPackets);
  if (track) {
    const { x, y, angle, scaleX, scaleY } = calibratedTrackPoseAt(track, seconds);
    const ref = cfg.trayBatches[f.before.batchIndex]?.[f.action?.traySlot ?? 0],
      piece = cfg.pieces.find((p) => p.id === (track.pieceId ?? ref?.pieceId));
    if (piece) {
      const shape = rotatedShape(piece, track.pieceId ? 0 : (ref?.quarterTurns ?? 0)),
        w = 1 + Math.max(...shape.map((p) => p.x)),
        h = 1 + Math.max(...shape.map((p) => p.y));
      c.save();
      c.translate(x, calibratedTrackLogicalY(y, b));
      if (a.fallTrail) {
        const before =
            track.samples.filter((p) => p.seconds <= seconds - 0.067).at(-1) ?? track.samples[0]!,
          after = track.samples.find((p) => p.seconds >= seconds + 0.033) ?? track.samples.at(-1)!,
          speed = (after.y - before.y) / Math.max(0.001, after.seconds - before.seconds),
          length = calibratedFallTrailLength(speed, a.fallTrail);
        if (length > 0) {
          const color = parseInt(a.fallTrail.color.slice(1), 16),
            rgb = [color >> 16, (color >> 8) & 255, color & 255].join(',');
          c.save();
          c.globalCompositeOperation = 'screen';
          const gradient = c.createLinearGradient(
            0,
            (-h * b.cell) / 2 - length,
            0,
            (h * b.cell) / 2,
          );
          gradient.addColorStop(0, `rgba(${rgb},0)`);
          gradient.addColorStop(1, `rgba(${rgb},${a.fallTrail.opacity})`);
          c.fillStyle = gradient;
          c.fillRect(
            (-w * b.cell) / 2,
            (-h * b.cell) / 2 - length,
            w * b.cell,
            h * b.cell + length,
          );
          c.restore();
        }
      }
      if (track.surfaceOrientation !== 'world') {
        c.rotate((angle * Math.PI) / 180);
        if (scaleX !== 1 || scaleY !== 1) c.scale(scaleX, scaleY);
        for (const layer of tileLayers)
          for (const p of shape) {
            c.save();
            const worldY = calibratedTrackCellWorldY(
              { x, y, angle, scaleX, scaleY },
              (p.x + 0.5 - w / 2) * b.cell,
              (h / 2 - p.y - 0.5) * b.cell,
              b,
            );
            tile(
              (p.x - w / 2) * b.cell,
              (h / 2 - p.y - 1) * b.cell,
              b.cell,
              /^#/.test(piece.kind) ? piece.kind : a.tileColor,
              layer,
              a.airbornePaletteDepth ?? a.paletteDepth,
              worldY,
            );
            c.restore();
          }
      } else {
        const pose = { x, y, angle, scaleX, scaleY };
        for (const layer of tileLayers)
          for (const p of shape) {
            const dx = (p.x + 0.5 - w / 2) * b.cell,
              dy = (h / 2 - p.y - 0.5) * b.cell,
              worldY = calibratedTrackCellWorldY(pose, dx, dy, b),
              color = /^#/.test(piece.kind) ? piece.kind : a.tileColor;
            c.save();
            if (layer === 'depth') {
              // Extrusion follows the original geometry; this option changes surface painting only.
              c.rotate((angle * Math.PI) / 180);
              if (scaleX !== 1 || scaleY !== 1) c.scale(scaleX, scaleY);
              tile(
                dx - b.cell / 2,
                dy - b.cell / 2,
                b.cell,
                color,
                layer,
                a.airbornePaletteDepth ?? a.paletteDepth,
                worldY,
              );
            } else {
              const surface = calibratedTrackCellSurface(pose, dx, dy, b.cell);
              if (surface.width > 1e-8 && surface.height > 1e-8) {
                c.translate(surface.x, surface.y);
                c.beginPath();
                surface.corners.forEach((point, i) =>
                  i ? c.lineTo(point.x, point.y) : c.moveTo(point.x, point.y),
                );
                c.closePath();
                c.clip();
                c.scale(surface.width / b.cell, surface.height / b.cell);
                tile(
                  -b.cell / 2,
                  -b.cell / 2,
                  b.cell,
                  color,
                  layer,
                  a.airbornePaletteDepth ?? a.paletteDepth,
                  worldY,
                );
              }
            }
            c.restore();
          }
      }
      c.restore();
    }
  }
  c.restore();
  // Released physical fragments belong to the screen, not to the board's lower clip.
  // Keep the board's geometry transform, while allowing them to cross its bottom edge.
  if (
    nativeMode ||
    a.clear?.fragmentPhysics ||
    a.clear?.motionModel === 'layered-curve' ||
    clearCues.some(measuredWave)
  ) {
    c.save();
    c.beginPath();
    c.rect(0, Math.max(0, a.hud.height), 1080, 1920 - Math.max(0, a.hud.height));
    c.clip();
    c.translate(0, b.y);
    c.scale(1, verticalScale);
    c.translate(0, -b.y);
    for (const cue of clearCues)
      if (
        !nativeMode &&
        (a.clear?.fragmentPhysics || a.clear?.motionModel === 'layered-curve' || measuredWave(cue))
      )
        drawCalibratedFragments(c, { ...f, lingeringClear: cue }, a, tile, depthPackets);
    if (nativePackets?.length) {
      c.save();
      try {
        c.translate(0, b.y);
        c.scale(1, 1 / verticalScale);
        c.translate(0, -b.y);
        assets!.observedDepthLayer!.drawNative!(c, nativePackets, a.clear!);
      } finally {
        c.restore();
      }
    }
    if (depthPackets) {
      // One shared frame batch, including overlapping waves. Absolute stage poses
      // cancel only the existing board stretch; clips and saturation stay owned here.
      c.save();
      try {
        c.translate(0, b.y);
        c.scale(1, 1 / verticalScale);
        c.translate(0, -b.y);
        assets!.observedDepthLayer!.draw(c, depthPackets, a.clear!);
      } finally {
        c.restore();
      }
    }
    c.restore();
  }
  // The sequence replaces native fragments at their existing layer boundary.
  // Paint the calibrated HUD/UI once above it, never the ordinary wood header.
  assets?.clearSequences?.draw(c, f);
  if (a.impactBeamCues?.length)
    drawDropImpactBeams(c, a.impactBeamCues, f.impactBeamWaves ?? allClearCues, f.fps);
  drawHud(c, f, a);
  for (const counter of a.counterTracks ?? []) {
    const sample = counter.samples.filter((k) => k.seconds <= seconds).at(-1);
    if (!sample) continue;
    c.save();
    c.filter = 'none';
    if (counter.iconSize > 0)
      tile(counter.x, counter.y - counter.iconSize / 2, counter.iconSize, counter.color);
    c.font =
      counter.font === 'serif'
        ? `${counter.fontSize}px "Times New Roman", serif`
        : `bold ${counter.fontSize}px Arial`;
    c.textAlign = counter.align ?? 'left';
    c.textBaseline = 'middle';
    c.fillStyle =
      counter.textColorKeys?.filter((k) => k.seconds <= seconds).at(-1)?.color ?? a.hud.color;
    const value = Math.round(sample.value),
      base = counter.format === 'seconds-sixtieths' ? 60 : 100,
      label =
        counter.format && counter.format !== 'integer'
          ? `${Math.floor(value / base)}:${String(value % base).padStart(2, '0')}`
          : String(value);
    c.fillText(
      label,
      counter.x + counter.iconSize + (counter.iconSize > 0 || !counter.align ? 6 : 0),
      counter.y + 2,
    );
    c.restore();
  }
  if (a.queue.visible) {
    const state = f.phase === 'commit' ? f.before : f.after;
    for (const slot of state.remainingTraySlots) {
      const ref = cfg.trayBatches[state.batchIndex]?.[slot];
      const piece = cfg.pieces.find((p) => p.id === ref?.pieceId);
      if (!piece || !ref) continue;
      const shape = rotatedShape(piece, ref.quarterTurns),
        size = b.cell * a.queue.scale,
        w = Math.max(...shape.map((p) => p.x)) + 1;
      for (const p of shape) {
        c.save();
        tile(
          180 + slot * 360 + (p.x - w / 2) * size,
          a.queue.y - p.y * size,
          size,
          /^#/.test(piece.kind) ? piece.kind : a.tileColor,
        );
        c.restore();
      }
    }
  }
  for (const preview of a.queuePreviews ?? []) {
    if (seconds < preview.startSeconds || seconds >= preview.endSeconds) continue;
    const piece = cfg.pieces.find((p) => p.id === preview.pieceId);
    if (!piece) continue;
    const shape = rotatedShape(piece, preview.quarterTurns),
      size = b.cell * preview.scale,
      w = 1 + Math.max(...shape.map((p) => p.x)),
      h = 1 + Math.max(...shape.map((p) => p.y));
    for (const point of shape) {
      c.save();
      tile(
        preview.x + (point.x - w / 2) * size,
        preview.y + (h / 2 - point.y - 1) * size,
        size,
        /^#/.test(piece.kind) ? piece.kind : a.tileColor,
      );
      c.restore();
    }
  }
  drawSprites('overlay');
  if (a.encouragementGlyphCues?.length) {
    if (!assets?.encouragementGlyphs) throw new Error('DROP_ENCOURAGEMENT_GLYPH_RENDERER_REQUIRED');
    assets.encouragementGlyphs.draw(c, f, assets.uiAtlases ?? {});
  }
  const vignette = a.screenVignette;
  if (vignette) {
    const next = vignette.samples.findIndex((s) => s.seconds >= seconds),
      end = vignette.samples[next < 0 ? vignette.samples.length - 1 : next]!,
      start = vignette.samples[Math.max(0, (next < 0 ? vignette.samples.length - 1 : next) - 1)]!;
    const u =
        end.seconds === start.seconds
          ? 0
          : Math.max(0, Math.min(1, (seconds - start.seconds) / (end.seconds - start.seconds))),
      opacity = start.opacity + (end.opacity - start.opacity) * u;
    if (opacity > 0) {
      c.save();
      c.globalAlpha = opacity;
      c.translate(540, 960);
      c.scale(540, 960);
      const gradient = c.createRadialGradient(0, 0, 1 - vignette.inset * 2, 0, 0, 1.4);
      gradient.addColorStop(0, vignette.color + '00');
      gradient.addColorStop(0.5, vignette.color + '99');
      gradient.addColorStop(1, vignette.color);
      c.fillStyle = gradient;
      c.fillRect(-1, -1, 2, 2);
      c.restore();
    }
  }
  for (const cue of a.guidance ?? []) {
    if (seconds < cue.startSeconds || seconds >= cue.endSeconds) continue;
    c.save();
    c.globalAlpha = cue.fadeSeconds
      ? Math.min(
          1,
          (seconds - cue.startSeconds) / cue.fadeSeconds,
          (cue.endSeconds - seconds) / cue.fadeSeconds,
        )
      : 1;
    c.font = `${cue.weight} ${cue.size}px Arial`;
    c.textAlign = cue.align;
    c.textBaseline = 'middle';
    c.fillStyle = cue.color;
    c.strokeStyle = cue.outline;
    c.lineWidth = cue.outlineWidth;
    c.lineJoin = 'round';
    cue.text.split('\n').forEach((line, i) => {
      const y = cue.y + i * cue.size * 1.15;
      if (cue.outlineWidth) c.strokeText(line, cue.x, y);
      c.fillText(line, cue.x, y);
    });
    c.restore();
  }
  c.restore();
}

function random(id: string) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
type NativeMaterialScratch = {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  context: CanvasRenderingContext2D;
};
const nativeMaterialScratches = new WeakMap<CanvasRenderingContext2D, NativeMaterialScratch>();
/** One opacity application per particle: underlay, bitmap, lighting and its shadow
 * are composed at full opacity locally, never repeatedly over the stage. */
function drawNativeMaterialAtOpacity(
  c: CanvasRenderingContext2D,
  size: number,
  paint: (target: CanvasRenderingContext2D) => void,
) {
  let scratch = nativeMaterialScratches.get(c);
  if (!scratch) {
    const owner = (c.canvas as HTMLCanvasElement | undefined)?.ownerDocument;
    const canvas = owner
      ? owner.createElement('canvas')
      : typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1)
        : undefined;
    const context = canvas?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
    if (!canvas || !context) throw new Error('DROP_FRAGMENT_MATERIAL_OPACITY_CANVAS_UNAVAILABLE');
    scratch = { canvas, context };
    nativeMaterialScratches.set(c, scratch);
  }
  // Includes the existing blurred shadows, whose largest reach is <1.4 sizes.
  const half = Math.ceil(size * 1.4) + 2,
    pixels = half * 2,
    { canvas, context } = scratch;
  if (canvas.width < pixels || canvas.height < pixels) {
    canvas.width = 2 ** Math.ceil(Math.log2(pixels));
    canvas.height = canvas.width;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.filter = 'none';
  context.translate(half, half);
  try {
    paint(context);
  } finally {
    context.restore();
  }
  // c.globalAlpha is the original native fade. Do not apply it inside paint.
  c.drawImage(canvas, 0, 0, pixels, pixels, -half, -half, pixels, pixels);
}
/** Map a palette patch in object-face coordinates; tumbling never resets UVs to screen axes. */
function paintNativeFragmentFace(
  c: CanvasRenderingContext2D,
  points: number[][],
  objectPoints: number[][],
  size: number,
  texture: CanvasImageSource,
  brightness: number,
) {
  const origin = objectPoints[0]!,
    edge = objectPoints[1]!.map((v, i) => v - origin[i]!),
    length = Math.hypot(...edge),
    axis = edge.map((v) => v / length),
    other = objectPoints[2]!.map((v, i) => v - origin[i]!);
  const normal = [
      axis[1]! * other[2]! - axis[2]! * other[1]!,
      axis[2]! * other[0]! - axis[0]! * other[2]!,
      axis[0]! * other[1]! - axis[1]! * other[0]!,
    ],
    nl = Math.hypot(...normal);
  if (length < 1e-9 || nl < 1e-9) return;
  const n = normal.map((v) => v / nl),
    up = [
      n[1]! * axis[2]! - n[2]! * axis[1]!,
      n[2]! * axis[0]! - n[0]! * axis[2]!,
      n[0]! * axis[1]! - n[1]! * axis[0]!,
    ];
  const uv = objectPoints.map((p) => {
    const d = p.map((v, i) => v - origin[i]!);
    return [d.reduce((v, q, i) => v + q * axis[i]!, 0), d.reduce((v, q, i) => v + q * up[i]!, 0)];
  });
  const minX = Math.min(...uv.map((p) => p[0]!)),
    minY = Math.min(...uv.map((p) => p[1]!)),
    w = Math.max(...uv.map((p) => p[0]!)) - minX,
    h = Math.max(...uv.map((p) => p[1]!)) - minY;
  if (w < 1e-9 || h < 1e-9) return;
  const source = uv.map((p) => [(p[0]! - minX) / w, (p[1]! - minY) / h]);
  // Existing opaque polygon remains underneath transparent bevel pixels.
  for (let i = 1; i < points.length - 1; i++) {
    const ids = [0, i, i + 1],
      q = ids.map((j) => source[j]!),
      d = ids.map((j) => points[j]!.map((v) => v * size)),
      a = q[0]!,
      b = q[1]!,
      z = q[2]!,
      den = (b[0]! - a[0]!) * (z[1]! - a[1]!) - (b[1]! - a[1]!) * (z[0]! - a[0]!);
    if (Math.abs(den) < 1e-9) continue;
    const x = d.map((p) => p[0]!),
      y = d.map((p) => p[1]!),
      solve = (v: number[]) => {
        const u = ((v[1]! - v[0]!) * (z[1]! - a[1]!) - (v[2]! - v[0]!) * (b[1]! - a[1]!)) / den,
          k = ((b[0]! - a[0]!) * (v[2]! - v[0]!) - (z[0]! - a[0]!) * (v[1]! - v[0]!)) / den;
        return [u, k, v[0]! - u * a[0]! - k * a[1]!];
      },
      tx = solve(x),
      ty = solve(y);
    c.save();
    c.beginPath();
    c.moveTo(x[0]!, y[0]!);
    c.lineTo(x[1]!, y[1]!);
    c.lineTo(x[2]!, y[2]!);
    c.closePath();
    c.clip();
    c.transform(tx[0]!, ty[0]!, tx[1]!, ty[1]!, tx[2]!, ty[2]!);
    c.filter = `${c.filter && c.filter !== 'none' ? c.filter + ' ' : ''}brightness(${brightness})`;
    c.drawImage(texture, 0, 0, 1, 1);
    c.restore();
  }
}
function drawFacetedChip(
  c: CanvasRenderingContext2D,
  size: number,
  color: string,
  age: number,
  r: number,
  r2: number,
  highlight: number,
  shadow: number,
  ambient?: number,
  texture?: CanvasImageSource,
) {
  if (texture && c.globalAlpha < 1) {
    drawNativeMaterialAtOpacity(c, size, (target) =>
      drawFacetedChip(target, size, color, age, r, r2, highlight, shadow, ambient, texture),
    );
    return;
  }
  const ax = r * 6.28 + age * (3 + r2 * 5),
    ay = r2 * 6.28 + age * (2 + r * 7);
  const objectVertices = [
      [-0.5, -0.4, -0.22],
      [0.45, -0.32, -0.22],
      [0.08, 0.5, -0.22],
      [-0.5, -0.4, 0.22],
      [0.45, -0.32, 0.22],
      [0.08, 0.5, 0.22],
    ],
    vertices = objectVertices.map(([x, y, z]) => {
      const yy = y! * Math.cos(ax) - z! * Math.sin(ax),
        zz = y! * Math.sin(ax) + z! * Math.cos(ax);
      return [x! * Math.cos(ay) + zz * Math.sin(ay), yy, -x! * Math.sin(ay) + zz * Math.cos(ay)];
    });
  const faces = [
    [0, 2, 1],
    [3, 4, 5],
    [0, 1, 4, 3],
    [1, 2, 5, 4],
    [2, 0, 3, 5],
  ]
    .map((ids) => {
      const p = ids.map((i) => vertices[i]!),
        a = p[0]!,
        b = p[1]!,
        d = p[2]!;
      const u = b.map((v, i) => v - a[i]!),
        v = d.map((v, i) => v - a[i]!);
      const normal = [
        u[1]! * v[2]! - u[2]! * v[1]!,
        u[2]! * v[0]! - u[0]! * v[2]!,
        u[0]! * v[1]! - u[1]! * v[0]!,
      ];
      const len = Math.hypot(...normal),
        light = Math.max(0, (-normal[0]! * 0.35 - normal[1]! * 0.55 + normal[2]! * 0.76) / len);
      return {
        p,
        ids,
        depth: p.reduce((sum, v) => sum + v[2]!, 0) / p.length,
        light,
        visible: normal[2]! > 0,
      };
    })
    .sort((a, b) => a.depth - b.depth);
  if (shadow > 0) {
    // Paint one silhouette; repeated face shadows would multiply into black patches.
    const pts = vertices
      .map((p) => [p[0]! * size, p[1]! * size])
      .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
    const cross = (a: number[], b: number[], d: number[]) =>
      (b[0]! - a[0]!) * (d[1]! - a[1]!) - (b[1]! - a[1]!) * (d[0]! - a[0]!);
    const half = (points: number[][]) => {
      const h: number[][] = [];
      for (const p of points) {
        while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, p) <= 0) h.pop();
        h.push(p);
      }
      h.pop();
      return h;
    };
    const hull = [...half(pts), ...half([...pts].reverse())];
    c.save();
    c.translate(size * 0.13, size * 0.18);
    c.globalAlpha *= shadow;
    polygon(c, hull, ambient === undefined ? '#351b2b' : '#000000');
    c.restore();
  }
  for (const face of faces) {
    if (ambient !== undefined && !face.visible) continue;
    const brightness =
      ambient === undefined
        ? (shadow > 0 ? 0.4 : 0.22) + face.light * (0.8 + highlight * 0.4)
        : calibratedFragmentMaterialBrightness(face.light, ambient, highlight);
    polygon(
      c,
      face.p.map((p) => [p[0]! * size, p[1]! * size]),
      shade(color, brightness),
    );
    if (texture)
      paintNativeFragmentFace(
        c,
        face.p,
        face.ids.map((i) => objectVertices[i]!),
        size,
        texture,
        brightness,
      );
  }
}
/** Thick irregular beveled fragments with neutral lighting and visible-face culling. */
function drawFacetedRock(
  c: CanvasRenderingContext2D,
  size: number,
  color: string,
  age: number,
  r: number,
  r2: number,
  highlight: number,
  shadow: number,
  ambient?: number,
  texture?: CanvasImageSource,
) {
  if (texture && c.globalAlpha < 1) {
    drawNativeMaterialAtOpacity(c, size, (target) =>
      drawFacetedRock(target, size, color, age, r, r2, highlight, shadow, ambient, texture),
    );
    return;
  }
  const ax = r * 6.28 + age * (2 + r2 * 4),
    ay = r2 * 6.28 + age * (3 + r * 4),
    ca = Math.cos(ax),
    sa = Math.sin(ax),
    cb = Math.cos(ay),
    sb = Math.sin(ay);
  const vertices: number[][] = [],
    objectVertices: number[][] = [];
  for (const [radius, z] of [
    [0.34, -0.34],
    [0.52, -0.13],
    [0.48, 0.24],
    [0.3, 0.4],
  ])
    for (let i = 0; i < 5; i++) {
      const theta = (i * Math.PI * 2) / 5,
        rad = radius! * (0.88 + 0.22 * random(`${r}:${i}`)),
        x = Math.cos(theta) * rad,
        y = Math.sin(theta) * rad,
        yy = y * ca - z! * sa,
        zz = y * sa + z! * ca;
      objectVertices.push([x, y, z!]);
      vertices.push([x * cb + zz * sb, yy, -x * sb + zz * cb]);
    }
  const indices: number[][] = [
    [4, 3, 2, 1, 0],
    [15, 16, 17, 18, 19],
  ];
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 5; i++)
      indices.push([
        j * 5 + i,
        j * 5 + ((i + 1) % 5),
        (j + 1) * 5 + ((i + 1) % 5),
        (j + 1) * 5 + i,
      ]);
  const faces = indices
    .map((ids) => {
      const p = ids.map((i) => vertices[i]!),
        o = p[0]!,
        u = p[1]!.map((x, i) => x - o[i]!),
        v = p[2]!.map((x, i) => x - o[i]!);
      const normal = [
          u[1]! * v[2]! - u[2]! * v[1]!,
          u[2]! * v[0]! - u[0]! * v[2]!,
          u[0]! * v[1]! - u[1]! * v[0]!,
        ],
        len = Math.hypot(...normal);
      return {
        p,
        ids,
        depth: p.reduce((v, p) => v + p[2]!, 0) / p.length,
        visible: normal[2]! > 0,
        light: Math.max(0, (-normal[0]! * 0.3 - normal[1]! * 0.6 + normal[2]! * 0.74) / len),
      };
    })
    .filter((f) => f.visible)
    .sort((a, b) => a.depth - b.depth);
  if (shadow > 0) {
    c.save();
    c.fillStyle = `rgba(6,36,12,${shadow * 0.22})`;
    c.shadowColor = `rgba(6,28,12,${shadow * 0.35})`;
    c.shadowBlur = size * 0.2;
    c.beginPath();
    c.ellipse(size * 0.12, size * 0.18, size * 0.45, size * 0.35, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  for (const face of faces) {
    const brightness =
      ambient === undefined
        ? 0.5 + face.light * (0.55 + highlight * 0.45)
        : calibratedFragmentMaterialBrightness(face.light, ambient, highlight);
    polygon(
      c,
      face.p.map((p) => [p[0]! * size, p[1]! * size]),
      shade(color, brightness),
    );
    if (texture)
      paintNativeFragmentFace(
        c,
        face.p,
        face.ids.map((i) => objectVertices[i]!),
        size,
        texture,
        brightness,
      );
  }
}
/** Smooth irregular chips: a rounded silhouette and broad lighting instead of dark face bands. */
function drawRoundedRock(
  c: CanvasRenderingContext2D,
  size: number,
  color: string,
  age: number,
  r: number,
  r2: number,
  highlight: number,
  shadow: number,
  ambient?: number,
  texture?: CanvasImageSource,
) {
  if (texture && c.globalAlpha < 1) {
    drawNativeMaterialAtOpacity(c, size, (target) =>
      drawRoundedRock(target, size, color, age, r, r2, highlight, shadow, ambient, texture),
    );
    return;
  }
  const sides = 3 + Math.floor(r * 3);
  const points = Array.from({ length: sides }, (_, i) => {
    const theta = (i * Math.PI * 2) / sides,
      rad = size * (0.38 + 0.17 * random(`${r}:rock:${i}`));
    return [
      Math.cos(theta) * rad,
      Math.sin(theta) * rad * (0.75 + 0.25 * Math.abs(Math.cos(age * 3 + r2 * 6))),
    ];
  });
  const path = () => {
    c.beginPath();
    points.forEach((p, i) => {
      const prev = points[(i + points.length - 1) % points.length]!,
        next = points[(i + 1) % points.length]!,
        ax = p[0]! * 0.86 + prev[0]! * 0.14,
        ay = p[1]! * 0.86 + prev[1]! * 0.14,
        bx = p[0]! * 0.86 + next[0]! * 0.14,
        by = p[1]! * 0.86 + next[1]! * 0.14;
      if (i) c.lineTo(ax, ay);
      else c.moveTo(ax, ay);
      c.quadraticCurveTo(p[0]!, p[1]!, bx, by);
    });
    c.closePath();
  };
  c.save();
  if (shadow > 0) {
    c.shadowColor = `rgba(90,18,40,${shadow * 0.55})`;
    c.shadowBlur = size * 0.15;
    c.shadowOffsetX = size * 0.08;
    c.shadowOffsetY = size * 0.12;
  }
  const g = c.createLinearGradient(-size * 0.3, -size * 0.4, size * 0.25, size * 0.45);
  g.addColorStop(0, shade(color, 1.08 + highlight * 0.25));
  g.addColorStop(0.45, shade(color, 1 + highlight * 0.1));
  g.addColorStop(1, shade(color, ambient === undefined ? 0.7 : Math.max(0.55, ambient)));
  path();
  c.fillStyle = g;
  c.fill();
  c.restore();
  if (texture) {
    // Keep the authored curved silhouette and its broad key light. A neutral
    // multiplicative ramp applies the same original three lighting coefficients.
    const maximum = 1.08 + highlight * 0.25,
      light = c.createLinearGradient(-size * 0.3, -size * 0.4, size * 0.25, size * 0.45);
    light.addColorStop(0, '#ffffff');
    light.addColorStop(0.45, shade('#ffffff', (1 + highlight * 0.1) / maximum));
    light.addColorStop(
      1,
      shade('#ffffff', (ambient === undefined ? 0.7 : Math.max(0.55, ambient)) / maximum),
    );
    c.save();
    path();
    c.clip();
    c.filter = `${c.filter && c.filter !== 'none' ? c.filter + ' ' : ''}brightness(${maximum})`;
    c.drawImage(texture, -size * 0.6, -size * 0.6, size * 1.2, size * 1.2);
    c.filter = 'none';
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = light;
    c.fillRect(-size * 0.6, -size * 0.6, size * 1.2, size * 1.2);
    c.restore();
  }
}
/** Broad key light and neutral ambient: saturated faces retain hue even on the cube's dark side. */
export function calibratedFragmentMaterialBrightness(
  diffuse: number,
  ambient = 0.78,
  highlight = 0.6,
) {
  const floor = Math.max(0.55, Math.min(1, ambient)),
    light = Math.max(0, Math.min(1, diffuse)),
    key = Math.max(0, Math.min(1, highlight));
  // Ambient protects the material colour on unlit sides. The neutral key is
  // additive rather than squeezed into the remaining ambient-to-white range:
  // otherwise a high ambient turns three distinct cube faces into a flat band.
  return floor + (1 - floor) * light + (0.12 + 0.3 * key) * light ** 2 + 0.04 * key * light ** 16;
}
/** Orthographic rotating cube with reusable face texture on each visible side. */
function drawTexturedClearCube(
  c: CanvasRenderingContext2D,
  size: number,
  color: string,
  age: number,
  r: number,
  tile: (x: number, y: number, size: number, color: string) => void,
  highlight = 1,
  shadow = 0,
  ambient = 0.48,
  rotationSpread = 0,
  lightColor = '#fff1c0',
  shading: 'legacy' | 'material' = 'legacy',
) {
  // A newly released cube exposes its lit upper face. In screen coordinates,
  // positive X rotation exposes the lower face instead, making wood look grey.
  const tumble = Math.max(0, age - 0.55),
    ax = -0.32 - age * 0.9 - tumble * r * 3 + (r - 0.5) * 2.4 * rotationSpread,
    ay =
      0.15 + age * 0.25 + tumble * (r - 0.5) * 2 + Math.sin(r * 57.3) * 0.5 * 2.4 * rotationSpread,
    ca = Math.cos(ax),
    sa = Math.sin(ax),
    cb = Math.cos(ay),
    sb = Math.sin(ay);
  const vertices = [
    [-0.5, -0.5, -0.5],
    [0.5, -0.5, -0.5],
    [0.5, 0.5, -0.5],
    [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5],
    [0.5, -0.5, 0.5],
    [0.5, 0.5, 0.5],
    [-0.5, 0.5, 0.5],
  ].map(([x, y, z]) => {
    const yy = y! * ca - z! * sa,
      zz = y! * sa + z! * ca;
    return [(x! * cb + zz * sb) * size, yy * size, (-x! * sb + zz * cb) * size];
  });
  const faces = [
    [4, 5, 6, 7],
    [1, 0, 3, 2],
    [0, 4, 7, 3],
    [5, 1, 2, 6],
    [0, 1, 5, 4],
    [7, 6, 2, 3],
  ]
    .map((ids, index) => {
      const p = ids.map((i) => vertices[i]!);
      return { p, index, depth: p.reduce((v, p) => v + p[2]!, 0) / 4 };
    })
    .sort((a, b) => a.depth - b.depth);
  if (shadow > 0) {
    c.save();
    c.shadowColor =
      shading === 'material' ? `rgba(0,0,0,${shadow * 0.25})` : `rgba(32,13,4,${shadow * 0.45})`;
    c.shadowBlur = size * 0.4;
    c.shadowOffsetX = size * 0.25;
    c.shadowOffsetY = size * 0.4;
    c.fillStyle =
      shading === 'material' ? `rgba(0,0,0,${shadow * 0.08})` : `rgba(32,13,4,${shadow * 0.16})`;
    c.fillRect(-size * 0.5, -size * 0.5, size, size);
    c.restore();
  }
  for (const { p } of faces) {
    const o = p[0]!,
      u = p[1]!,
      v = p[3]!,
      cross = (u[0]! - o[0]!) * (v[1]! - o[1]!) - (u[1]! - o[1]!) * (v[0]! - o[0]!);
    if (cross <= 0) continue;
    c.save();
    c.transform(
      (u[0]! - o[0]!) / size,
      (u[1]! - o[1]!) / size,
      (v[0]! - o[0]!) / size,
      (v[1]! - o[1]!) / size,
      o[0]!,
      o[1]!,
    );
    const du = u.map((q, i) => q - o[i]!),
      dv = v.map((q, i) => q - o[i]!),
      normal = [du[1]! * dv[2]! - du[2]! * dv[1]!, du[2]! * dv[0]! - du[0]! * dv[2]!, cross],
      len = Math.hypot(...normal),
      light = Math.max(0, (-normal[0]! * 0.3 - normal[1]! * 0.9 + normal[2]! * 0.65) / len / 1.15),
      brightness =
        shading === 'material'
          ? calibratedFragmentMaterialBrightness(light, ambient, highlight)
          : ambient + (0.7 + 0.65 * highlight) * light;
    c.fillStyle = shade(color, brightness);
    c.fillRect(0, 0, size, size);
    tile(0, 0, size, color);
    c.save();
    c.globalAlpha *= Math.min(0.72, Math.abs(brightness - 1));
    c.fillStyle =
      brightness > 1
        ? shading === 'material'
          ? '#ffffff'
          : lightColor
        : shading === 'material'
          ? '#000000'
          : '#241107';
    c.fillRect(0, 0, size, size);
    c.restore();
    const bevel = size * 0.065;
    if (shading === 'material') {
      // These narrow, coloured chamfers remain readable on tiny pieces without
      // outlining every cube in black or painting a white highlight over its face.
      polygon(
        c,
        [
          [0, 0],
          [size, 0],
          [size - bevel, bevel],
          [bevel, bevel],
        ],
        shade(color, Math.min(1.5, brightness + 0.12 + 0.12 * highlight)),
      );
      polygon(
        c,
        [
          [0, 0],
          [bevel, bevel],
          [bevel, size - bevel],
          [0, size],
        ],
        shade(color, Math.min(1.3, brightness + 0.06 + 0.06 * highlight)),
      );
      polygon(
        c,
        [
          [size, 0],
          [size, size],
          [size - bevel, size - bevel],
          [size - bevel, bevel],
        ],
        shade(color, Math.max(ambient, brightness - 0.1)),
      );
      polygon(
        c,
        [
          [0, size],
          [size, size],
          [size - bevel, size - bevel],
          [bevel, size - bevel],
        ],
        shade(color, Math.max(ambient, brightness - 0.14)),
      );
    } else {
      polygon(
        c,
        [
          [0, 0],
          [size, 0],
          [size - bevel, bevel],
          [bevel, bevel],
        ],
        shade(color, Math.min(1.95, brightness + 0.1 + 0.2 * highlight)),
      );
      polygon(
        c,
        [
          [0, size],
          [size, size],
          [size - bevel, size - bevel],
          [bevel, size - bevel],
        ],
        shade(color, Math.max(0.3, brightness - 0.28)),
      );
    }
    c.restore();
  }
}
/** Short upward arc in output pixels, applied only after release. */
export function calibratedSheetLift(
  age: number,
  clear: NonNullable<DropReferenceCalibration['clear']>,
) {
  const u = Math.max(0, Math.min(1, age / (clear.sheetLiftSeconds ?? 0.35)));
  return (clear.sheetLiftPixels ?? 0) * 4 * u * (1 - u);
}
/** Release-front distance; right mirrors the existing left front in presentation only. */
export function calibratedClearFrontDistance(
  u: number,
  origin: NonNullable<DropReferenceCalibration['clear']>['frontOrigin'],
) {
  return origin === 'right'
    ? 1 - u
    : origin === 'center'
      ? Math.abs(u - 0.5) * 2
      : origin === 'edges'
        ? 1 - Math.abs(u - 0.5) * 2
        : u;
}
/** Freeze a released texture's lighting at the clear onset, compensating later field scrolling. */
export function calibratedClearLightingY(
  cell: { x: number; y: number },
  f: BlockCrushDropPresentationFrame,
  a: DropReferenceCalibration,
  released: boolean,
) {
  const p = blockCrushDropScreenPosition(f.before, cell.x, cell.y, calibratedVisualFieldRise(f, a)),
    scale = a.board.verticalScale ?? 1;
  const centre = a.board.y + (p.y + a.board.cell / 2 - a.board.y) * scale;
  if (!released || !f.lingeringClear) return centre;
  const current = calibratedFieldRiseTick(f),
    start = current - (f.lingeringClear.elapsedFrames * 30) / f.fps;
  return centre + calibratedFieldRiseCompensation(f, a, start) * a.board.cell * scale;
}
/** V2 held mothers attach to the board; explicit poses remain absolute screen space. */
export function calibratedHeldParentPosition(
  cell: { id: string; x: number; y: number },
  f: BlockCrushDropPresentationFrame,
  a: DropReferenceCalibration,
) {
  const shift = (f.lateMovementOffsets ?? [])
    .filter((o) => o.id === cell.id)
    .reduce((v, o) => ({ x: v.x + o.x, y: v.y + o.y }), { x: 0, y: 0 });
  const p = blockCrushDropScreenPosition(
    f.before,
    cell.x + shift.x,
    cell.y + shift.y,
    calibratedVisualFieldRise(f, a),
  );
  const cue = f.lingeringClear,
    e = a.clear;
  if (
    cue &&
    (e?.fragmentPhysics || e?.motionModel === 'layered-curve') &&
    (a.fieldRiseOffsetKeys === undefined || cue.elapsedFrames < 0)
  ) {
    // Pre-roll payloads contain a native logical correction which must still be
    // cancelled. After birth an opt-in held mother follows the current board,
    // unlike the physical model's deliberately frozen released origin.
    const current = calibratedFieldRiseTick(f),
      start = current - (cue.elapsedFrames * 30) / f.fps;
    p.y +=
      ((blockCrushFieldClock(f.before.config, current) -
        blockCrushFieldClock(f.before.config, start)) /
        f.before.config.rules.fieldMotion.ticksPerCell) *
      a.board.cell;
  }
  return p;
}
/** Measured centres replace presentation motion only; native cells and clear ownership stay intact. */
export function calibratedObservedFragmentPoses(
  f: BlockCrushDropPresentationFrame,
  a: DropReferenceCalibration,
) {
  const cue = f.lingeringClear,
    n = a.clear?.subdivisions;
  const result = new Map<string, { x: number; y: number; angle?: number }>();
  if (!cue || !n) return result;
  const motion =
    cue.observedFragmentMotion ??
    a.observedFragmentMotionCues?.find(
      (q) => q.actionIndex === cue.actionIndex && q.cycleIndex === cue.cycleIndex,
    )?.motion;
  if (!motion || isDropObservedFragmentMotionV2(motion) || !motion.frames.length) return result;
  const offset = (cue.elapsedFrames * motion.canonicalFps) / f.fps,
    frames = motion.frames;
  if (offset < frames[0]!.frameOffset || offset > frames.at(-1)!.frameOffset) return result;
  const next = frames.findIndex((q) => q.frameOffset >= offset),
    end = frames[next]!,
    start = frames[Math.max(0, next - 1)]!,
    u =
      end.frameOffset === start.frameOffset
        ? 0
        : (offset - start.frameOffset) / (end.frameOffset - start.frameOffset);
  const startTracks = new Map(start.tracks.map(([id, x, y]) => [id, { x, y }])),
    endTracks = new Map(end.tracks.map(([id, x, y]) => [id, { x, y }]));
  const points = new Map<number, { x: number; y: number }>();
  for (const [id, p] of u < 0.5 ? startTracks : endTracks) {
    const s = startTracks.get(id),
      e = endTracks.get(id);
    points.set(id, s && e ? { x: s.x + (e.x - s.x) * u, y: s.y + (e.y - s.y) * u } : p);
  }
  const rows = [...new Set(cue.eliminatedCells.map((q) => q.y))].sort((x, y) => x - y),
    rowIndex = new Map(rows.map((y, i) => [y, i]));
  const records = cue.eliminatedCells.flatMap((cell) =>
    Array.from({ length: n * n }, (_, j) => {
      const ix = j % n,
        iy = Math.floor(j / n),
        column = cell.x * n + ix,
        row = (rows.length - 1 - rowIndex.get(cell.y)!) * n + (n - 1 - iy);
      return {
        id: `${cell.id}:fragment-${ix}-${iy}`,
        column,
        row,
        lattice: row * motion.subColumns + column,
      };
    }),
  );
  const valid = new Set(records.map((q) => q.lattice)),
    displacements = [...points].flatMap(([id, p]) => {
      if (!valid.has(id)) return [];
      const column = id % motion.subColumns,
        row = Math.floor(id / motion.subColumns),
        pitch = motion.cellPitch / n;
      return [
        {
          column,
          row,
          dx: p.x - (motion.gridX + (column + 0.5) * pitch),
          dy: p.y - (motion.gridTop + (row + 0.5) * pitch),
        },
      ];
    });
  for (const record of records) {
    let p = points.get(record.lattice);
    if (
      !p &&
      displacements.length >= 4 &&
      displacements.length / Math.max(1, records.length) >=
        (motion.interpolationMinimumCoverage ??
          BLOCK_CRUSH_DROP_OBSERVED_INTERPOLATION_MIN_COVERAGE)
    ) {
      const nearest = displacements
        .map((q) => ({
          ...q,
          distance: (q.column - record.column) ** 2 + (q.row - record.row) ** 2,
        }))
        .sort((x, y) => x.distance - y.distance)
        .slice(0, 8);
      let weight = 0,
        dx = 0,
        dy = 0;
      for (const q of nearest) {
        const w = 1 / (0.35 + q.distance) ** 1.5;
        weight += w;
        dx += q.dx * w;
        dy += q.dy * w;
      }
      if (weight) {
        const pitch = motion.cellPitch / n;
        p = {
          x: motion.gridX + (record.column + 0.5) * pitch + dx / weight,
          y: motion.gridTop + (record.row + 0.5) * pitch + dy / weight,
        };
      }
    }
    if (p) result.set(record.id, { x: p.x, y: calibratedTrackLogicalY(p.y, a.board) });
  }
  // A local source-space tangent also follows the ribbon's observed 2D fold.
  for (const record of records) {
    const p = result.get(record.id);
    if (!p) continue;
    const neighbour =
        records.find((q) => q.row === record.row && q.column === record.column + 1) ??
        records.find((q) => q.row === record.row && q.column === record.column - 1),
      q = neighbour && result.get(neighbour.id);
    if (q) {
      const direction = neighbour!.column > record.column ? 1 : -1;
      p.angle = Math.atan2((q.y - p.y) * direction, (q.x - p.x) * direction);
    }
  }
  return result;
}
/** Internal pitch follows its existing scaled clock; random-axis onset uses real seconds. */
export function calibratedRoundedFragmentOrientation(
  e: NonNullable<DropReferenceCalibration['clear']>,
  age: number,
  r: number,
  released: boolean,
  releaseAgeSeconds = age,
) {
  const tumble = Math.max(0, age - 0.55),
    ramp = e.fragmentRotationSpreadRampSeconds ?? 0;
  const u = ramp > 0 ? Math.max(0, Math.min(1, releaseAgeSeconds / ramp)) : 1;
  const spread = (e.fragmentRotationSpread ?? 0) * (u * u * (3 - 2 * u));
  return {
    rotationX: released
      ? (e.fragmentCubePitchStart ?? -0.32) -
        age * (e.fragmentCubePitchRate ?? 0.9) -
        tumble * r * 3 +
        (r - 0.5) * 2.4 * spread
      : (e.fragmentCubePitchStart ?? -0.12),
    rotationY: released
      ? 0.15 + age * 0.25 + tumble * (r - 0.5) * 2 + Math.sin(r * 57.3) * 0.5 * 2.4 * spread
      : 0,
  };
}
export function drawCalibratedFragments(
  c: CanvasRenderingContext2D,
  f: BlockCrushDropPresentationFrame,
  a: DropReferenceCalibration,
  tile: CalibratedTilePainter,
  depthPackets?: ObservedFragmentDepthPacket[],
  nativePackets?: NativeCalibratedFragmentPacket[],
) {
  const cue = f.lingeringClear,
    e = a.clear;
  if (!cue || !e) return;
  if (e.followFieldRise === true) {
    if (
      e.nativeInertial ||
      cue.sequence ||
      cue.observedFragmentMotion ||
      cue.observedFragmentMotionV2 ||
      a.observedFragmentMotionCues?.length ||
      e.fragmentDisplayFps !== undefined ||
      e.fragmentPhysics?.sheetDetachAfterReleaseSeconds !== undefined ||
      (!e.fragmentPhysics && e.motionModel !== 'layered-curve')
    )
      throw new Error('DROP_CLEAR_FIELD_ADVECTION_REQUIRES_LEGACY_SCREEN_ANCHORED_MODEL');
    c.save();
    try {
      c.translate(0, calibratedClearFieldAdvection(f, a));
      drawCalibratedFragments(
        c,
        f,
        { ...a, clear: { ...e, followFieldRise: false } },
        tile,
        depthPackets,
        nativePackets,
      );
    } finally {
      c.restore();
    }
    return;
  }
  if (
    e.fragmentGeometry === 'rounded-polyhedron' &&
    (cue.sequence ||
      cue.observedFragmentMotion ||
      cue.observedFragmentMotionV2 ||
      a.observedFragmentMotionCues?.length)
  )
    throw new Error('ROUNDED_POLYHEDRON_OBSERVED_OR_SEQUENCE_CONFLICT');
  if (cue.sequence) return;
  if (
    e.fragmentGeometry === 'rounded-polyhedron' &&
    (e.fragmentSurface !== 'solid' ||
      e.fragmentShading === 'legacy' ||
      e.motionModel !== 'ballistic' ||
      e.nativeInertial === true ||
      e.fragmentPhysics?.sheetDetachSeconds !== undefined ||
      e.fragmentPhysics?.sheetDetachAfterReleaseSeconds !== undefined ||
      e.fragmentCubeFrontUvMapping !== undefined ||
      e.fragmentVolumeSeedPattern !== undefined ||
      e.fragmentDepthLayers !== undefined ||
      e.fragmentDepthRenderer !== undefined ||
      e.fragmentPerspectiveCamera !== undefined ||
      e.fragmentPartitionProfile !== undefined)
  )
    throw new Error('ROUNDED_POLYHEDRON_UNSUPPORTED_MATERIAL_OR_RENDERER');
  if (e.nativeInertial) {
    if (!nativePackets) throw new Error('DROP_NATIVE_INERTIAL_REQUIRES_SHARED_FRAME_BATCH');
    return;
  }
  const t = cue.elapsedFrames / f.fps,
    n = e.subdivisions,
    b = a.board;
  if (e.fragmentMaterialTexture === true) {
    if (
      !['faceted-chip', 'faceted-rock', 'rounded-rock'].includes(e.fragmentGeometry ?? '') ||
      cue.observedFragmentMotionV2 ||
      a.observedFragmentMotionCues?.some((q) => isDropObservedFragmentMotionV2(q.motion))
    )
      throw new Error('DROP_FRAGMENT_MATERIAL_TEXTURE_UNSUPPORTED_GEOMETRY_OR_OBSERVED_V2');
    if (!tile.paletteBound || !tile.frontTexture)
      throw new Error('DROP_FRAGMENT_MATERIAL_TEXTURE_REQUIRES_BOUND_TILE_PALETTE');
  }
  const materialTexture = (
    cell: (typeof cue.eliminatedCells)[number],
    ix: number,
    iy: number,
    color: string,
    released: boolean,
    count = n,
  ) => {
    if (e.fragmentMaterialTexture !== true) return undefined;
    // Rounded grains may be six times their nominal mother subdivision. Keep
    // material texel density in proportion to that surface, instead of blowing
    // up one tiny stitch/vein until the texture reads as an untextured gradient.
    const sampledCount =
      e.fragmentGeometry === 'rounded-rock'
        ? Math.max(1, count / Math.max(1, e.fragmentScale ?? 1))
        : count;
    const sampleIndex = (index: number) =>
      count > 1 ? (index * (sampledCount - 1)) / (count - 1) : 0;
    return tile.frontTexture!(
      sampleIndex(ix),
      sampleIndex(iy),
      sampledCount,
      color,
      a.tilePaletteLighting ? calibratedClearLightingY(cell, f, a, released) : undefined,
    );
  };
  const overlayMaterialTile = (
    x: number,
    y: number,
    size: number,
    color: string,
    cell: (typeof cue.eliminatedCells)[number],
    ix: number,
    iy: number,
    count: number,
    released: boolean,
  ) => {
    if (e.fragmentMaterialTexture !== true) return;
    const texture = materialTexture(cell, ix, iy, color, released, count)!;
    c.save();
    c.beginPath();
    c.rect(x, y, size, size);
    c.clip();
    c.drawImage(texture, x, y, size, size);
    c.restore();
  };

  if (e.fragmentDisplayPhaseSeconds !== undefined && e.fragmentDisplayFps === undefined)
    throw new Error('DROP_FRAGMENT_DISPLAY_PHASE_REQUIRES_CLOCK');
  const visualFieldRise = calibratedVisualFieldRise(f, a);
  if (
    e.fragmentCubeFrontUvMapping === 'mother-plane' &&
    (e.fragmentGeometry !== 'rounded-cube' || e.fragmentSurface === 'tile-repeat')
  )
    throw new Error('ROUNDED_FRAGMENT_MOTHER_UV_REQUIRES_ROUNDED_CUBE_AND_PARENT_UV');
  if (
    e.fragmentVolumeSeedPattern === 'center-three' &&
    (e.fragmentGeometry !== 'fractured-volume' ||
      n !== 2 ||
      (e.prefractureSubdivisions ?? 2) !== 2 ||
      e.fragmentDepthLayers !== 2)
  )
    throw new Error(
      'FRACTURED_VOLUME_SEED_PATTERN_UNSUPPORTED_PARTITION: center-three requires fractured-volume, subdivisions 2 and depthLayers 2',
    );
  if (
    e.fragmentGeometry === 'relief-cube' &&
    (n !== 2 ||
      (e.prefractureSubdivisions ?? 2) !== 2 ||
      (e.layeredCurve?.depthLayers ?? 1) !== 1 ||
      (e.fragmentDepthLayers ?? 1) !== 1 ||
      e.fragmentSurface === 'tile-repeat')
  )
    throw new Error(
      'RELIEF_FRAGMENT_UNSUPPORTED_PARTITION: requires subdivisions 2, depthLayers 1 and mother UV',
    );
  if (
    e.fragmentGeometry === 'pyramid-quarter' &&
    (n !== 2 ||
      (e.prefractureSubdivisions ?? 2) !== 2 ||
      (e.layeredCurve?.depthLayers ?? 1) !== 1 ||
      (e.fragmentDepthLayers ?? 1) !== 1 ||
      e.fragmentSurface === 'tile-repeat')
  )
    throw new Error(
      'PYRAMID_QUARTER_FRAGMENT_UNSUPPORTED_PARTITION: requires subdivisions 2, depthLayers 1 and mother UV',
    );
  const position = (id: string, x: number, y: number) => {
    const shift = (f.lateMovementOffsets ?? [])
      .filter((o) => o.id === id)
      .reduce((v, o) => ({ x: v.x + o.x, y: v.y + o.y }), { x: 0, y: 0 });
    const p = blockCrushDropScreenPosition(f.before, x + shift.x, y + shift.y, visualFieldRise);
    if (e.fragmentPhysics || e.motionModel === 'layered-curve') {
      const current = f.canonicalTick ?? (f.frameIndex * 30) / f.fps,
        start = current - (cue.elapsedFrames * 30) / f.fps;
      p.y += calibratedFieldRiseCompensation(f, a, start) * b.cell;
    }
    return p;
  };
  // A rounded fragment owns one patch of its mother tile, only on its front
  // plane. The side/top remain plain albedo, including when the front turns away.
  const roundedCube = (
    size: number,
    color: string,
    age: number,
    r: number,
    cell: (typeof cue.eliminatedCells)[number],
    ix: number,
    iy: number,
    count = n,
    released = true,
    textured = true,
    releaseAgeSeconds = age,
    inPlaneRotation = 0,
    observedPose?: DropObservedFragmentPose,
    volumeDepthIndex?: number,
  ) => {
    const { rotationX, rotationY } =
      observedPose ?? calibratedRoundedFragmentOrientation(e, age, r, released, releaseAgeSeconds);
    const surface =
      observedPose?.material === 'parent-uv'
        ? 'tile'
        : observedPose?.material === 'solid'
          ? 'solid'
          : e.fragmentSurface;
    // The contour rotates the mesh in Canvas space, but an explicit cast keeps
    // its calibrated stage direction. The helper's ±2 local-component guard
    // still applies; calibration vectors with norm <=2 cannot hit that guard.
    const cast = e.fragmentCastShadow,
      cos = Math.cos(inPlaneRotation),
      sin = Math.sin(inPlaneRotation);
    const castShadow =
      cast && inPlaneRotation !== 0
        ? {
            ...cast,
            offsetX: cast.offsetX * cos + cast.offsetY * sin,
            offsetY: -cast.offsetX * sin + cast.offsetY * cos,
          }
        : cast;
    if (e.fragmentGeometry === 'rounded-polyhedron') {
      if (surface !== 'solid') throw new Error('ROUNDED_POLYHEDRON_REQUIRES_SOLID');
      const light = e.fragmentLightDirection ?? { x: -0.2, y: -1, z: 0.35 };
      // Canvas owns this fragment's original in-plane turn. Transform the stage
      // light into that basis, so all three real axes rotate under a fixed key.
      drawRoundedPolyhedronFragment(c, {
        size,
        color,
        seed: Math.floor(r * 4294967296) >>> 0,
        rotationX,
        rotationY,
        ...(observedPose ? { rotationZ: observedPose.rotationZ } : {}),
        cornerRadius: observedPose?.cornerRadius ?? e.fragmentCubeCornerRadius ?? 0.065,
        lightDirection: {
          x: light.x * cos + light.y * sin,
          y: -light.x * sin + light.y * cos,
          z: light.z,
        },
        diffuse: e.fragmentDiffuse ?? 0.65,
        ambient: e.fragmentAmbient ?? 0.78,
        highlight: e.highlight ?? 1,
        shadow: e.shadow ?? 0,
        ...(e.fragmentFaceColors ? { faceColors: e.fragmentFaceColors } : {}),
        ...(e.fragmentSpecularStrength === undefined
          ? {}
          : { specularStrength: e.fragmentSpecularStrength }),
        ...(e.fragmentSpecularPower === undefined
          ? {}
          : { specularPower: e.fragmentSpecularPower }),
        ...(castShadow === undefined ? {} : { castShadow }),
        ...(e.fragmentAmbientFloor === undefined ? {} : { ambientFloor: e.fragmentAmbientFloor }),
        ...(e.fragmentLightColor ? { lightColor: e.fragmentLightColor } : {}),
      });
      return;
    }
    if (e.fragmentGeometry === 'partitioned-solid') {
      if (
        !observedPose ||
        !e.fragmentPartitionProfile ||
        count !== 2 ||
        observedPose.depthIndex !== 0
      )
        throw new Error(
          'PARTITIONED_SOLID_REQUIRES_OBSERVED_V2: n2, one depth and explicit profile',
        );
      // V2 x/y is the actual region-area-centroid pivot. No grid-center correction,
      // field rise, local bbox normalization or extra procedural motion is applied.
      drawPartitionedSolid(c, {
        profile: e.fragmentPartitionProfile,
        size,
        color,
        ix,
        iy,
        subdivisions: 2,
        depthLayers: 1,
        depthIndex: 0,
        rotationX,
        rotationY,
        rotationZ: observedPose.rotationZ,
        cornerRadius: observedPose.cornerRadius ?? e.fragmentCubeCornerRadius ?? 0.065,
        ...(e.fragmentFaceColors ? { faceColors: e.fragmentFaceColors } : {}),
        lightDirection: e.fragmentLightDirection ?? { x: -0.2, y: -1, z: 0.35 },
        diffuse: e.fragmentDiffuse ?? 0.65,
        ambient: e.fragmentAmbient ?? 0.78,
        highlight: e.highlight ?? 1,
        shadow: e.shadow ?? 0,
        ...(e.fragmentSpecularStrength === undefined
          ? {}
          : { specularStrength: e.fragmentSpecularStrength }),
        ...(e.fragmentSpecularPower === undefined
          ? {}
          : { specularPower: e.fragmentSpecularPower }),
        ...(castShadow === undefined ? {} : { castShadow }),
        ...(e.fragmentAmbientFloor === undefined ? {} : { ambientFloor: e.fragmentAmbientFloor }),
        ...(e.fragmentLightColor ? { lightColor: e.fragmentLightColor } : {}),
        ...(surface === 'solid' || !textured
          ? {}
          : {
              facePainter: (_ctx, { size: s, color: col }) =>
                tile(
                  0,
                  0,
                  s,
                  col,
                  'face',
                  0,
                  a.tilePaletteLighting
                    ? calibratedClearLightingY(cell, f, a, released)
                    : undefined,
                ),
            }),
      });
      return;
    }
    if (e.fragmentGeometry === 'relief-cube') {
      // One fixed carved mother heightfield is cut into four closed solids. Its
      // cut-wall notch is geometry; UVs are mapped from the original mother once.
      drawReliefFragmentCube(c, {
        size,
        color,
        ix,
        iy,
        subdivisions: count,
        depthLayers: 1,
        depthIndex: observedPose?.depthIndex ?? 0,
        rotationX,
        rotationY,
        ...(observedPose ? { rotationZ: observedPose.rotationZ } : {}),
        ...(e.fragmentFaceColors ? { faceColors: e.fragmentFaceColors } : {}),
        lightDirection: e.fragmentLightDirection ?? { x: -0.2, y: -1, z: 0.35 },
        diffuse: e.fragmentDiffuse ?? 0.65,
        ambient: e.fragmentAmbient ?? 0.78,
        highlight: e.highlight ?? 1,
        shadow: e.shadow ?? 0,
        ...(e.fragmentSpecularStrength === undefined
          ? {}
          : { specularStrength: e.fragmentSpecularStrength }),
        ...(e.fragmentSpecularPower === undefined
          ? {}
          : { specularPower: e.fragmentSpecularPower }),
        ...(castShadow === undefined ? {} : { castShadow }),
        ...(e.fragmentAmbientFloor === undefined ? {} : { ambientFloor: e.fragmentAmbientFloor }),
        ...(e.fragmentLightColor ? { lightColor: e.fragmentLightColor } : {}),
        ...(surface === 'solid' || !textured
          ? {}
          : {
              facePainter: (_ctx, { size: s, color: col }) =>
                tile(
                  0,
                  0,
                  s,
                  col,
                  'face',
                  0,
                  a.tilePaletteLighting
                    ? calibratedClearLightingY(cell, f, a, released)
                    : undefined,
                ),
            }),
      });
      return;
    }
    if (e.fragmentGeometry === 'pyramid-quarter') {
      // One raised mother square-pyramid is cut into four closed wedges. Its
      // slopes are geometry; front UV is a region of the original mother once.
      drawPyramidQuarterFragment(c, {
        size,
        color,
        ix,
        iy,
        subdivisions: count,
        depthLayers: 1,
        depthIndex: observedPose?.depthIndex ?? 0,
        rotationX,
        rotationY,
        ...(observedPose ? { rotationZ: observedPose.rotationZ } : {}),
        ...(e.fragmentPerspectiveCamera && observedPose
          ? {
              perspectiveCamera: e.fragmentPerspectiveCamera,
              worldOrigin: { x: observedPose.x, y: observedPose.y, z: observedPose.z },
            }
          : {}),
        ...(e.fragmentFaceColors ? { faceColors: e.fragmentFaceColors } : {}),
        lightDirection: e.fragmentLightDirection ?? { x: -0.2, y: -1, z: 0.35 },
        diffuse: e.fragmentDiffuse ?? 0.65,
        ambient: e.fragmentAmbient ?? 0.78,
        highlight: e.highlight ?? 1,
        shadow: e.shadow ?? 0,
        ...(e.fragmentSpecularStrength === undefined
          ? {}
          : { specularStrength: e.fragmentSpecularStrength }),
        ...(e.fragmentSpecularPower === undefined
          ? {}
          : { specularPower: e.fragmentSpecularPower }),
        ...(castShadow === undefined ? {} : { castShadow }),
        ...(e.fragmentAmbientFloor === undefined ? {} : { ambientFloor: e.fragmentAmbientFloor }),
        ...(e.fragmentLightColor ? { lightColor: e.fragmentLightColor } : {}),
        ...(surface === 'solid' || !textured
          ? {}
          : {
              facePainter: (_ctx, { size: s, color: col }) =>
                tile(
                  0,
                  0,
                  s,
                  col,
                  'face',
                  0,
                  a.tilePaletteLighting
                    ? calibratedClearLightingY(cell, f, a, released)
                    : undefined,
                ),
            }),
      });
      return;
    }
    if (e.fragmentGeometry === 'fractured-volume') {
      const depthLayers = e.fragmentDepthLayers ?? 1,
        depth = observedPose?.depthIndex ?? volumeDepthIndex;
      // Explicit V2/layered poses own their selected half. Legacy one-pose motion
      // draws the complementary rear then front solids without duplicating volume.
      const depthIndices = depthLayers === 2 ? (depth === undefined ? [1, 0] : [depth]) : [0];
      for (const depthIndex of depthIndices)
        drawFracturedVolume(c, {
          size,
          color,
          ix,
          iy,
          subdivisions: count,
          depthLayers,
          depthIndex,
          ...(e.fragmentVolumeSeedPattern === undefined
            ? {}
            : { seedPattern: e.fragmentVolumeSeedPattern }),
          seed: random(cell.id + ':fracture'),
          rotationX,
          rotationY,
          ...(observedPose ? { rotationZ: observedPose.rotationZ } : {}),
          cornerRadius: e.fragmentCubeCornerRadius ?? 0.065,
          lightDirection: e.fragmentLightDirection ?? { x: -0.2, y: -1, z: 0.35 },
          diffuse: e.fragmentDiffuse ?? 0.65,
          ambient: e.fragmentAmbient ?? 0.78,
          highlight: e.highlight ?? 1,
          shadow: e.shadow ?? 0,
          ...(e.fragmentSpecularStrength === undefined
            ? {}
            : { specularStrength: e.fragmentSpecularStrength }),
          ...(e.fragmentSpecularPower === undefined
            ? {}
            : { specularPower: e.fragmentSpecularPower }),
          ...(castShadow === undefined ? {} : { castShadow }),
          ...(e.fragmentAmbientFloor === undefined ? {} : { ambientFloor: e.fragmentAmbientFloor }),
          ...(e.fragmentLightColor ? { lightColor: e.fragmentLightColor } : {}),
          // Interior oblique cut planes are native albedo. The actual exterior skins
          // retain clipped regions of one shared mother UV, never repeated stickers.
          ...(surface === 'solid' || !textured
            ? {}
            : {
                facePainter: (_ctx, { size: s, color: col }) =>
                  tile(
                    0,
                    0,
                    s,
                    col,
                    'face',
                    0,
                    a.tilePaletteLighting
                      ? calibratedClearLightingY(cell, f, a, released)
                      : undefined,
                  ),
              }),
        });
      return;
    }
    if (e.fragmentGeometry === 'fractured-block') {
      drawFracturedBlock(c, {
        size,
        color,
        ix,
        iy,
        subdivisions: count,
        seed: random(cell.id + ':fracture'),
        rotationX,
        rotationY,
        ...(observedPose ? { rotationZ: observedPose.rotationZ } : {}),
        cornerRadius: e.fragmentCubeCornerRadius ?? 0.065,
        lightDirection: e.fragmentLightDirection ?? { x: -0.2, y: -1, z: 0.35 },
        diffuse: e.fragmentDiffuse ?? 0.65,
        ambient: e.fragmentAmbient ?? 0.78,
        highlight: e.highlight ?? 1,
        shadow: e.shadow ?? 0,
        ...(e.fragmentSpecularStrength === undefined
          ? {}
          : { specularStrength: e.fragmentSpecularStrength }),
        ...(e.fragmentSpecularPower === undefined
          ? {}
          : { specularPower: e.fragmentSpecularPower }),
        ...(castShadow === undefined ? {} : { castShadow }),
        ...(e.fragmentAmbientFloor === undefined ? {} : { ambientFloor: e.fragmentAmbientFloor }),
        ...(e.fragmentLightColor ? { lightColor: e.fragmentLightColor } : {}),
        // Irregular neighbors share their original mother's UVs. Repeating a whole
        // beveled mother on each irregular piece would invent seams and stickers.
        ...(surface === 'solid' || !textured
          ? {}
          : {
              facePainter: (_ctx, { size: s, color: col }) =>
                tile(
                  0,
                  0,
                  s,
                  col,
                  'face',
                  0,
                  a.tilePaletteLighting
                    ? calibratedClearLightingY(cell, f, a, released)
                    : undefined,
                ),
            }),
      });
      return;
    }
    const motherPlane = e.fragmentCubeFrontUvMapping === 'mother-plane';
    const frontTexture =
      motherPlane && surface !== 'solid' && textured
        ? tile.frontTexture?.(
            surface === 'tile-repeat' ? 0 : ix,
            surface === 'tile-repeat' ? 0 : iy,
            surface === 'tile-repeat' ? 1 : count,
            e.fragmentFaceColors?.front ?? color,
            a.tilePaletteLighting ? calibratedClearLightingY(cell, f, a, released) : undefined,
          )
        : undefined;
    if (motherPlane && surface !== 'solid' && textured && !frontTexture)
      throw new Error('ROUNDED_FRAGMENT_CONTEXT_AWARE_TEXTURE_PAINTER_REQUIRED');
    drawRoundedFragmentCube(c, {
      ...(e.fragmentCubeFrontUvMapping === undefined
        ? {}
        : { frontUvMapping: e.fragmentCubeFrontUvMapping }),
      ...(frontTexture ? { frontTexture } : {}),
      ...(e.fragmentFaceColors ? { faceColors: e.fragmentFaceColors } : {}),
      size,
      color,
      rotationX,
      rotationY,
      ...(observedPose ? { rotationZ: observedPose.rotationZ } : {}),
      cornerRadius:
        (e.fragmentGeometry === 'rounded-cube' ? observedPose?.cornerRadius : undefined) ??
        e.fragmentCubeCornerRadius ??
        0.065,
      lightDirection: e.fragmentLightDirection ?? { x: -0.2, y: -1, z: 0.35 },
      diffuse: e.fragmentDiffuse ?? 0.65,
      ambient: e.fragmentAmbient ?? 0.78,
      highlight: e.highlight ?? 1,
      shadow: e.shadow ?? 0,
      ...(e.fragmentSpecularStrength === undefined
        ? {}
        : { specularStrength: e.fragmentSpecularStrength }),
      ...(e.fragmentSpecularPower === undefined ? {} : { specularPower: e.fragmentSpecularPower }),
      ...(castShadow === undefined ? {} : { castShadow }),
      ...(e.fragmentAmbientFloor === undefined ? {} : { ambientFloor: e.fragmentAmbientFloor }),
      ...(e.fragmentLightColor ? { lightColor: e.fragmentLightColor } : {}),
      textureFaces: ['front'],
      ...(surface === 'solid' || !textured || motherPlane
        ? {}
        : {
            facePainter: (_ctx, { size: s, color: col }) => {
              // The helper has already clipped and affine-projected [0,s]². Keeping
              // mother-sized UVs prevents a complete star from repeating on every shard.
              const repeat = surface === 'tile-repeat';
              tile(
                repeat ? 0 : -ix * s,
                repeat ? 0 : -iy * s,
                repeat ? s : s * count,
                col,
                'face',
                0,
                a.tilePaletteLighting ? calibratedClearLightingY(cell, f, a, released) : undefined,
              );
            },
          }),
    });
  };
  // Explicit measurements own the whole wave, including empty intervals. Never
  // invent missing particles or fall back to a separate procedural simulation.
  const measuredMotion =
    cue.observedFragmentMotionV2 ??
    a.observedFragmentMotionCues?.find(
      (q) => q.actionIndex === cue.actionIndex && q.cycleIndex === cue.cycleIndex,
    )?.motion;
  if (e.fragmentGeometry === 'rounded-polyhedron' && measuredMotion)
    throw new Error('ROUNDED_POLYHEDRON_OBSERVED_MOTION_CONFLICT');
  if (
    e.fragmentDisplayFps !== undefined &&
    e.motionModel === 'ballistic' &&
    (measuredMotion || cue.observedFragmentMotion)
  )
    throw new Error('DROP_FRAGMENT_DISPLAY_OBSERVED_MOTION_CONFLICT');
  if (e.fragmentDepthRenderer) {
    if (
      e.fragmentDepthRenderer !== 'webgl-opaque' ||
      !['pyramid-quarter', 'rounded-cube'].includes(e.fragmentGeometry ?? '') ||
      !e.fragmentPerspectiveCamera ||
      (e.fragmentGeometry === 'rounded-cube' && e.fragmentCubeFrontUvMapping !== 'mother-plane') ||
      !isDropObservedFragmentMotionV2(measuredMotion) ||
      measuredMotion.subdivisions !== 2 ||
      measuredMotion.particles.some((p) => p.depthIndex !== 0) ||
      !depthPackets
    )
      throw new Error('OBSERVED_FRAGMENT_DEPTH_REQUIRES_MATCHING_V2_BATCH');
    if (measuredMotion.particles.some((p) => p.keys.some((k) => (k[8] ?? 1) !== 1)))
      throw new Error('OBSERVED_FRAGMENT_DEPTH_REQUIRES_OPAQUE');
  }
  if (
    e.fragmentPerspectiveCamera &&
    ((e.fragmentGeometry !== 'pyramid-quarter' &&
      !(
        e.fragmentGeometry === 'rounded-cube' &&
        e.fragmentDepthRenderer === 'webgl-opaque' &&
        e.fragmentCubeFrontUvMapping === 'mother-plane'
      )) ||
      !isDropObservedFragmentMotionV2(measuredMotion))
  )
    throw new Error(
      'PYRAMID_QUARTER_PERSPECTIVE_REQUIRES_OBSERVED_V2: matching pyramid-quarter or opaque mother-plane rounded wave required',
    );
  if (
    e.fragmentGeometry === 'partitioned-solid' &&
    (!isDropObservedFragmentMotionV2(measuredMotion) ||
      !e.fragmentPartitionProfile ||
      n !== 2 ||
      (e.prefractureSubdivisions ?? 2) !== 2 ||
      (e.fragmentDepthLayers ?? 1) !== 1 ||
      e.fragmentSurface === 'tile-repeat' ||
      (e.motionModel !== undefined && e.motionModel !== 'ballistic'))
  )
    throw new Error(
      'PARTITIONED_SOLID_REQUIRES_OBSERVED_V2: matching n2 one-depth wave and profile required',
    );
  if (isDropObservedFragmentMotionV2(measuredMotion)) {
    if (
      e.fragmentGeometry === 'partitioned-solid' &&
      (measuredMotion.subdivisions !== 2 ||
        measuredMotion.particles.some((p) => p.depthIndex !== 0))
    )
      throw new Error('PARTITIONED_SOLID_UNSUPPORTED_PARTITION: measured n2 and depthIndex 0 only');
    if (
      e.fragmentVolumeSeedPattern === 'center-three' &&
      (measuredMotion.subdivisions !== 2 || measuredMotion.particles.some((p) => p.depthIndex > 1))
    )
      throw new Error(
        'FRACTURED_VOLUME_SEED_PATTERN_UNSUPPORTED_PARTITION: measured center-three requires subdivisions 2 and depthIndex 0 or 1',
      );
    if (
      e.fragmentGeometry === 'relief-cube' &&
      (measuredMotion.subdivisions !== 2 ||
        measuredMotion.particles.some((p) => p.depthIndex !== 0))
    )
      throw new Error(
        'RELIEF_FRAGMENT_UNSUPPORTED_PARTITION: measured relief requires subdivisions 2 and depthIndex 0',
      );
    if (
      e.fragmentGeometry === 'pyramid-quarter' &&
      (measuredMotion.subdivisions !== 2 ||
        measuredMotion.particles.some((p) => p.depthIndex !== 0))
    )
      throw new Error(
        'PYRAMID_QUARTER_FRAGMENT_UNSUPPORTED_PARTITION: measured pyramid-quarter requires subdivisions 2 and depthIndex 0',
      );
    const byId = new Map(cue.eliminatedCells.map((cell) => [cell.id, cell])),
      scale = b.verticalScale ?? 1;
    const poses = sampleDropObservedFragmentMotionV2(
        measuredMotion,
        t,
        e.fragmentCubeCornerRadius ?? 0.065,
      ),
      colorFrame = e.freezeColorAtRelease
        ? { ...f, frameIndex: f.frameIndex - cue.elapsedFrames }
        : f;
    const held = dropObservedFragmentHeldParentIds(measuredMotion, t),
      layers: Array<'all' | 'depth' | 'face'> =
        a.paletteDepth || a.airbornePaletteDepth ? ['depth', 'face'] : ['all'];
    for (const layer of layers)
      for (const id of held) {
        const cell = byId.get(id);
        if (!cell) throw new Error('DROP_OBSERVED_FRAGMENT_NATIVE_BINDING_INVALID');
        const p =
            a.fieldRiseOffsetKeys === undefined
              ? position(cell.id, cell.x, cell.y)
              : calibratedHeldParentPosition(cell, f, a),
          color = calibratedCellColor(cell.id, cell.kind, colorFrame, a);
        c.save();
        try {
          tile(
            p.x,
            p.y,
            b.cell,
            color,
            layer,
            a.paletteDepth,
            b.y + (p.y + b.cell / 2 - b.y) * scale,
          );
        } finally {
          c.restore();
        }
      }
    // The enclosing stage stretches the board. These absolute stage-space cubes
    // cancel that transform so neither their size nor their 3D pose is flattened.
    c.save();
    c.translate(0, b.y);
    c.scale(1, 1 / scale);
    c.translate(0, -b.y);
    try {
      for (const pose of poses) {
        const cell = byId.get(pose.cellId);
        if (!cell) throw new Error('DROP_OBSERVED_FRAGMENT_NATIVE_BINDING_INVALID');
        const id = `${cell.id}:fragment-${pose.ix}-${pose.iy}`,
          color = pose.color ?? calibratedClearColor(cell.id, cell.kind, colorFrame, a, id);
        if (e.fragmentDepthRenderer) {
          const rounded = e.fragmentGeometry === 'rounded-cube';
          const frontTexture =
            pose.material === 'parent-uv'
              ? tile.frontTexture?.(
                  rounded ? pose.ix : 0,
                  rounded ? pose.iy : 0,
                  rounded ? measuredMotion.subdivisions : 1,
                  rounded ? (e.fragmentFaceColors?.front ?? color) : color,
                  a.tilePaletteLighting ? calibratedClearLightingY(cell, f, a, true) : undefined,
                )
              : undefined;
          if (pose.material === 'parent-uv' && !frontTexture)
            throw new Error('OBSERVED_FRAGMENT_DEPTH_CONTEXT_AWARE_TEXTURE_REQUIRED');
          depthPackets!.push({
            waveId: `${cue.actionIndex}:${cue.cycleIndex}`,
            pose,
            color,
            ...(frontTexture ? { frontTexture } : {}),
          });
          continue;
        }
        c.save();
        try {
          c.globalAlpha *= pose.opacity;
          c.translate(pose.x, pose.y);
          roundedCube(
            pose.sizePixels * pose.scale,
            color,
            0,
            random(id),
            cell,
            pose.ix,
            pose.iy,
            measuredMotion.subdivisions,
            true,
            pose.material === 'parent-uv',
            t,
            0,
            pose,
          );
        } finally {
          c.restore();
        }
      }
    } finally {
      c.restore();
    }
    return;
  }
  // This is the same quantized subcolumn release front used by the sheet solve,
  // converted back to seconds only for the optional material-rotation ramp.
  const sheetReleaseAgeSeconds = (
    cell: (typeof cue.eliminatedCells)[number],
    ix: number,
    seconds: number,
  ) => {
    const columns = f.before.config.columns,
      rate = e.sheetMotionRate ?? 1,
      mirrored = e.frontOrigin === 'right';
    const subColumn = (mirrored ? columns - 1 - cell.x : cell.x) * n + (mirrored ? n - 1 - ix : ix),
      u = subColumn / Math.max(1, columns * n - 1);
    const distance =
      e.frontOrigin === 'center'
        ? Math.abs(u - 0.5) * 2
        : e.frontOrigin === 'edges'
          ? 1 - Math.abs(u - 0.5) * 2
          : u;
    return Math.max(
      0,
      seconds - Math.round(Math.round(e.frontSeconds * 30 * rate) * distance) / (30 * rate),
    );
  };
  const drawPinnedGrid = (cell: (typeof cue.eliminatedCells)[number]) => {
    const count = e.prefractureSubdivisions ?? n,
      p = position(cell.id, cell.x, cell.y),
      size = (b.cell / count) * (e.prefractureScale ?? 1);
    for (let iy = 0; iy < count; iy++)
      for (let ix = 0; ix < count; ix++) {
        const key = `${cell.id}:fragment-${ix}-${iy}`,
          color = calibratedClearColor(cell.id, cell.kind, f, a, key),
          x = p.x + ((ix + 0.5) * b.cell) / count - size / 2,
          y = p.y + ((iy + 0.5) * b.cell) / count - size / 2;
        c.save();
        if (
          e.fragmentGeometry === 'rounded-cube' ||
          e.fragmentGeometry === 'rounded-polyhedron' ||
          e.fragmentGeometry === 'fractured-block' ||
          e.fragmentGeometry === 'fractured-volume' ||
          e.fragmentGeometry === 'relief-cube' ||
          e.fragmentGeometry === 'pyramid-quarter'
        ) {
          c.translate(x + size / 2, y + size / 2);
          roundedCube(size, color, 0, random(key), cell, ix, iy, count, false);
        } else {
          drawCalibratedDropTile(c, x, y, size, color, { ...a, shadow: 0, seam: 0 });
          overlayMaterialTile(x, y, size, color, cell, ix, iy, count, false);
        }
        c.restore();
      }
  };

  // A small shared contour profile drives a real n×n front lattice from native clear
  // identities. No frame-sized source images or per-video fragment tracks are
  // needed, and the original motion branches below remain opt-in independent.
  if (e.motionModel === 'layered-curve' && e.layeredCurve) {
    const scale = b.verticalScale ?? 1,
      byId = new Map(cue.eliminatedCells.map((cell) => [cell.id, cell]));
    const originOffsetY =
      e.layeredCurve.waveOriginOffsets?.find(
        (offset) => offset.actionIndex === cue.actionIndex && offset.cycleIndex === cue.cycleIndex,
      )?.offsetY ?? 0;
    const cells = cue.eliminatedCells.map((cell) => {
      const p = position(cell.id, cell.x, cell.y);
      return { id: cell.id, x: p.x, y: b.y + (p.y - b.y) * scale + originOffsetY };
    });
    const poses = calibratedLayeredCurvePoses({
      curve: e.layeredCurve,
      elapsedSeconds: t,
      cells,
      boardX: b.x,
      columns: f.before.config.columns,
      cellWidth: b.cell,
      cellHeight: b.cell * scale,
      subdivisions: n,
      fragmentScale: e.fragmentScale ?? 1,
      prefractureScale: e.prefractureScale ?? 1,
      rotationAgeScale: e.fragmentCubeRotationAgeScale ?? 1,
      frontOrigin: e.frontOrigin ?? 'left',
    });
    const colorFrame = e.freezeColorAtRelease
      ? { ...f, frameIndex: f.frameIndex - cue.elapsedFrames }
      : f;
    const activeCells = new Set(poses.filter((pose) => pose.age > 0).map((pose) => pose.cellId));
    // Some references visibly prefracture the whole band. Others keep each
    // mother tile intact until the release front reaches its first subcolumn.
    if (!e.prefracture) {
      const waitingCells = cue.eliminatedCells.filter((cell) => !activeCells.has(cell.id));
      // Match settled surfaces: no later neighbor's extrusion/shadow may cover an
      // already painted face and create a dark slot across the waiting band.
      const layers: Array<'all' | 'depth' | 'face'> =
        a.paletteDepth || a.airbornePaletteDepth ? ['depth', 'face'] : ['all'];
      for (const layer of layers)
        for (const cell of waitingCells) {
          const p = cells.find((p) => p.id === cell.id)!,
            color = calibratedCellColor(cell.id, cell.kind, colorFrame, a);
          c.save();
          c.globalAlpha = 1;
          tile(
            p.x,
            calibratedTrackLogicalY(p.y, b),
            b.cell,
            color,
            layer,
            a.paletteDepth,
            p.y + (b.cell * scale) / 2,
          );
          c.restore();
        }
    }
    for (const pose of poses) {
      if (!pose.visible || (!e.prefracture && !activeCells.has(pose.cellId))) continue;
      const cell = byId.get(pose.cellId)!,
        frontId = `${pose.cellId}:fragment-${pose.ix}-${pose.iy}`,
        textured = pose.depthIndex !== 1;
      // Rear volume uses the same material hue, but never repeats its mother's
      // artwork. The pure model has already ordered all rear slices before front.
      const color = calibratedClearColor(cell.id, cell.kind, colorFrame, a, frontId),
        geometry = e.fragmentGeometry ?? 'rounded-cube';
      const size = pose.size;
      c.save();
      c.globalAlpha = 1;
      c.translate(pose.x, calibratedTrackLogicalY(pose.y, b));
      c.rotate(pose.rotationZ);
      if (
        geometry === 'rounded-cube' ||
        geometry === 'rounded-polyhedron' ||
        geometry === 'fractured-block' ||
        geometry === 'fractured-volume' ||
        geometry === 'relief-cube' ||
        geometry === 'pyramid-quarter'
      )
        roundedCube(
          size,
          color,
          pose.rotationAge,
          pose.rotationSeed ?? pose.seedX,
          cell,
          pose.ix,
          pose.iy,
          n,
          pose.age > 0,
          textured,
          pose.age,
          pose.rotationZ,
          undefined,
          e.layeredCurve?.depthLayers === 2 ? pose.depthIndex : undefined,
        );
      else if (geometry === 'faceted-chip')
        drawFacetedChip(
          c,
          size,
          color,
          pose.rotationAge,
          pose.seedX,
          pose.seedY,
          e.highlight ?? 1,
          e.shadow ?? 0,
          e.fragmentShading === 'material' ? (e.fragmentAmbient ?? 0.78) : undefined,
          materialTexture(cell, pose.ix, pose.iy, color, pose.released),
        );
      else if (geometry === 'faceted-rock')
        drawFacetedRock(
          c,
          size,
          color,
          pose.rotationAge,
          pose.seedX,
          pose.seedY,
          e.highlight ?? 1,
          e.shadow ?? 0,
          e.fragmentShading === 'material' ? (e.fragmentAmbient ?? 0.78) : undefined,
          materialTexture(cell, pose.ix, pose.iy, color, pose.released),
        );
      else if (geometry === 'rounded-rock')
        drawRoundedRock(
          c,
          size,
          color,
          pose.rotationAge,
          pose.seedX,
          pose.seedY,
          e.highlight ?? 1,
          e.shadow ?? 0,
          e.fragmentShading === 'material' ? (e.fragmentAmbient ?? 0.78) : undefined,
          materialTexture(cell, pose.ix, pose.iy, color, pose.released),
        );
      else if (geometry === 'textured-chip') {
        if (textured)
          tile(
            -size / 2,
            -size / 2,
            size,
            color,
            'face',
            0,
            calibratedClearLightingY(cell, f, a, pose.released),
          );
        else {
          c.fillStyle = color;
          c.fillRect(-size / 2, -size / 2, size, size);
        }
      } else if (geometry === 'textured-cube')
        drawTexturedClearCube(
          c,
          size,
          color,
          pose.rotationAge,
          pose.seedX,
          (x, y, size, col) => {
            c.save();
            c.beginPath();
            c.rect(x, y, size, size);
            c.clip();
            if (e.fragmentSurface === 'solid' || !textured) {
              c.fillStyle = col;
              c.fillRect(x, y, size, size);
            } else
              tile(
                e.fragmentSurface === 'tile-repeat' ? x : x - pose.ix * size,
                e.fragmentSurface === 'tile-repeat' ? y : y - pose.iy * size,
                e.fragmentSurface === 'tile-repeat' ? size : size * n,
                col,
                'face',
                0,
                calibratedClearLightingY(cell, f, a, pose.released),
              );
            c.restore();
          },
          e.highlight ?? 1,
          e.shadow ?? 0,
          e.fragmentAmbient ?? 0.78,
          e.fragmentRotationSpread ?? 0,
          e.fragmentLightColor,
          e.fragmentShading,
        );
      else
        drawCalibratedDropTile(c, -size / 2, -size / 2, size, color, { ...a, seam: 0, shadow: 0 });
      c.restore();
    }
    return;
  }

  // This optional model consumes only cells in a genuine native clear wave. It
  // changes their presentation after release; it never deletes additional cells.
  const physics = e.fragmentPhysics,
    detachSeconds = physics?.sheetDetachSeconds ?? 0;
  if (physics?.sheetDetachAfterReleaseSeconds !== undefined) {
    const poses = calibratedLocalDetachFragments(f, a),
      scale = b.verticalScale ?? 1;
    const colorFrame = e.freezeColorAtRelease
      ? { ...f, frameIndex: f.frameIndex - cue.elapsedFrames }
      : f;
    const activeCells = new Set(poses.filter((p) => p.released).map((p) => p.cell.id));
    c.save();
    c.translate(0, b.y);
    c.scale(1, 1 / scale);
    c.translate(0, -b.y);
    if (!e.prefracture)
      for (const cell of cue.eliminatedCells)
        if (!activeCells.has(cell.id)) {
          const held = calibratedHeldParentPosition(cell, f, a);
          c.save();
          c.translate(0, b.y);
          c.scale(1, scale);
          c.translate(0, -b.y);
          tile(
            held.x,
            held.y,
            b.cell,
            calibratedCellColor(cell.id, cell.kind, colorFrame, a),
            'all',
            a.paletteDepth,
            b.y + (held.y + b.cell / 2 - b.y) * scale,
          );
          c.restore();
        }
    let finePoses: readonly (typeof poses)[number][] = poses;
    if (e.prefractureRefineSeconds !== undefined) {
      const partition = prefractureRefinementPartition(
        poses,
        e,
        calibratedFragmentDisplaySeconds(t, e.fragmentDisplayFps, e.fragmentDisplayPhaseSeconds),
      );
      finePoses = partition.fine;
      for (const proxy of partition.coarse) {
        const m = e.prefractureSubdivisions!,
          size = proxy.size,
          color = calibratedCellColor(proxy.cell.id, proxy.cell.kind, colorFrame, a);
        c.save();
        c.translate(proxy.x, proxy.y);
        c.beginPath();
        c.rect(-size / 2, (-size * scale) / 2, size, size * scale);
        c.clip();
        c.scale(1, scale);
        // One cropped mother face per coarse proxy, never a repeated whole tile.
        tile(
          -size / 2 - proxy.ix * size,
          -size / 2 - (m - 1 - proxy.iy) * size,
          size * m,
          color,
          'face',
          0,
          proxy.motherWorldY,
        );
        c.restore();
      }
    }
    for (const pose of finePoses) {
      if (!pose.visible || (!e.prefracture && !activeCells.has(pose.cell.id))) continue;
      const { cell, ix, iy, size } = pose,
        color = calibratedClearColor(cell.id, cell.kind, colorFrame, a, pose.id),
        r = random(pose.id),
        r2 = random(pose.id + ':vertical'),
        ambient = e.fragmentShading === 'material' ? (e.fragmentAmbient ?? 0.78) : undefined;
      c.save();
      c.globalAlpha = 1;
      c.translate(pose.x, pose.y);
      c.rotate(pose.angle);
      // One material dispatcher owns pinned, supported and free states. Detach
      // never replaces a rock with a tile or resets its texture/rotation age.
      if (
        e.fragmentGeometry === 'rounded-cube' ||
        e.fragmentGeometry === 'rounded-polyhedron' ||
        e.fragmentGeometry === 'fractured-block' ||
        e.fragmentGeometry === 'fractured-volume' ||
        e.fragmentGeometry === 'relief-cube' ||
        e.fragmentGeometry === 'pyramid-quarter'
      )
        roundedCube(
          size,
          color,
          pose.rotationAge,
          r,
          cell,
          ix,
          n - 1 - iy,
          n,
          pose.released,
          true,
          pose.age,
          pose.angle,
        );
      else if (e.fragmentGeometry === 'faceted-chip')
        drawFacetedChip(
          c,
          size,
          color,
          pose.age,
          r,
          r2,
          e.highlight ?? 0.6,
          e.shadow ?? 0,
          ambient,
          materialTexture(
            cell,
            ix,
            e.motionModel === 'constrained-sheet' ? n - 1 - iy : iy,
            color,
            pose.released,
          ),
        );
      else if (e.fragmentGeometry === 'faceted-rock')
        drawFacetedRock(
          c,
          size,
          color,
          pose.age,
          r,
          r2,
          e.highlight ?? 0.6,
          e.shadow ?? 0,
          ambient,
          materialTexture(
            cell,
            ix,
            e.motionModel === 'constrained-sheet' ? n - 1 - iy : iy,
            color,
            pose.released,
          ),
        );
      else if (e.fragmentGeometry === 'rounded-rock')
        drawRoundedRock(
          c,
          size,
          color,
          pose.age,
          r,
          r2,
          e.highlight ?? 0.6,
          e.shadow ?? 0,
          ambient,
          materialTexture(
            cell,
            ix,
            e.motionModel === 'constrained-sheet' ? n - 1 - iy : iy,
            color,
            pose.released,
          ),
        );
      else if (e.fragmentGeometry === 'textured-chip')
        tile(
          -size / 2,
          -size / 2,
          size,
          color,
          'face',
          0,
          calibratedClearLightingY(cell, f, a, pose.released),
        );
      else
        drawTexturedClearCube(
          c,
          size,
          color,
          pose.rotationAge,
          r,
          (x, y, s, col) => {
            c.save();
            c.beginPath();
            c.rect(x, y, s, s);
            c.clip();
            if (e.fragmentSurface === 'solid') {
              c.fillStyle = col;
              c.fillRect(x, y, s, s);
            } else if (e.fragmentSurface === 'tile-repeat')
              tile(x, y, s, col, 'face', 0, calibratedClearLightingY(cell, f, a, pose.released));
            else
              tile(
                x - ix * s,
                y - (n - 1 - iy) * s,
                s * n,
                col,
                'face',
                0,
                calibratedClearLightingY(cell, f, a, pose.released),
              );
            c.restore();
          },
          e.highlight ?? 0.6,
          e.shadow ?? 0,
          e.fragmentAmbient ?? (e.fragmentShading === 'material' ? 0.78 : 0.48),
          e.fragmentRotationSpread ?? 0,
          e.fragmentLightColor,
          e.fragmentShading,
        );
      c.restore();
    }
    c.restore();
    return;
  }
  // This opt-in branch samples only plain physical fragments. Whole-frame
  // presentation clocks and the historical no-clock branch below stay intact.
  if (e.fragmentDisplayFps !== undefined && e.motionModel === 'ballistic') {
    const poses = calibratedSampledBallisticFragments(f, a),
      scale = b.verticalScale ?? 1;
    const partition = e.ballisticPrefracture
      ? ballisticPrefracturePartition(poses, e, b.cell)
      : undefined;
    const colorFrame = e.freezeColorAtRelease
      ? { ...f, frameIndex: f.frameIndex - cue.elapsedFrames }
      : f;
    const activeCells = new Set(poses.filter((p) => p.released).map((p) => p.cell.id));
    c.save();
    c.translate(0, b.y);
    c.scale(1, 1 / scale);
    c.translate(0, -b.y);
    if (!e.prefracture)
      for (const cell of cue.eliminatedCells)
        if (!activeCells.has(cell.id)) {
          const mother = poses.find((p) => p.cell.id === cell.id)!;
          c.save();
          c.translate(0, b.y);
          c.scale(1, scale);
          c.translate(0, -b.y);
          tile(
            mother.motherX,
            b.y + (mother.motherY - b.y) / scale,
            b.cell,
            calibratedCellColor(cell.id, cell.kind, colorFrame, a),
            'all',
            a.paletteDepth,
            mother.lightingY,
          );
          c.restore();
        }
    for (const proxy of partition?.coarse ?? []) {
      if (!proxy.visible) continue;
      c.save();
      c.globalAlpha = 1;
      c.translate(proxy.x, proxy.y);
      if (!proxy.released) {
        const s = proxy.size,
          m = e.ballisticPrefracture!.coarseSubdivisions;
        c.beginPath();
        c.rect(-s / 2, (-s * scale) / 2, s, s * scale);
        c.clip();
        c.scale(1, scale);
        tile(
          -s / 2 - proxy.ix * s,
          -s / 2 - proxy.iy * s,
          s * m,
          calibratedCellColor(proxy.cell.id, proxy.cell.kind, colorFrame, a),
          'all',
          a.paletteDepth,
          proxy.lightingY,
        );
      } else {
        const color = calibratedClearColor(
          proxy.cell.id,
          proxy.cell.kind,
          colorFrame,
          a,
          proxy.groupId,
        );
        c.rotate(proxy.angle);
        roundedCube(
          proxy.size,
          color,
          proxy.rotationAge,
          proxy.seedX,
          proxy.cell,
          proxy.ix,
          proxy.iy,
          e.ballisticPrefracture!.coarseSubdivisions,
          true,
          true,
          proxy.age,
          proxy.angle,
        );
      }
      c.restore();
    }
    for (const pose of partition?.fine ?? poses) {
      if (!pose.visible || (!e.prefracture && !activeCells.has(pose.cell.id))) continue;
      const color = calibratedClearColor(pose.cell.id, pose.cell.kind, colorFrame, a, pose.id);
      c.save();
      c.globalAlpha = 1;
      c.translate(pose.x, pose.y);
      c.rotate(pose.angle);
      roundedCube(
        pose.size,
        color,
        pose.rotationAge,
        pose.seedX,
        pose.cell,
        pose.ix,
        pose.iy,
        n,
        pose.released,
        true,
        pose.age,
        pose.angle,
      );
      c.restore();
    }
    c.restore();
    return;
  }
  if (physics && (e.motionModel !== 'constrained-sheet' || t >= detachSeconds)) {
    const scale = b.verticalScale ?? 1,
      columns = f.before.config.columns;
    const releaseAt = (x: number) =>
      Math.pow(
        calibratedClearFrontDistance(
          Math.max(0, Math.min(1, (x - b.x) / (b.cell * columns))),
          e.frontOrigin,
        ),
        1 / (e.frontExponent ?? 1),
      ) * e.frontSeconds;
    const rows = [...new Set(cue.eliminatedCells.map((cell) => cell.y))].sort((x, y) => x - y);
    // Calibrated references release a whole band by columns. The generic
    // driver's legacy row stagger was never part of this renderer's motion.
    const rowDelay = (_cell: (typeof cue.eliminatedCells)[number]) => 0;
    const mirrored = e.frontOrigin === 'right',
      sheetCells = mirrored
        ? cue.eliminatedCells.map((cell) => ({ ...cell, x: columns - 1 - cell.x }))
        : cue.eliminatedCells;
    const sheetAt = (seconds: number) =>
      simulateClearSheet(
        sheetCells,
        rows,
        columns,
        (seconds * 30 * (e.sheetMotionRate ?? 1)) / 55,
        undefined,
        0,
        {
          origin: e.frontOrigin === 'right' ? 'left' : (e.frontOrigin ?? 'left'),
          subdivisions: n,
          steps: Math.round(e.frontSeconds * 30 * (e.sheetMotionRate ?? 1)),
          ...(e.sheetTearSeconds === undefined
            ? {}
            : { tearAfterSteps: e.sheetTearSeconds * 30 * (e.sheetMotionRate ?? 1) }),
        },
      );
    const folded = e.motionModel === 'constrained-sheet' && detachSeconds > 0;
    const snapshot = folded ? sheetAt(detachSeconds) : undefined,
      delta = 1 / (30 * (e.sheetMotionRate ?? 1)),
      previous = folded ? sheetAt(Math.max(0, detachSeconds - delta)) : undefined;
    const observedAt = (seconds: number) =>
      calibratedObservedFragmentPoses(
        { ...f, lingeringClear: { ...cue, elapsedFrames: seconds * f.fps } },
        a,
      );
    const measured = folded ? observedAt(detachSeconds) : undefined,
      measuredBefore = folded ? observedAt(Math.max(0, detachSeconds - delta)) : undefined;
    const originFor = (
      cell: (typeof cue.eliminatedCells)[number],
      ix: number,
      iy: number,
      seconds: number,
      poses: ReturnType<typeof sheetAt> | undefined,
      measures: ReturnType<typeof observedAt> | undefined,
    ) => {
      const id = `${cell.id}:fragment-${ix}-${iy}`,
        sample = poses?.get(mirrored ? `${cell.id}:fragment-${n - 1 - ix}-${iy}` : id),
        r = random(id),
        observed = measures?.get(id);
      const screenY = calibratedClearLightingY(cell, f, a, true),
        p = position(cell.id, cell.x, cell.y);
      const subrow = e.motionModel === 'constrained-sheet' ? n - 1 - iy : iy;
      if (!sample || sample.releaseAge === 0)
        return {
          x: p.x + ((ix + 0.5) * b.cell) / n,
          y: screenY - (b.cell * scale) / 2 + (((subrow + 0.5) * b.cell) / n) * scale,
          angle: 0,
          released: false,
          releaseAge: 0,
        };
      const pose = mirrored
        ? { ...sample, x: columns - 1 - sample.x, rotationZ: -sample.rotationZ }
        : sample;
      const start = blockCrushDropScreenPosition(f.before, pose.x, pose.y, visualFieldRise),
        cellStart = blockCrushDropScreenPosition(f.before, cell.x, cell.y, visualFieldRise);
      const drift = pose.releaseAge * pose.releaseAge * e.scatterPixels,
        side =
          e.frontOrigin === 'center'
            ? (cell.x / (columns - 1) - 0.5) * 2
            : e.frontOrigin === 'edges'
              ? (0.5 - cell.x / (columns - 1)) * 2
              : mirrored
                ? 1
                : -1;
      const x =
        observed?.x ??
        start.x + b.cell / 2 + drift * (side + (r - 0.5) * 0.3) * (e.scatterHorizontalRatio ?? 1);
      const dy =
        (start.y -
          cellStart.y -
          calibratedSheetLift(pose.releaseAge, e) +
          (random(id + ':vertical') - 0.5) * drift * (e.scatterVerticalRatio ?? 0) -
          (cell.y + (iy + 0.5) / n - 0.5 - (rows[0]! + rows.at(-1)!) / 2) *
            b.cell *
            ((e.sheetThicknessScale ?? 1) - 1) *
            Math.min(1, pose.releaseAge * 4)) *
        scale;
      const y = observed ? b.y + (observed.y - b.y) * scale : screenY + dy;
      return {
        x,
        y,
        angle: observed?.angle ?? -pose.rotationZ + (r - 0.5) * pose.releaseAge * 0.4,
        released: seconds > 0,
        releaseAge: pose.releaseAge,
      };
    };
    // The caller retains the board scale for pinned folds. Free flight itself is
    // sampled in screen pixels so tall/narrow reference grids cannot change g.
    c.save();
    c.translate(0, b.y);
    c.scale(1, 1 / scale);
    c.translate(0, -b.y);
    for (const cell of [...cue.eliminatedCells].sort((x, y) => y.y - x.y || x.x - y.x)) {
      const p = position(cell.id, cell.x, cell.y),
        colorFrame = e.freezeColorAtRelease
          ? { ...f, frameIndex: f.frameIndex - cue.elapsedFrames }
          : f;
      const firstRelease = Math.min(
        ...Array.from(
          { length: n },
          (_, ix) => releaseAt(p.x + ((ix + 0.5) * b.cell) / n) + rowDelay(cell),
        ),
      );
      if (!e.prefracture && t < firstRelease) {
        c.save();
        c.translate(0, b.y);
        c.scale(1, scale);
        c.translate(0, -b.y);
        tile(p.x, p.y, b.cell, calibratedClearColor(cell.id, cell.kind, colorFrame, a));
        c.restore();
        continue;
      }
      for (let iy = 0; iy < n; iy++)
        for (let ix = 0; ix < n; ix++) {
          const id = `${cell.id}:fragment-${ix}-${iy}`,
            r = random(id),
            r2 = random(id + ':vertical'),
            origin = originFor(cell, ix, iy, detachSeconds, snapshot, measured),
            before = originFor(
              cell,
              ix,
              iy,
              Math.max(0, detachSeconds - delta),
              previous,
              measuredBefore,
            );
          const releaseSeconds = origin.released
            ? detachSeconds
            : Math.max(
                folded ? detachSeconds : 0,
                releaseAt(p.x + ((ix + 0.5) * b.cell) / n) + rowDelay(cell),
              );
          const size =
            (b.cell / n) * (e.fragmentScale ?? 1.1) * (1 + (e.sizeSpread ?? 0) * (2 * r - 1));
          const inherited =
            origin.released && before.released
              ? { x: (origin.x - before.x) / delta, y: (origin.y - before.y) / delta }
              : { x: 0, y: 0 };
          const pose = calibratedFragmentPhysicsPose({
            elapsedSeconds: t,
            releaseSeconds,
            x: origin.x,
            y: origin.y,
            size,
            seedX: r,
            seedY: r2,
            physics: {
              ...physics,
              initialVelocityX: physics.initialVelocityX + inherited.x,
              initialVelocityY: physics.initialVelocityY + inherited.y,
            },
          });
          if (!pose.visible) continue;
          const color = calibratedClearColor(cell.id, cell.kind, colorFrame, a, id),
            ambient = e.fragmentShading === 'material' ? (e.fragmentAmbient ?? 0.78) : undefined;
          c.save();
          c.globalAlpha = 1;
          c.translate(pose.x, pose.y);
          c.rotate(origin.angle + pose.age * (r - 0.5) * 0.65);
          if (!pose.released) {
            if (
              e.fragmentGeometry === 'rounded-cube' ||
              e.fragmentGeometry === 'rounded-polyhedron' ||
              e.fragmentGeometry === 'fractured-block' ||
              e.fragmentGeometry === 'fractured-volume' ||
              e.fragmentGeometry === 'relief-cube' ||
              e.fragmentGeometry === 'pyramid-quarter'
            )
              roundedCube(
                (b.cell / n) * (e.prefractureScale ?? 1),
                color,
                0,
                r,
                cell,
                ix,
                e.motionModel === 'constrained-sheet' ? n - 1 - iy : iy,
                n,
                false,
              );
            else {
              drawCalibratedDropTile(c, -b.cell / n / 2, -b.cell / n / 2, b.cell / n, color, {
                ...a,
                seam: 0,
                shadow: 0,
              });
              overlayMaterialTile(
                -b.cell / n / 2,
                -b.cell / n / 2,
                b.cell / n,
                color,
                cell,
                ix,
                e.motionModel === 'constrained-sheet' ? n - 1 - iy : iy,
                n,
                false,
              );
            }
            c.restore();
            continue;
          }
          if (
            e.fragmentGeometry === 'rounded-cube' ||
            e.fragmentGeometry === 'rounded-polyhedron' ||
            e.fragmentGeometry === 'fractured-block' ||
            e.fragmentGeometry === 'fractured-volume' ||
            e.fragmentGeometry === 'relief-cube' ||
            e.fragmentGeometry === 'pyramid-quarter'
          )
            roundedCube(
              size,
              color,
              (origin.released ? (origin.releaseAge + pose.age) * (0.6 + r * 0.35) : pose.age) *
                (e.fragmentCubeRotationAgeScale ?? 1),
              r,
              cell,
              ix,
              e.motionModel === 'constrained-sheet' ? n - 1 - iy : iy,
              n,
              true,
              true,
              origin.released ? sheetReleaseAgeSeconds(cell, ix, t) : pose.age,
              e.fragmentGeometry === 'rounded-polyhedron'
                ? origin.angle + pose.age * (r - 0.5) * 0.65
                : 0,
            );
          else if (e.fragmentGeometry === 'faceted-chip')
            drawFacetedChip(
              c,
              size,
              color,
              pose.age,
              r,
              r2,
              e.highlight ?? 0.6,
              e.shadow ?? 0,
              ambient,
              materialTexture(
                cell,
                ix,
                e.motionModel === 'constrained-sheet' ? n - 1 - iy : iy,
                color,
                pose.released,
              ),
            );
          else if (e.fragmentGeometry === 'faceted-rock')
            drawFacetedRock(
              c,
              size,
              color,
              pose.age,
              r,
              r2,
              e.highlight ?? 0.6,
              e.shadow ?? 0,
              ambient,
              materialTexture(
                cell,
                ix,
                e.motionModel === 'constrained-sheet' ? n - 1 - iy : iy,
                color,
                pose.released,
              ),
            );
          else if (e.fragmentGeometry === 'rounded-rock')
            drawRoundedRock(
              c,
              size,
              color,
              pose.age,
              r,
              r2,
              e.highlight ?? 0.6,
              e.shadow ?? 0,
              ambient,
              materialTexture(
                cell,
                ix,
                e.motionModel === 'constrained-sheet' ? n - 1 - iy : iy,
                color,
                pose.released,
              ),
            );
          else if (e.fragmentGeometry === 'textured-chip')
            tile(
              -size / 2,
              -size / 2,
              size,
              color,
              'face',
              0,
              calibratedClearLightingY(cell, f, a, true),
            );
          else
            drawTexturedClearCube(
              c,
              size,
              color,
              (origin.released ? (origin.releaseAge + pose.age) * (0.6 + r * 0.35) : pose.age) *
                (e.fragmentCubeRotationAgeScale ?? 1),
              r,
              (x, y, s, col) => {
                c.save();
                c.beginPath();
                c.rect(x, y, s, s);
                c.clip();
                if (e.fragmentSurface === 'solid') {
                  c.fillStyle = col;
                  c.fillRect(x, y, s, s);
                } else if (e.fragmentSurface === 'tile-repeat')
                  tile(x, y, s, col, 'face', 0, calibratedClearLightingY(cell, f, a, true));
                else
                  tile(
                    x - ix * s,
                    y - iy * s,
                    s * n,
                    col,
                    'face',
                    0,
                    calibratedClearLightingY(cell, f, a, true),
                  );
                c.restore();
              },
              e.highlight ?? 0.6,
              e.shadow ?? 0,
              e.fragmentAmbient ?? (e.fragmentShading === 'material' ? 0.78 : 0.48),
              e.fragmentRotationSpread ?? 0,
              e.fragmentLightColor,
              e.fragmentShading,
            );
          c.restore();
        }
    }
    c.restore();
    return;
  }

  if (e.motionModel === 'constrained-sheet') {
    const observed = calibratedObservedFragmentPoses(f, a);
    const paintLit = (
      x: number,
      y: number,
      size: number,
      color: string,
      cell: (typeof cue.eliminatedCells)[number],
      released: boolean,
    ) =>
      e.fragmentShading === 'material'
        ? tile(
            x,
            y,
            size,
            color,
            'face',
            0,
            a.tilePaletteLighting ? calibratedClearLightingY(cell, f, a, released) : undefined,
          )
        : a.tilePaletteLighting
          ? tile(
              x,
              y,
              size,
              color,
              undefined,
              undefined,
              calibratedClearLightingY(cell, f, a, released),
            )
          : tile(x, y, size, color);
    const rows = [...new Set(cue.eliminatedCells.map((cell) => cell.y))].sort((a, b) => a - b);
    const rate = e.sheetMotionRate ?? 1;
    const mirrored = e.frontOrigin === 'right',
      columns = f.before.config.columns;
    const sheetCells = mirrored
      ? cue.eliminatedCells.map((cell) => ({ ...cell, x: columns - 1 - cell.x }))
      : cue.eliminatedCells;
    const poses = simulateClearSheet(
      sheetCells,
      rows,
      columns,
      (t * 30 * rate) / 55,
      undefined,
      0,
      {
        origin: e.frontOrigin === 'right' ? 'left' : (e.frontOrigin ?? 'left'),
        subdivisions: n,
        steps: Math.round(e.frontSeconds * 30 * rate),
        ...(e.sheetTearSeconds === undefined
          ? {}
          : { tearAfterSteps: e.sheetTearSeconds * 30 * rate }),
      },
    );
    for (const cell of [...cue.eliminatedCells].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const u = cell.x / Math.max(1, f.before.config.columns - 1),
        distance = calibratedClearFrontDistance(u, e.frontOrigin);
      if (!e.prefracture && t < distance * e.frontSeconds) {
        const p = position(cell.id, cell.x, cell.y);
        paintLit(p.x, p.y, b.cell, calibratedClearColor(cell.id, cell.kind, f, a), cell, false);
        continue;
      }
      if (
        e.prefracture &&
        e.prefractureSubdivisions !== undefined &&
        e.prefractureSubdivisions !== n &&
        Array.from(
          { length: n * n },
          (_, j) => poses.get(`${cell.id}:fragment-${j % n}-${Math.floor(j / n)}`)!.releaseAge,
        ).every((age) => age === 0)
      ) {
        drawPinnedGrid(cell);
        continue;
      }
      for (let iy = 0; iy < n; iy++)
        for (let ix = 0; ix < n; ix++) {
          const id = `${cell.id}:fragment-${ix}-${iy}`,
            sample = poses.get(mirrored ? `${cell.id}:fragment-${n - 1 - ix}-${iy}` : id)!,
            pose = mirrored
              ? { ...sample, x: columns - 1 - sample.x, rotationZ: -sample.rotationZ }
              : sample;
          const p = position(cell.id, pose.x, pose.y),
            color = calibratedClearColor(cell.id, cell.kind, f, a, id),
            r = random(id),
            size =
              (b.cell / n) *
              (e.fragmentPhysics
                ? pose.releaseAge > 0
                  ? (e.fragmentScale ?? 1.1)
                  : (e.prefractureScale ?? 1)
                : (e.prefracture
                    ? (e.prefractureScale ?? 1) +
                      ((e.fragmentScale ?? 1.1) - (e.prefractureScale ?? 1)) *
                        Math.min(1, pose.releaseAge * 8)
                    : (e.fragmentScale ?? 1.1)) *
                  (1 + pose.releaseAge * 0.08)) *
              (1 + (e.sizeSpread ?? 0) * (2 * r - 1));
          c.save();
          c.globalAlpha = e.fragmentPhysics
            ? 1
            : Math.max(0, 1 - Math.pow(Math.min(1, t / e.lifetimeSeconds), 8));
          const drift = pose.releaseAge * pose.releaseAge * e.scatterPixels,
            side =
              e.frontOrigin === 'center'
                ? (cell.x / (f.before.config.columns - 1) - 0.5) * 2
                : e.frontOrigin === 'edges'
                  ? (0.5 - cell.x / (f.before.config.columns - 1)) * 2
                  : e.frontOrigin === 'right'
                    ? 1
                    : -1;
          const measured = observed.get(id);
          c.translate(
            measured?.x ??
              p.x + b.cell / 2 + drift * (side + (r - 0.5) * 0.3) * (e.scatterHorizontalRatio ?? 1),
            measured?.y ??
              p.y +
                b.cell / 2 -
                calibratedSheetLift(pose.releaseAge, e) +
                (random(id + ':vertical') - 0.5) * drift * (e.scatterVerticalRatio ?? 0) -
                (cell.y + (iy + 0.5) / n - 0.5 - (rows[0]! + rows.at(-1)!) / 2) *
                  b.cell *
                  ((e.sheetThicknessScale ?? 1) - 1) *
                  Math.min(1, pose.releaseAge * 4),
          );
          c.rotate(measured?.angle ?? -pose.rotationZ + (r - 0.5) * pose.releaseAge * 0.4);
          if (
            e.fragmentGeometry === 'rounded-cube' ||
            e.fragmentGeometry === 'rounded-polyhedron' ||
            e.fragmentGeometry === 'fractured-block' ||
            e.fragmentGeometry === 'fractured-volume' ||
            e.fragmentGeometry === 'relief-cube' ||
            e.fragmentGeometry === 'pyramid-quarter'
          )
            roundedCube(
              size,
              color,
              pose.releaseAge * (0.6 + r * 0.35) * (e.fragmentCubeRotationAgeScale ?? 1),
              r,
              cell,
              ix,
              n - 1 - iy,
              n,
              pose.releaseAge > 0,
              true,
              sheetReleaseAgeSeconds(cell, ix, t),
            );
          else if (e.fragmentGeometry === 'rounded-rock')
            drawRoundedRock(
              c,
              size,
              color,
              pose.releaseAge,
              r,
              random(id + ':shape'),
              e.highlight ?? 0.6,
              e.shadow ?? 0,
              e.fragmentShading === 'material' ? (e.fragmentAmbient ?? 0.78) : undefined,
              materialTexture(cell, ix, n - 1 - iy, color, pose.releaseAge > 0),
            );
          else if (e.fragmentGeometry === 'faceted-rock')
            drawFacetedRock(
              c,
              size,
              color,
              pose.releaseAge,
              r,
              random(id + ':shape'),
              e.highlight ?? 0.6,
              e.shadow ?? 0,
              e.fragmentShading === 'material' ? (e.fragmentAmbient ?? 0.78) : undefined,
              materialTexture(cell, ix, n - 1 - iy, color, pose.releaseAge > 0),
            );
          else if (e.fragmentGeometry === 'faceted-chip')
            drawFacetedChip(
              c,
              size,
              color,
              pose.releaseAge,
              r,
              random(id + ':shape'),
              e.highlight ?? 0.6,
              e.shadow ?? 0,
              e.fragmentShading === 'material' ? (e.fragmentAmbient ?? 0.78) : undefined,
              materialTexture(cell, ix, n - 1 - iy, color, pose.releaseAge > 0),
            );
          else
            drawTexturedClearCube(
              c,
              size,
              color,
              pose.releaseAge * (0.6 + r * 0.35) * (e.fragmentCubeRotationAgeScale ?? 1),
              r,
              (x, y, s, col) => {
                c.save();
                c.beginPath();
                c.rect(x, y, s, s);
                c.clip();
                if (e.fragmentSurface === 'solid') {
                  c.fillStyle = col;
                  c.fillRect(x, y, s, s);
                } else if (e.fragmentSurface === 'tile-repeat') paintLit(x, y, s, col, cell, true);
                else if (
                  e.fragmentPalette ||
                  e.fragmentColor ||
                  e.colorByAction ||
                  e.colorSource === 'action-piece'
                ) {
                  if (a.material === 'ice' && pose.releaseAge < 0.06)
                    drawCalibratedDropTile(c, x, y, s, col, {
                      ...a,
                      material: 'pyramid',
                      seam: 0,
                      shadow: 0,
                    });
                  else {
                    c.fillStyle = col;
                    c.fillRect(x, y, s, s);
                  }
                } else paintLit(x - ix * s, y - (n - 1 - iy) * s, s * n, col, cell, true);
                c.restore();
              },
              e.highlight ?? 1,
              e.shadow ?? 0,
              e.fragmentAmbient ?? (e.fragmentShading === 'material' ? 0.78 : 0.48),
              (e.fragmentRotationSpread ?? 0) * Math.min(1, pose.releaseAge * 6),
              e.fragmentLightColor,
              e.fragmentShading,
            );
          c.restore();
        }
    }
    return;
  }
  const releaseAt = (x: number) => {
    const u = Math.max(0, Math.min(1, (x - b.x) / (b.cell * f.before.config.columns)));
    const distance = calibratedClearFrontDistance(u, e.frontOrigin);
    return Math.pow(distance, 1 / (e.frontExponent ?? 1)) * e.frontSeconds;
  };
  for (const cell of cue.eliminatedCells) {
    const color = calibratedClearColor(
        cell.id,
        cell.kind,
        e.freezeColorAtRelease ? { ...f, frameIndex: f.frameIndex - cue.elapsedFrames } : f,
        a,
      ),
      p = position(cell.id, cell.x, cell.y);
    const release = releaseAt(p.x + b.cell / 2);
    if (!e.prefracture && t < release) {
      c.save();
      tile(p.x, p.y, b.cell, color);
      c.restore();
      continue;
    }
    if (
      e.prefracture &&
      e.prefractureSubdivisions !== undefined &&
      e.prefractureSubdivisions !== n &&
      t < releaseAt(p.x + b.cell / (2 * n))
    ) {
      drawPinnedGrid(cell);
      continue;
    }
    for (let iy = 0; iy < n; iy++)
      for (let ix = 0; ix < (e.fragmentGeometry === 'textured-chip' ? 1 : n); ix++) {
        const key = `${cell.id}:${ix}:${iy}`,
          r = random(key),
          r2 = random(key + 'b'),
          px = p.x + ((ix + (e.fragmentGeometry === 'textured-chip' ? 0 : 0.5)) * b.cell) / n,
          py = p.y + ((iy + (e.fragmentGeometry === 'textured-chip' ? 0 : 0.5)) * b.cell) / n;
        const waiting = t < releaseAt(px);
        if (e.prefracture && waiting) {
          const col = calibratedClearColor(cell.id, cell.kind, f, a, key),
            size = (b.cell / n) * (e.prefractureScale ?? 1);
          c.save();
          c.translate(px, py);
          if (
            e.fragmentGeometry === 'rounded-cube' ||
            e.fragmentGeometry === 'rounded-polyhedron' ||
            e.fragmentGeometry === 'fractured-block' ||
            e.fragmentGeometry === 'fractured-volume' ||
            e.fragmentGeometry === 'relief-cube' ||
            e.fragmentGeometry === 'pyramid-quarter'
          )
            roundedCube(size, col, 0, r, cell, ix, iy, n, false);
          else if (e.fragmentGeometry === 'rounded-rock')
            drawRoundedRock(
              c,
              size,
              col,
              0,
              r,
              r2,
              e.highlight ?? 0.6,
              e.shadow ?? 0,
              e.fragmentShading === 'material' ? (e.fragmentAmbient ?? 0.78) : undefined,
              materialTexture(cell, ix, iy, col, false),
            );
          else if (e.fragmentGeometry === 'faceted-rock')
            drawFacetedRock(
              c,
              size,
              col,
              0,
              r,
              r2,
              e.highlight ?? 0.6,
              e.shadow ?? 0,
              e.fragmentShading === 'material' ? (e.fragmentAmbient ?? 0.78) : undefined,
              materialTexture(cell, ix, iy, col, false),
            );
          else if (e.fragmentGeometry === 'faceted-chip')
            drawFacetedChip(
              c,
              size,
              col,
              0,
              r,
              r2,
              e.highlight ?? 0.6,
              e.shadow ?? 0,
              e.fragmentShading === 'material' ? (e.fragmentAmbient ?? 0.78) : undefined,
              materialTexture(cell, ix, iy, col, false),
            );
          else
            drawCalibratedDropTile(c, -size / 2, -size / 2, size, col, {
              ...a,
              shadow: 0,
              seam: 0,
            });
          c.restore();
          continue;
        }
        const delay = releaseAt(px),
          age = Math.max(0, t - delay + (e.fragmentAgeOffsetSeconds ?? 0.09)),
          u = Math.min(1, age / e.lifetimeSeconds),
          flow = 1 - Math.exp(-age * 3);
        const granular = e.style === 'granular-sweep';
        const solid =
          e.fragmentGeometry === 'faceted-chip' ||
          e.fragmentGeometry === 'faceted-rock' ||
          e.fragmentGeometry === 'rounded-rock' ||
          e.fragmentGeometry === 'fractured-block' ||
          e.fragmentGeometry === 'fractured-volume';
        const dx =
          (granular
            ? ((solid
                ? -0.15 * Math.sin(Math.min(1, age) * Math.PI)
                : Math.sin(age * 5 + ((px - b.x) / 1080) * 2) * 0.22) +
                (r - 0.5) * flow) *
              e.scatterPixels
            : (540 - px) * Math.sin(Math.min(1, age) * Math.PI * 0.5) * 0.12 +
              (r - 0.5) * e.scatterPixels * flow) * (e.scatterHorizontalRatio ?? 1);
        const dy =
          e.fallPixels *
            (e.fragmentGeometry === 'textured-chip'
              ? age * age - 0.18 * age
              : 0.12 * age + age * age * 0.55) *
            (1 + (e.fallSpread ?? 0) * (2 * r2 - 1)) +
          (granular
            ? (r2 - 0.5) * e.scatterPixels * flow * (e.scatterVerticalRatio ?? 1)
            : Math.sin(((px - b.x) / 1080) * Math.PI) * Math.min(1, age) * b.cell * 2);
        c.save();
        c.globalAlpha = 1 - Math.pow(u, 5);
        c.translate(px + dx, py + dy);
        c.rotate(
          e.fragmentGeometry === 'textured-chip'
            ? age * 9
            : (granular ? r * Math.PI : 0) + age * (r - 0.5) * (granular ? 14 : 3),
        );
        if (
          !solid &&
          e.fragmentGeometry !== 'textured-cube' &&
          e.fragmentGeometry !== 'textured-chip' &&
          e.fragmentGeometry !== 'rounded-cube' &&
          e.fragmentGeometry !== 'rounded-polyhedron' &&
          e.fragmentGeometry !== 'fractured-block' &&
          e.fragmentGeometry !== 'fractured-volume' &&
          e.fragmentGeometry !== 'relief-cube' &&
          e.fragmentGeometry !== 'pyramid-quarter'
        )
          c.scale(
            Math.max(0.24, Math.abs(Math.cos(age * (r2 + 0.5) * 6))),
            Math.max(0.3, Math.abs(Math.cos(age * (r + 0.5) * 4))),
          );
        const size =
          (b.cell / n) *
          (granular ? (e.fragmentScale ?? 3.4) : (e.fragmentScale ?? 1.01)) *
          (1 + (e.sizeSpread ?? 0) * (2 * r - 1));
        const fragmentColor = calibratedClearColor(
          cell.id,
          cell.kind,
          e.freezeColorAtRelease ? { ...f, frameIndex: f.frameIndex - cue.elapsedFrames } : f,
          a,
          key,
        );
        if (
          e.fragmentGeometry === 'rounded-cube' ||
          e.fragmentGeometry === 'rounded-polyhedron' ||
          e.fragmentGeometry === 'fractured-block' ||
          e.fragmentGeometry === 'fractured-volume' ||
          e.fragmentGeometry === 'relief-cube' ||
          e.fragmentGeometry === 'pyramid-quarter'
        )
          roundedCube(
            size,
            fragmentColor,
            age * (e.fragmentCubeRotationAgeScale ?? 1),
            r,
            cell,
            ix,
            iy,
            n,
            true,
            true,
            Math.max(0, t - delay),
            e.fragmentGeometry === 'rounded-polyhedron'
              ? (granular ? r * Math.PI : 0) + age * (r - 0.5) * (granular ? 14 : 3)
              : 0,
          );
        else if (e.fragmentGeometry === 'textured-chip')
          tile(-size / 2, -size / 2, size, fragmentColor);
        else if (granular && e.fragmentGeometry === 'rounded-rock')
          drawRoundedRock(
            c,
            size,
            fragmentColor,
            age,
            r,
            r2,
            e.highlight ?? 0.6,
            e.shadow ?? 0,
            e.fragmentShading === 'material' ? (e.fragmentAmbient ?? 0.78) : undefined,
            materialTexture(cell, ix, iy, fragmentColor, true),
          );
        else if (e.fragmentGeometry === 'textured-cube')
          drawTexturedClearCube(
            c,
            size,
            fragmentColor,
            age * (e.fragmentCubeRotationAgeScale ?? 1),
            r,
            (x, y, s, col) => {
              c.save();
              c.beginPath();
              c.rect(x, y, s, s);
              c.clip();
              if (e.fragmentSurface === 'solid') {
                c.fillStyle = col;
                c.fillRect(x, y, s, s);
              } else if (e.fragmentSurface === 'tile-repeat') {
                if (e.fragmentShading === 'material')
                  tile(
                    x,
                    y,
                    s,
                    col,
                    'face',
                    0,
                    a.tilePaletteLighting ? calibratedClearLightingY(cell, f, a, true) : undefined,
                  );
                else if (a.tilePaletteLighting)
                  tile(
                    x,
                    y,
                    s,
                    col,
                    undefined,
                    undefined,
                    calibratedClearLightingY(cell, f, a, true),
                  );
                else tile(x, y, s, col);
              } else tile(x - ix * s, y - iy * s, s * n, col);
              c.restore();
            },
            e.highlight ?? 1,
            e.shadow ?? 0,
            e.fragmentAmbient ?? (e.fragmentShading === 'material' ? 0.78 : 0.48),
            e.fragmentRotationSpread ?? 0,
            e.fragmentLightColor,
            e.fragmentShading,
          );
        else if (granular && e.fragmentGeometry === 'faceted-rock')
          drawFacetedRock(
            c,
            size,
            fragmentColor,
            age,
            r,
            r2,
            e.highlight ?? 0.6,
            e.shadow ?? 0,
            e.fragmentShading === 'material' ? (e.fragmentAmbient ?? 0.78) : undefined,
            materialTexture(cell, ix, iy, fragmentColor, true),
          );
        else if (granular && solid)
          drawFacetedChip(
            c,
            size,
            fragmentColor,
            age,
            r,
            r2,
            e.highlight ?? 0.6,
            e.shadow ?? 0,
            e.fragmentShading === 'material' ? (e.fragmentAmbient ?? 0.78) : undefined,
            materialTexture(cell, ix, iy, fragmentColor, true),
          );
        else if (granular) {
          polygon(
            c,
            [
              [-size * 0.55, -size * 0.3],
              [size * 0.4, -size * 0.5],
              [size * 0.1, size * 0.15],
            ],
            shade(fragmentColor, 1 + (e.highlight ?? 0.6) * (0.3 + r)),
          );
          polygon(
            c,
            [
              [size * 0.4, -size * 0.5],
              [size * 0.5, size * 0.35],
              [size * 0.1, size * 0.15],
            ],
            shade(fragmentColor, 0.5 + r2 * 0.45),
          );
          polygon(
            c,
            [
              [-size * 0.55, -size * 0.3],
              [size * 0.1, size * 0.15],
              [-size * 0.2, size * 0.5],
            ],
            shade(fragmentColor, 0.7 + r * (e.highlight ?? 0.6)),
          );
        } else {
          drawCalibratedDropTile(c, -size / 2, -size / 2, size, fragmentColor, { ...a, shadow: 0 });
          overlayMaterialTile(-size / 2, -size / 2, size, fragmentColor, cell, ix, iy, n, true);
        }
        c.restore();
      }
  }
}
