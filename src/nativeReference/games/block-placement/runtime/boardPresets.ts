import { BOARD_SIZE, type BoardState, type TileColor } from '../../../domain/types';
import { TILE_COLORS } from './shapes';
import { hash32, seededInt } from '../../../domain/rng';

export function createEmptyBoard(): BoardState {
  return { rows: BOARD_SIZE, cols: BOARD_SIZE, cells: Array.from({ length: BOARD_SIZE }, () => Array<TileColor | null>(BOARD_SIZE).fill(null)) };
}

export function cloneBoard(board: BoardState): BoardState {
  return { rows: board.rows, cols: board.cols, cells: board.cells.map((row) => [...row]) };
}

/**
 * 聚集着色: 把已占用格按「块形足迹」铺成单色片。
 * 原广告视频的棋盘是玩家用单色块堆出来的, 相邻格同色成片;
 * 逐格随机配色(如 (row*3+col)%7 斜彩虹)一眼假。本函数用贪心足迹平铺复现聚集结构。
 * 同一 seed 结果可复现。输入棋盘若含满行/满列(开局即非法)会直接抛错。
 */
export function clusterColorizeBoard(board: BoardState, seed: number): BoardState {
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    if (board.cells[row]?.every(Boolean)) {
      throw new Error(`clusterColorizeBoard: row ${row} is complete; opening boards must not contain full lines.`);
    }
  }
  for (let col = 0; col < BOARD_SIZE; col += 1) {
    let full = true;
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      if (!board.cells[row]?.[col]) { full = false; break; }
    }
    if (full) {
      throw new Error(`clusterColorizeBoard: col ${col} is complete; opening boards must not contain full lines.`);
    }
  }
  const FOOTPRINTS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [0, 2]],
    [[0, 0], [1, 0], [2, 0]],
    [[0, 0], [0, 1], [1, 1]],
    [[0, 0], [0, 1], [1, 0]],
    [[0, 0], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [0, 2], [0, 3]],
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [0, 1]],
    [[0, 0], [1, 0]],
    [[0, 0]],
  ];
  const result = cloneBoard(board);
  const remaining = new Set<string>();
  for (let row = 0; row < result.rows; row += 1) {
    for (let col = 0; col < result.cols; col += 1) {
      if (result.cells[row]?.[col]) remaining.add(`${row},${col}`);
    }
  }
  let clusterIndex = 0;
  let previousColor: TileColor | null = null;
  while (remaining.size > 0) {
    // 候选: 所有「完全落在 remaining 内」的足迹放置
    const candidates: Array<{ cells: string[]; size: number }> = [];
    for (const key of remaining) {
      const [row, col] = key.split(',').map(Number) as [number, number];
      for (const footprint of FOOTPRINTS) {
        for (const [fr, fc] of footprint) {
          const cells = footprint.map(([r, c]) => `${row + r - fr},${col + c - fc}`);
          if (cells.every((cell) => remaining.has(cell))) {
            candidates.push({ cells, size: footprint.length });
          }
        }
      }
    }
    if (candidates.length === 0) {
      // 理论不可达(单格足迹恒可选), 兜底
      const key = remaining.values().next().value as string;
      candidates.push({ cells: [key], size: 1 });
    }
    // 优先大片: 只在前两大尺寸档里随机, 复刻原视频的大色块
    const maxSize = Math.max(...candidates.map((item) => item.size));
    const pool = candidates.filter((item) => item.size >= Math.max(1, maxSize - 1));
    const picked = pool[seededInt(hash32(seed + clusterIndex * 733), clusterIndex * 37 + 3, pool.length)]!;
    let color = TILE_COLORS[seededInt(hash32(seed + clusterIndex * 991), clusterIndex * 53 + 7, TILE_COLORS.length)] ?? 'blue';
    // 与上一片同色时 60% 重抽(允许偶尔连续同色, 但不连环)
    if (color === previousColor && seededInt(hash32(seed + clusterIndex * 379), clusterIndex * 11 + 5, 5) < 3) {
      const offset = 1 + seededInt(hash32(seed + clusterIndex * 461), clusterIndex * 13 + 9, TILE_COLORS.length - 1);
      color = TILE_COLORS[(TILE_COLORS.indexOf(color) + offset) % TILE_COLORS.length] ?? 'blue';
    }
    previousColor = color;
    for (const cellKey of picked.cells) {
      const [row, col] = cellKey.split(',').map(Number) as [number, number];
      const line = result.cells[row];
      if (line) line[col] = color;
      remaining.delete(cellKey);
    }
    clusterIndex += 1;
  }
  return result;
}

function fill(board: BoardState, row: number, cols: number[], color: TileColor): void {
  for (const col of cols) {
    const line = board.cells[row];
    if (line) line[col] = color;
  }
}

