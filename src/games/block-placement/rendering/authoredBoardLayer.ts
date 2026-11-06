import {
  materialTheme,
  materialCellMetrics,
} from '../../../nativeReference/games/block-placement/render/materialThemes';
import { hash32, seededFloat } from '../../../nativeReference/domain/rng';
import {
  BLAST_BOARD_COLORS,
  REFERENCE_BOARD_COLORS,
  REFERENCE_LAYOUT,
} from '../../../nativeReference/reference2d/referenceProfile';
import type {
  BoardState,
  ClearingFrame,
  StyleSpec,
  TileColor,
} from '../../../nativeReference/domain/types';
import type { ReferencePassId } from '../../../nativeReference/headless/contracts';
import type { BBTimelineFrame } from '../planning/bbTimelinePlan';
import { paintBoardCells } from './boardLayer';
const TWO_PI = Math.PI * 2;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const cellKey = (row: number, col: number) => `${row}:${col}`;
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
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${clamp01(alpha)})`;
}

export function paintAuthoredBoard(
  context: CanvasRenderingContext2D,
  style: StyleSpec | null,
  board: BoardState,
  bbFrame: BBTimelineFrame,
  clearing: ClearingFrame | null,
  seconds: number,
  pass: (id: ReferencePassId) => boolean,
  drawBoardTile: (
    row: number,
    col: number,
    color: TileColor,
    alpha?: number,
    scale?: number,
  ) => void,
): void {
  const blast = style?.reference2d.tileMaterial === 'candy-blast';
  const outer = REFERENCE_LAYOUT.board.outer;
  const grid = REFERENCE_LAYOUT.board.grid;
  const cells = bbFrame.boardDrawables;
  const slots =
    board.rows === 8 && board.cols === 8
      ? cells
      : Array.from({ length: 64 }, (_, index) => ({
          row: Math.floor(index / 8),
          col: index % 8,
          x: grid.x + (index % 8) * grid.pitch,
          y: grid.y + Math.floor(index / 8) * grid.pitch,
          size: grid.cell,
          color: null,
        }));
  const combo = bbFrame.visualState.combo;
  const clearGlow = clearing ? Math.sin(clamp01(clearing.progress) * Math.PI) : 0;
  const comboGlow = combo >= 2 ? Math.min(1, 0.3 + combo * 0.06) : 0;

  if (pass('board')) {
    const board =
      materialTheme(style?.reference2d.materialTheme)?.board ??
      (blast ? BLAST_BOARD_COLORS : REFERENCE_BOARD_COLORS);
    const wellRadius = blast ? Math.max(8, grid.cell * 0.18) : 8;

    context.save();
    context.shadowColor = board.shadow;
    context.shadowBlur = blast ? 10 : 17;
    context.shadowOffsetY = blast ? 6 : 9;
    roundedRect(context, outer.x, outer.y, outer.size, outer.size, outer.radius);
    context.fillStyle = board.frame;
    context.fill();
    context.restore();

    if (style?.reference2d.materialTheme) {
      context.save();
      context.strokeStyle = board.frameHighlight;
      context.lineWidth = 2;
      context.globalAlpha = 0.65;
      roundedRect(
        context,
        outer.x + 1,
        outer.y + 1,
        outer.size - 2,
        outer.size - 2,
        outer.radius - 1,
      );
      context.stroke();
      context.restore();
    }

    const screenFxId = style?.reference2d.screenFx;
    // 侧边霓虹: blast 皮肤默认开; 显式 screenFx 时只在含 edge-glow 的档位开
    const edgeGlowOn =
      blast &&
      (screenFxId === undefined ||
        screenFxId === 'edge-glow' ||
        screenFxId === 'edge-glow+clear-bloom');
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
        roundedRect(
          context,
          outer.x - 4,
          outer.y - 4,
          outer.size + 8,
          outer.size + 8,
          outer.radius + 4,
        );
        context.stroke();
        // 内层亮线(combo>=4 变流动彩虹)
        context.shadowBlur = 12 + 10 * boost;
        context.shadowColor = '#ffd7f2';
        if (combo >= 4) {
          const flow = context.createLinearGradient(
            outer.x,
            outer.y,
            outer.x + outer.size,
            outer.y + outer.size,
          );
          for (let i = 0; i <= 6; i += 1) {
            flow.addColorStop(
              i / 6,
              `hsla(${(i * 60 + seconds * 70) % 360}, 100%, 62%, ${Math.min(1, 0.55 + 0.35 * boost)})`,
            );
          }
          context.strokeStyle = flow;
        } else {
          context.strokeStyle = colorWithAlpha('#ffd7f2', Math.min(1, neon * 0.9));
        }
        context.lineWidth = 3.5 + 1.5 * boost;
        roundedRect(
          context,
          outer.x + 1.5,
          outer.y + 1.5,
          outer.size - 3,
          outer.size - 3,
          outer.radius - 1,
        );
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
          if (d < outer.size) {
            sx += d;
          } else if (d < outer.size * 2) {
            sx += outer.size;
            sy += d - outer.size;
          } else if (d < outer.size * 3) {
            sx += outer.size - (d - outer.size * 2);
            sy += outer.size;
          } else {
            sy += outer.size - (d - outer.size * 3);
          }
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
        roundedRect(
          context,
          outer.x + 2,
          outer.y + 2,
          outer.size - 4,
          outer.size - 4,
          outer.radius - 2,
        );
        context.stroke();
        context.restore();
      }
    }

    paintBoardCells(slots, 'slots', {
      slot: ({ x, y }) => {
        const slotGradient = context.createLinearGradient(x, y, x, y + grid.cell);
        slotGradient.addColorStop(0, board.slotTop);
        slotGradient.addColorStop(1, board.slot);
        if (blast) {
          // 原视频样式: 平涂小圆角 + 细缝(内缩留出缝), 不要大圆井
          const inset = materialCellMetrics(style?.reference2d.cellGapPx).slotInset;
          const radius = Math.max(3, grid.cell * 0.05);
          roundedRect(
            context,
            x + inset,
            y + inset,
            grid.cell - inset * 2,
            grid.cell - inset * 2,
            radius,
          );
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
      },
    });
  }

  const clearSet = new Set(clearing?.clear.cells.map((cell) => cellKey(cell.row, cell.col)) ?? []);
  if (!pass('tile')) return;
  paintBoardCells(cells, 'occupied', {
    occupied: (cell) => {
      const { row, col } = cell;
      const color = board.cells[row]?.[col];
      if (color !== cell.color) throw new Error(`BB_SCENE_BOARD_CELL_MISMATCH:${row}:${col}`);
      if (!color) return;
      let alpha = 1;
      let scale = 1;
      if (clearing && clearSet.has(cellKey(row, col))) {
        if (blast) {
          // 白闪阶段(progress 0~0.22): 原块微放大 + 白色叠加, 之后由爆裂复制体接管
          const flash = Math.sin(clamp01(clearing.progress / 0.22) * Math.PI);
          if (flash > 0.01 && pass('clear')) {
            drawBoardTile(row, col, color, 1, 1 + flash * 0.06);
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
          return;
        }
        const dissolve = clamp01((clearing.progress - 0.34) / 0.42);
        alpha = 1 - dissolve;
        scale = 1 - dissolve * 0.2;
      }
      drawBoardTile(row, col, color, alpha, scale);
    },
  });

  if (clearing && !blast) {
    for (const cell of clearing.clear.cells) {
      if (board.cells[cell.row]?.[cell.col]) continue;
      const dissolve = clamp01((clearing.progress - 0.34) / 0.42);
      drawBoardTile(cell.row, cell.col, cell.color, 1 - dissolve, 1 - dissolve * 0.2);
    }
  }
}
