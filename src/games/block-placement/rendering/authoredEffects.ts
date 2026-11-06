import { hash32, seededFloat } from '../../../nativeReference/domain/rng';
import { blastPraiseTier, type BlastPraiseTierId } from '../../../nativeReference/domain/types';
import { praiseWordLabel, resolvePraiseWord } from '../../../nativeReference/domain/praiseWords';
import type {
  ClearingFrame,
  StyleSpec,
  TileColor,
  PraiseTierId,
} from '../../../nativeReference/domain/types';
import {
  REFERENCE_LAYOUT,
  REFERENCE_CANVAS,
  type ReferenceTilePalette,
} from '../../../nativeReference/reference2d/referenceProfile';
import {
  TWO_PI,
  clamp01,
  easeOutCubic,
  easeOutBack,
  roundedRect,
  colorWithAlpha,
  rainbowGradient,
  BLAST_CONFETTI,
  burstTravel,
  blastBurstPose,
} from './canvasPrimitives';
import { paintThumb } from './thumbLayer';
import type { BBTimelineFrame } from '../planning/bbTimelinePlan';

/** Clear and praise effects only: no board, rack, or Take state machine. */
export class AuthoredEffects {
  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly style: StyleSpec,
    private readonly frame: BBTimelineFrame,
    private readonly tilePalette: (color: TileColor) => ReferenceTilePalette,
    private readonly drawTile: (
      x: number,
      y: number,
      size: number,
      color: TileColor,
      alpha: number,
      scale: number,
      motif: boolean,
    ) => void,
  ) {}
  private isBlastLook() {
    return this.style.reference2d.tileMaterial === 'candy-blast';
  }
  private drawBlastClearFx(clearing: ClearingFrame, seconds: number): void {
    if (!this.frame || !this.style) return;
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const grid = REFERENCE_LAYOUT.board.grid;
    const outer = REFERENCE_LAYOUT.board.outer;
    const boardSpan = grid.pitch * 8 - grid.gap;
    const combo = this.frame.visualState.combo;
    const lineCount = clearing.clear.rows.length + clearing.clear.cols.length;
    const lineFlash = Math.sin(clamp01(progress / 0.55) * Math.PI);
    const sweepProgress = clamp01(progress / 0.42);
    const intensity = 1 + Math.min(1.2, combo * 0.12 + Math.max(0, lineCount - 1) * 0.3);
    const impact = Math.max(0, 1 - progress / 0.16);

    // ---- 全屏光爆(可选: screenFx 含 clear-bloom, 径向光爆 + 旋转光束, 加法) ----
    const screenFx = this.style.reference2d.screenFx;
    if (screenFx === 'clear-bloom' || screenFx === 'edge-glow+clear-bloom') {
      const bloomEnv = clamp01(progress / 0.1) * (1 - clamp01((progress - 0.55) / 0.4));
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
      roundedRect(context, outer.x, outer.y, outer.size, outer.size, outer.radius);
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
        context.fillStyle = rainbowGradient(
          context,
          grid.x - 12,
          y,
          grid.x + boardSpan + 12,
          y,
          glow * 0.85,
        );
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
        context.fillStyle = rainbowGradient(
          context,
          x,
          grid.y - 12,
          x,
          grid.y + boardSpan + 12,
          glow * 0.85,
        );
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
      roundedRect(
        context,
        grid.x - grow,
        y - grid.cell / 2 - 10,
        boardSpan + grow * 2,
        grid.cell + 20,
        16,
      );
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
        this.drawTile(
          0,
          0,
          grid.cell,
          cell.color,
          pose.alpha * (copy === 0 ? 1 : 0.7),
          pose.scale,
          copy === 0,
        );
        context.restore();
      }

      const shardCount = 4;
      for (let shard = 0; shard < shardCount; shard += 1) {
        const local = clamp01((progress - shard * 0.03) / 0.85);
        if (local <= 0) continue;
        const fly = burstTravel(local);
        const angle = seededFloat(hash32(clearing.seed + index * 17 + shard * 9), shard) * TWO_PI;
        const dist = (40 + seededFloat(hash32(clearing.seed + shard * 23), index) * 130) * fly;
        const size =
          grid.cell * (0.11 + seededFloat(hash32(clearing.seed + 3), index + shard) * 0.15);
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
        const jitterX =
          (seededFloat(hash32(clearing.seed + index * 13), index + 2) - 0.5) * grid.cell * 1.6;
        const sway = Math.sin(local * 7 + index) * 9 * local;
        const ex = grid.x + cell.col * grid.pitch + grid.cell / 2 + jitterX + sway;
        const ey =
          grid.y +
          cell.row * grid.pitch +
          grid.cell / 2 -
          local * (150 + seededFloat(hash32(clearing.seed + index), index) * 130);
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
    const combo = this.frame.visualState.combo;
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
          const py =
            originY +
            (gy + 0.5) * (grid.cell / 3) +
            Math.sin(angle) * speed * fly +
            local * local * 170;
          const alpha = 1 - clamp01((local - 0.55) / 0.45);
          if (alpha <= 0.02) continue;
          context.save();
          context.globalAlpha = alpha;
          context.fillStyle = gy === 0 ? palette.top : gy === 2 ? palette.bottom : palette.base;
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
      context.rect(
        x - grid.cell / 2 - 2,
        y - grid.cell / 2 - gap - 2,
        grid.cell + 4,
        grid.cell / 2,
      );
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
          const jitter =
            (seededFloat(hash32(clearing.seed + i * 13 + row * 7 + phase * 3), i) - 0.5) *
            26 *
            arcA;
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
          const jitter =
            (seededFloat(hash32(clearing.seed + i * 13 + col * 7 + phase * 3), i) - 0.5) *
            26 *
            arcA;
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
    const combo = this.frame.visualState.combo;
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
      const jitterX =
        (seededFloat(hash32(clearing.seed + index * 13), index + 2) - 0.5) * grid.cell * 1.5;
      const sway = Math.sin(local * 7 + index) * 10 * local;
      const ex = grid.x + cell.col * grid.pitch + grid.cell / 2 + jitterX + sway;
      const ey =
        grid.y +
        cell.row * grid.pitch +
        grid.cell / 2 -
        local * (170 + seededFloat(hash32(clearing.seed + index), index) * 150);
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
      const ex =
        grid.x +
        cell.col * grid.pitch +
        grid.cell / 2 +
        (seededFloat(hash32(clearing.seed + index), index) - 0.5) * 40;
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
      this.drawTile(
        centers[index]!.x,
        centers[index]!.y,
        grid.cell,
        cell.color,
        alpha,
        0.65 + pop * 0.45,
        false,
      );
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
    const links = Math.max(
      0,
      Math.min(centers.length - 1, Math.floor(centers.length * boltProgress)),
    );
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
        const nx =
          a.x +
          (b.x - a.x) * t +
          (seededFloat(hash32(clearing.seed + i * 31 + s * 7), s) - 0.5) * 30;
        const ny =
          a.y +
          (b.y - a.y) * t +
          (seededFloat(hash32(clearing.seed + i * 31 + s * 11), s + 2) - 0.5) * 30;
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
      const dist =
        (30 + seededFloat(hash32(clearing.seed + index * 41), index + 3) * 160) *
        burstTravel(local);
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
      const distance =
        (24 + seededFloat(hash32(clearing.seed + index * 41), index + 3) * 220) *
        burstTravel(local);
      const x = grid.x + cell.col * grid.pitch + grid.cell / 2 + Math.cos(angle) * distance;
      const y =
        grid.y + cell.row * grid.pitch + grid.cell / 2 + Math.sin(angle) * distance - local * 50;
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
    const pop = this.frame.visualState.combo >= 2 ? 9 : 5;
    for (const [index, cell] of clearing.clear.cells.entries()) {
      const start = (index % 8) * 0.03;
      const local = clamp01((progress - 0.08 - start) / 0.55);
      if (local <= 0 || local >= 1) continue;
      const x = grid.x + cell.col * grid.pitch + grid.cell / 2;
      const y = grid.y + cell.row * grid.pitch + grid.cell / 2 - local * 54;
      context.save();
      context.globalAlpha = Math.sin(local * Math.PI);
      context.translate(x, y);
      context.scale(
        0.82 + easeOutBack(Math.min(1, local * 1.6)) * 0.4,
        0.82 + easeOutBack(Math.min(1, local * 1.6)) * 0.4,
      );
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

  drawClearFx(clearing: ClearingFrame, seconds: number): void {
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
        context.scale(
          0.75 + easeOutBack(Math.min(1, local * 2)) * 0.32,
          0.75 + easeOutBack(Math.min(1, local * 2)) * 0.32,
        );
        if (index % 4 === 0) paintThumb(this.ctx, 0, -2, 0.62);
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

  private drawSparkCloud(clearing: ClearingFrame, seconds: number): void {
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const seed = clearing.seed;
    const center = clearing.clear.cells.reduce(
      (sum, cell) => ({ x: sum.x + cell.col, y: sum.y + cell.row }),
      { x: 0, y: 0 },
    );
    const count = Math.max(1, clearing.clear.cells.length);
    const cx =
      REFERENCE_LAYOUT.board.grid.x +
      (center.x / count) * REFERENCE_LAYOUT.board.grid.pitch +
      REFERENCE_LAYOUT.board.grid.cell / 2;
    const cy =
      REFERENCE_LAYOUT.board.grid.y +
      (center.y / count) * REFERENCE_LAYOUT.board.grid.pitch +
      REFERENCE_LAYOUT.board.grid.cell / 2;
    for (let index = 0; index < Math.min(72, clearing.clear.cells.length * 3); index += 1) {
      const angle = seededFloat(hash32(seed + index * 31), index + 7) * TWO_PI;
      const distance =
        (30 + seededFloat(hash32(seed + index * 41), index + 3) * 360) * easeOutCubic(progress);
      const x = cx + Math.cos(angle) * distance;
      const y = cy + Math.sin(angle) * distance - progress * 35;
      const alpha = Math.sin(progress * Math.PI) * (0.35 + seededFloat(seed, index + 14) * 0.6);
      const size = 3 + seededFloat(seed + 19, index) * 8;
      context.save();
      context.translate(x, y);
      context.rotate(angle + seconds);
      context.globalAlpha = alpha;
      context.fillStyle =
        index % 4 === 0
          ? '#fff46d'
          : index % 4 === 1
            ? '#ff78b7'
            : index % 4 === 2
              ? '#6df2ef'
              : '#ffffff';
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
    const combo = this.frame.visualState.combo;
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
    praiseLabel[tier] = praiseWordLabel(
      resolvePraiseWord(combo, lineCount, this.style?.reference2d.praiseWords),
    );
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

  drawPraise(clearing: ClearingFrame, seconds: number): void {
    if (!this.frame) return;
    if (this.isBlastLook()) {
      this.drawBlastPraise(clearing, seconds);
      return;
    }
    const context = this.ctx;
    const progress = clamp01(clearing.progress);
    const lineCount = clearing.clear.rows.length + clearing.clear.cols.length;
    const combo = this.frame.visualState.combo;
    // The six labels are observed across the full recording. Their exact
    // trigger thresholds remain unresolved, so this selector is explicitly a
    // prototype display heuristic rather than a reference rule claim.
    const tier: PraiseTierId =
      lineCount >= 4 || clearing.clear.cells.length >= 28 || combo >= 8
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
      context.strokeStyle =
        tier === 'nice'
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
}