export function createShowcaseBoard(): BoardState {
  const board = createEmptyBoard();
  fill(board, 2, [0, 1, 2, 4, 5, 6], 'violet');
  fill(board, 3, [0, 1, 2, 3, 4, 6, 7], 'cyan');
  fill(board, 4, [0, 1, 3, 4, 5, 6, 7], 'blue');
  fill(board, 5, [0, 2, 3, 4, 5, 7], 'lime');
  fill(board, 6, [0, 1, 2, 4, 5, 6], 'amber');
  fill(board, 7, [0, 1, 3, 4, 6, 7], 'coral');
  return clusterColorizeBoard(board, 9021);
}

export function createCrossClearBoard(): BoardState {
  const board = createEmptyBoard();
  for (let col = 0; col < BOARD_SIZE; col += 1) if (col !== 4) {
    const line = board.cells[5];
    if (line) line[col] = TILE_COLORS[col % TILE_COLORS.length] ?? 'blue';
  }
  for (let row = 0; row < BOARD_SIZE; row += 1) if (row !== 5) {
    const line = board.cells[row];
    if (line) line[4] = TILE_COLORS[(row + 2) % TILE_COLORS.length] ?? 'blue';
  }
  fill(board, 7, [0, 1, 6, 7], 'blue');
  return clusterColorizeBoard(board, 4177);
}

/**
 * 三线爆发级联开局: 两组各三行只缺一个竖向格。
 * 供给中的 tri-v 可以连续完成两次三线消除；底部保持空区，避免开局列已满。
 */
export function createTripleCascadeBoard(seed = 4177): BoardState {
  const board = createEmptyBoard();
  const groups: ReadonlyArray<{ rows: number[]; missingCol: number }> = [
    { rows: [0, 1, 2], missingCol: 1 },
    { rows: [3, 4, 5], missingCol: 6 },
  ];
  for (const group of groups) {
    for (const row of group.rows) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        if (col === group.missingCol) continue;
        const line = board.cells[row];
        if (line) line[col] = TILE_COLORS[(row * 5 + col + seed) % TILE_COLORS.length] ?? 'blue';
      }
    }
  }
  return clusterColorizeBoard(board, seed);
}

export function createDenseRescueBoard(): BoardState {
  const board = createEmptyBoard();
  for (let row = 1; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const open = (row === 1 && col >= 4) || (row === 3 && col <= 2) || (row === 6 && col >= 5);
      if (!open && (row + col) % 4 !== 0) {
        const line = board.cells[row];
        if (line) line[col] = TILE_COLORS[(row * 3 + col) % TILE_COLORS.length] ?? 'blue';
      }
    }
  }
  return clusterColorizeBoard(board, 6133);
}

/** 梯田: 左低右高的阶梯堆积, 右侧留大斜坡操作面。 */
export function createTerracesBoard(): BoardState {
  const board = createEmptyBoard();
  // 注意: 任何行/列都不可满 8 格(满线开局即非法)
  const heights = [5, 4, 4, 3, 3, 2, 1, 0];
  for (let col = 0; col < BOARD_SIZE; col += 1) {
    for (let h = 0; h < (heights[col] ?? 0); h += 1) {
      const row = BOARD_SIZE - 1 - h;
      const line = board.cells[row];
      if (line) line[col] = TILE_COLORS[(row + col) % TILE_COLORS.length] ?? 'blue';
    }
  }
  return clusterColorizeBoard(board, 8813);
}

/** 四角围堵: 四角 2x2 团块 + 中心十字留空, 天然双线交叉消点。 */
export function createCornersTrapBoard(): BoardState {
  const board = createEmptyBoard();
  const blobs: ReadonlyArray<readonly [number, number]> = [
    [0, 0], [0, 1], [1, 0], [1, 1],
    [0, 6], [0, 7], [1, 6], [1, 7],
    [6, 0], [6, 1], [7, 0], [7, 1],
    [6, 6], [6, 7], [7, 6], [7, 7],
    [3, 0], [4, 0], [0, 3], [0, 4], [7, 3], [7, 4], [3, 7], [4, 7],
  ];
  for (const [row, col] of blobs) {
    const line = board.cells[row];
    if (line) line[col] = TILE_COLORS[(row * 5 + col) % TILE_COLORS.length] ?? 'blue';
  }
  return clusterColorizeBoard(board, 2977);
}

/** 双塔夹谷: 左右两座高塔, 中央深谷, 竖列消除高发。 */
export function createTwinTowersBoard(): BoardState {
  const board = createEmptyBoard();
  for (let row = 2; row < BOARD_SIZE; row += 1) {
    for (const col of [0, 1, 6, 7]) {
      const line = board.cells[row];
      if (line) line[col] = TILE_COLORS[(row * 3 + col * 2) % TILE_COLORS.length] ?? 'blue';
    }
  }
  for (const col of [0, 1, 2, 5, 6, 7]) {
    const line = board.cells[7];
    if (line) line[col] = TILE_COLORS[(col + 3) % TILE_COLORS.length] ?? 'blue';
  }
  const waist = board.cells[1];
  if (waist) {
    waist[0] = TILE_COLORS[2] ?? 'blue';
    waist[7] = TILE_COLORS[5] ?? 'blue';
  }
  return clusterColorizeBoard(board, 5309);
}

