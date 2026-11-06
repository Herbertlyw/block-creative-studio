import type { ReferenceCalibration } from './parseCalibration';
import type { BBTimelineFrame } from '../planning/bbTimelinePlan';
import type { createBBTileLayer } from '../rendering/tileLayer';
import { drawSelectionGlow } from './selectionGlow';
import { paintGhostCells } from '../rendering/ghostLayer';
import { measuredCellColor } from '../../../nativeReference/games/block-placement/presentation/referenceAppearance';

type Tile = ReturnType<typeof createBBTileLayer>;
/** Paint sampled drag, ghost and independent preview without evaluating a second Take. */
export function paintObservedPieces(
  ctx: CanvasRenderingContext2D,
  spec: ReferenceCalibration,
  frame: BBTimelineFrame,
  materialFaceColors: string[],
  sourceTime: number,
  { tile, shape, pieceCell }: Tile,
): void {
  const { x: gx, y: gy, pitch, rows: boardRows, cols: boardCols } = frame.geometry.board,
    boardSize = boardRows,
    t = frame.timeSeconds;
  const { drag } = frame,
    previewDrag = frame.preview?.event ?? null,
    previewPose = frame.preview?.pose ?? null;
  const step = frame.activeRender?.step,
    timing = frame.activeRender?.timing,
    surface = frame.boardSurface,
    surfaceActive = surface !== null;
  if (step && timing && t < timing.release) {
    if (!drag) throw new Error('CALIBRATED_FRAME_DRAG_MISSING');
    const cells = drag.cells,
      rows = Math.max(...cells.map((c) => c[0])) + 1,
      cols = Math.max(...cells.map((c) => c[1])) + 1;
    const { x, y, size } = drag.pose;
    const projected = spec.appearance?.landingPreview;
    if (!frame.ghost) throw new Error('CALIBRATED_FRAME_DRAG_PREVIEW_MISSING');
    const preview = frame.ghost.anchor;
    if (preview)
      paintGhostCells(frame.ghost, cells, (_r, _c, localRow, localCol) =>
        pieceCell(
          gx + preview.col * pitch + localCol * pitch,
          gy + preview.row * pitch + localRow * pitch,
          pitch,
          drag.color,
          sourceTime,
          localRow,
          localCol,
          projected?.opacity ?? 0.2,
        ),
      );
    const linePreview = timing.linePreview ?? spec.appearance?.linePreview;
    const prospective = frame.ghost.lines;
    const previewColors = [
      '#ba5be9',
      '#876bea',
      '#3f88e6',
      '#24bfd6',
      '#57cc31',
      '#cdd333',
      '#edb926',
      '#ef7937',
    ];
    if (prospective && (prospective.rows.length || prospective.cols.length)) {
      if (!linePreview) throw new Error('REFERENCE_LINE_PREVIEW_MISSING');
      const same = linePreview === 'piece' || linePreview === 'piece-glow',
        outline = linePreview.endsWith('-outline'),
        face =
          timing.clearFace !== undefined
            ? `observed-face:${timing.clearFace}`
            : (Object.values(step.placedColors ?? {})[0] as string);
      for (let r = 0; r < boardRows; r++)
        for (let c = 0; c < boardCols; c++) {
          if (!prospective.rows.includes(r) && !prospective.cols.includes(c)) continue;
          const index = prospective.rows.includes(r) ? c : r;
          if (!outline)
            tile(
              gx + c * pitch,
              gy + r * pitch,
              pitch,
              surfaceActive && surface.dragPreview
                ? `observed-face:${surface.faces[r][c]}`
                : same
                  ? face
                  : 'white',
              sourceTime,
              1,
              surfaceActive && surface.dragPreview
                ? undefined
                : same
                  ? undefined
                  : previewColors[index],
            );
        }
      if (
        linePreview === 'spectrum-outline' ||
        linePreview === 'piece-outline' ||
        linePreview === 'piece-glow'
      ) {
        ctx.save();
        for (let r = 0; r < boardRows; r++)
          for (let c = 0; c < boardCols; c++) {
            if (!prospective.rows.includes(r) && !prospective.cols.includes(c)) continue;
            const color =
              linePreview === 'spectrum-outline'
                ? previewColors[prospective.rows.includes(r) ? c : r]
                : linePreview === 'piece-glow'
                  ? (materialFaceColors[Number(face.split(':')[1])] ?? '#effcff')
                  : '#72dfff';
            ctx.strokeStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 24;
            ctx.lineWidth = 6;
            ctx.strokeRect(gx + c * pitch + 2, gy + r * pitch + 2, pitch - 4, pitch - 4);
            ctx.strokeStyle = '#f0fcff';
            ctx.shadowBlur = 9;
            ctx.lineWidth = 2;
            ctx.strokeRect(gx + c * pitch + 2, gy + r * pitch + 2, pitch - 4, pitch - 4);
          }
        ctx.restore();
      } else {
        ctx.save();
        ctx.strokeStyle = outline ? '#fff274' : same ? '#fff3e1' : '#f4b5ff';
        ctx.lineWidth = 4;
        ctx.shadowBlur = 22;
        ctx.shadowColor = outline
          ? '#ffcb30'
          : same
            ? (materialFaceColors[Number(face.split(':')[1])] ?? '#effcff')
            : '#e752f7';
        for (const r of prospective.rows)
          ctx.strokeRect(gx, gy + r * pitch, pitch * boardSize, pitch);
        for (const c of prospective.cols)
          ctx.strokeRect(gx + c * pitch, gy, pitch, pitch * boardSize);
        ctx.restore();
      }
    }

    const selection = frame.selectionGlow?.config,
      selectionAmount = frame.selectionGlow?.amount ?? 0;
    if (selection) drawSelectionGlow(ctx, cells, x, y, size, selection, selectionAmount, 'halo');
    ctx.save();
    ctx.shadowColor = '#17203550';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 8;
    if (
      surfaceActive &&
      surface.dragPreview &&
      y + (rows * size) / 2 < gy + pitch * boardSize &&
      y + rows * size > gy
    ) {
      const ar = Math.max(0, Math.min(boardRows - rows, Math.round((y - gy) / pitch))),
        ac = Math.max(0, Math.min(boardCols - cols, Math.round((x - gx) / pitch)));
      for (const [r, c] of cells)
        tile(
          x + c * size,
          y + r * size,
          size,
          `observed-face:${surface.faces[ar + r][ac + c]}`,
          sourceTime,
        );
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = '#fff8ef';
      ctx.lineWidth = 3;
      ctx.beginPath();
      const occupied = new Set(cells.map(([r, c]) => `${r},${c}`));
      for (const [r, c] of cells) {
        const xx = x + c * size,
          yy = y + r * size;
        if (!occupied.has(`${r - 1},${c}`)) {
          ctx.moveTo(xx, yy);
          ctx.lineTo(xx + size, yy);
        }
        if (!occupied.has(`${r + 1},${c}`)) {
          ctx.moveTo(xx, yy + size);
          ctx.lineTo(xx + size, yy + size);
        }
        if (!occupied.has(`${r},${c - 1}`)) {
          ctx.moveTo(xx, yy);
          ctx.lineTo(xx, yy + size);
        }
        if (!occupied.has(`${r},${c + 1}`)) {
          ctx.moveTo(xx + size, yy);
          ctx.lineTo(xx + size, yy + size);
        }
      }
      ctx.stroke();
    } else if (
      preview &&
      prospective &&
      linePreview === 'spectrum' &&
      (prospective.rows.length || prospective.cols.length)
    ) {
      for (const [r, c] of cells) {
        const row = preview.row + r,
          col = preview.col + c,
          index = prospective.rows.includes(row) ? col : row;
        tile(
          x + c * size,
          y + r * size,
          size,
          measuredCellColor(spec.appearance, drag.color, r, c),
          sourceTime,
          1,
          prospective.rows.includes(row) || prospective.cols.includes(col)
            ? previewColors[index]
            : undefined,
        );
      }
    } else shape(cells, x, y, size, drag.color, sourceTime);
    ctx.restore();
    if (selection) drawSelectionGlow(ctx, cells, x, y, size, selection, selectionAmount, 'edge');
  }
  // Native supply determines which pieces remain, while calibrated slots preserve the source layout.

  if (previewDrag) {
    const piece = frame.preview?.piece;
    if (!piece || piece.id !== previewDrag.pieceId)
      throw new Error('CALIBRATED_FRAME_PREVIEW_PIECE_MISSING');
    const cells = piece.cells;
    if (!previewPose) throw new Error('CALIBRATED_FRAME_PREVIEW_POSE_MISSING');
    const pose = previewPose,
      projected = spec.appearance?.landingPreview;
    const anchor = frame.preview?.anchor ?? null;
    if (anchor)
      shape(
        cells,
        gx + anchor.col * pitch,
        gy + anchor.row * pitch,
        pitch,
        piece.color,
        sourceTime,
        projected?.opacity ?? 0.2,
      );
    const selection = frame.previewSelectionGlow?.config,
      amount = frame.previewSelectionGlow?.amount ?? 0;
    if (selection)
      drawSelectionGlow(ctx, cells, pose.x, pose.y, pose.size, selection, amount, 'halo');
    ctx.save();
    ctx.shadowColor = '#17203550';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 8;
    shape(cells, pose.x, pose.y, pose.size, piece.color, sourceTime);
    ctx.restore();
    if (selection)
      drawSelectionGlow(ctx, cells, pose.x, pose.y, pose.size, selection, amount, 'edge');
  }
}