function paintMask(mask: ReadonlyArray<readonly [number, number]>, seed: number): BoardState {
  const board = createEmptyBoard();
  for (const [row, col] of mask) {
    const line = board.cells[row];
    if (line) line[col] = TILE_COLORS[(row * 7 + col * 3) % TILE_COLORS.length] ?? 'blue';
  }
  return clusterColorizeBoard(board, seed);
}

/** 爱心: 心形团块(30 格), 上方开阔, 掉落空间大。第 2/3 行交错缺口, 避免开局满线。 */
export function createHeartBoard(): BoardState {
  const mask: Array<readonly [number, number]> = [];
  for (const col of [1, 2, 5, 6]) mask.push([1, col]);
  for (const col of [0, 1, 2, 4, 5, 6, 7]) mask.push([2, col]);
  for (const col of [0, 1, 2, 3, 5, 6, 7]) mask.push([3, col]);
  for (let col = 1; col <= 6; col += 1) mask.push([4, col]);
  for (let col = 2; col <= 5; col += 1) mask.push([5, col]);
  mask.push([6, 3], [6, 4]);
  return paintMask(mask, 7717);
}

/** 甜甜圈: 圆环(20 格), 中央空洞是天然填坑位。 */
export function createDonutBoard(): BoardState {
  const mask: Array<readonly [number, number]> = [];
  for (const col of [2, 3, 4, 5]) { mask.push([1, col]); mask.push([6, col]); }
  for (const [r, c] of [[2, 1], [2, 2], [2, 5], [2, 6], [3, 1], [3, 6], [4, 1], [4, 6], [5, 1], [5, 2], [5, 5], [5, 6]] as const) {
    mask.push([r, c]);
  }
  return paintMask(mask, 3301);
}

/** 星星: 五角星近似(24 格), 散点结构带来多样局部消除。 */
export function createStarBoard(): BoardState {
  const mask: Array<readonly [number, number]> = [
    [0, 3], [1, 3],
    [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6],
    [3, 2], [3, 3], [3, 4], [3, 5],
    [4, 2], [4, 3], [4, 4], [4, 5],
    [5, 1], [5, 2], [5, 5], [5, 6],
    [6, 0], [6, 1], [6, 6], [6, 7],
  ];
  return paintMask(mask, 6653);
}

/** 笑脸: 双眼+鼻子+嘴巴+酒窝(14 格), 低占用高连消潜力。 */
export function createSmileBoard(): BoardState {
  const mask: Array<readonly [number, number]> = [
    [1, 2], [1, 5], [2, 2], [2, 5],
    [3, 3], [3, 4],
    [3, 0], [3, 7],
    [4, 1], [4, 6],
    [5, 2], [5, 3], [5, 4], [5, 5],
  ];
  return paintMask(mask, 9461);
}

/** 闪电: 斜向折线(17 格), 引导 Z 字形连续消除。 */
export function createLightningBoard(): BoardState {
  const mask: Array<readonly [number, number]> = [
    [0, 5],
    [1, 4], [1, 5],
    [2, 3], [2, 4],
    [3, 2], [3, 3], [3, 4], [3, 5], [3, 6],
    [4, 4], [4, 5],
    [5, 3], [5, 4],
    [6, 2], [6, 3],
    [7, 2],
  ];
  return paintMask(mask, 5519);
}

/** 钻石: 菱形环(14 格), 内外皆开阔, 长线消除潜力大。 */
export function createDiamondBoard(): BoardState {
  const mask: Array<readonly [number, number]> = [
    [1, 3], [1, 4],
    [2, 2], [2, 5],
    [3, 1], [3, 6],
    [4, 0], [4, 7],
    [5, 1], [5, 6],
    [6, 2], [6, 5],
    [7, 3], [7, 4],
  ];
  return paintMask(mask, 7751);
}

export const BOARD_PRESETS = [
  { id: 'showcase', label: '展示局', create: createShowcaseBoard },
  { id: 'cross-clear', label: '横纵双消', create: createCrossClearBoard },
  { id: 'triple-cascade', label: '三线级联', create: createTripleCascadeBoard },
  { id: 'dense-rescue', label: '险境救场', create: createDenseRescueBoard },
  { id: 'terraces', label: '梯田', create: createTerracesBoard },
  { id: 'corners-trap', label: '四角围堵', create: createCornersTrapBoard },
  { id: 'twin-towers', label: '双塔夹谷', create: createTwinTowersBoard },
  { id: 'heart', label: '爱心', create: createHeartBoard },
  { id: 'donut', label: '甜甜圈', create: createDonutBoard },
  { id: 'star', label: '星星', create: createStarBoard },
  { id: 'smile', label: '笑脸', create: createSmileBoard },
  { id: 'lightning', label: '闪电', create: createLightningBoard },
  { id: 'diamond', label: '钻石', create: createDiamondBoard },
  { id: 'empty', label: '空棋盘', create: createEmptyBoard },
] as const;
