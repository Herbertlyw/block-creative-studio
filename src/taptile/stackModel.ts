export const STACK_STAGE = {
  width: 430,
  height: 764,
  tileSize: 68,
} as const;

export type StackTemplateId = 'hourglass' | 't-shape' | 'terraces' | 'free';
export type TileMaterialId = 'porcelain' | 'ice' | 'jelly' | 'paper';
export type SceneThemeId = 'deep-ocean' | 'sunset' | 'candy' | 'forest';

export interface FaceOption {
  id: string;
  label: string;
  glyph: string;
  accent: string;
}

export interface StackTile {
  id: string;
  x: number;
  y: number;
  layer: number;
  rotation: number;
  scale: number;
  faceId: string;
  locked: boolean;
}

export interface TapTileStackProject {
  format: 'taptile-stack-studio';
  version: '0.1.0';
  name: string;
  templateId: StackTemplateId;
  material: TileMaterialId;
  theme: SceneThemeId;
  snap: boolean;
  showLayerBadges: boolean;
  tiles: StackTile[];
  updatedAt: string;
}

export const FACE_LIBRARY: FaceOption[] = [
  { id: 'bear', label: '小熊', glyph: '🧸', accent: '#f6a648' },
  { id: 'gift', label: '礼盒', glyph: '🎁', accent: '#25a8ef' },
  { id: 'shoe', label: '球鞋', glyph: '👟', accent: '#8a62ee' },
  { id: 'clock', label: '闹钟', glyph: '⏰', accent: '#6ec8ff' },
  { id: 'plant', label: '盆栽', glyph: '🪴', accent: '#63ca62' },
  { id: 'book', label: '红书', glyph: '📕', accent: '#ef5c55' },
  { id: 'bird', label: '鹦鹉', glyph: '🦜', accent: '#7fc64c' },
  { id: 'camera', label: '相机', glyph: '📷', accent: '#f5bd36' },
  { id: 'hammer', label: '锤子', glyph: '🔨', accent: '#ed8540' },
  { id: 'wrench', label: '扳手', glyph: '🔧', accent: '#4ba8e5' },
  { id: 'glove', label: '手套', glyph: '🧤', accent: '#f0a55c' },
  { id: 'flower', label: '花朵', glyph: '🌼', accent: '#f07fb4' },
  { id: 'donut', label: '甜甜圈', glyph: '🍩', accent: '#e68a65' },
  { id: 'mushroom', label: '蘑菇', glyph: '🍄', accent: '#ee695f' },
  { id: 'star', label: '星星', glyph: '⭐', accent: '#ffc946' },
  { id: 'sponge', label: '海绵', glyph: '🧽', accent: '#efc432' },
];

export const TEMPLATE_OPTIONS: Array<{ id: StackTemplateId; label: string; hint: string }> = [
  { id: 'hourglass', label: '沙漏', hint: '双三角收腰结构' },
  { id: 't-shape', label: 'T 型', hint: '宽顶、长柄、宽底' },
  { id: 'terraces', label: '阶梯', hint: '多段平台与隐藏层' },
  { id: 'free', label: '自由', hint: '从轻量散点开始' },
];

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

function faceFor(index: number): string {
  return FACE_LIBRARY[index % FACE_LIBRARY.length]?.id ?? 'bear';
}

function templateTile(
  template: StackTemplateId,
  index: number,
  x: number,
  y: number,
  layer: number,
): StackTile {
  return {
    id: `${template}-${index + 1}`,
    x,
    y,
    layer,
    rotation: 0,
    scale: 1,
    faceId: faceFor(index),
    locked: false,
  };
}

function pushCenteredRow(
  target: StackTile[],
  template: StackTemplateId,
  count: number,
  y: number,
  layer: number,
  gap = 57,
  centerX = STACK_STAGE.width / 2,
): void {
  const startX = centerX - ((count - 1) * gap) / 2;
  for (let column = 0; column < count; column += 1) {
    target.push(templateTile(template, target.length, startX + column * gap, y, layer));
  }
}

function hourglassTiles(): StackTile[] {
  const tiles: StackTile[] = [];
  const widths = [6, 5, 4, 3, 2, 2, 3, 4, 5, 6];
  widths.forEach((count, row) => {
    pushCenteredRow(tiles, 'hourglass', count, 178 + row * 51, row % 3, 58);
  });
  pushCenteredRow(tiles, 'hourglass', 3, 320, 4, 54);
  pushCenteredRow(tiles, 'hourglass', 3, 523, 4, 54);
  return tiles;
}

function tShapeTiles(): StackTile[] {
  const tiles: StackTile[] = [];
  pushCenteredRow(tiles, 't-shape', 6, 180, 0, 58);
  pushCenteredRow(tiles, 't-shape', 6, 229, 1, 58, STACK_STAGE.width / 2 + 7);
  pushCenteredRow(tiles, 't-shape', 5, 278, 2, 58);
  for (let row = 0; row < 5; row += 1) {
    pushCenteredRow(tiles, 't-shape', 2, 327 + row * 49, 1 + (row % 3), 56);
  }
  pushCenteredRow(tiles, 't-shape', 5, 574, 0, 58);
  pushCenteredRow(tiles, 't-shape', 6, 623, 1, 58);
  pushCenteredRow(tiles, 't-shape', 6, 672, 2, 58, STACK_STAGE.width / 2 - 5);
  return tiles;
}

function terraceTiles(): StackTile[] {
  const tiles: StackTile[] = [];
  for (let row = 0; row < 4; row += 1) {
    pushCenteredRow(tiles, 'terraces', 6, 180 + row * 48, row, 58, STACK_STAGE.width / 2 + (row % 2 ? 8 : -8));
  }
  for (let row = 0; row < 4; row += 1) {
    pushCenteredRow(tiles, 'terraces', 5, 430 + row * 48, row % 3, 62, STACK_STAGE.width / 2 + (row % 2 ? -10 : 10));
  }
  pushCenteredRow(tiles, 'terraces', 6, 650, 1, 59);
  return tiles;
}

function freeTiles(): StackTile[] {
  const points = [
    [144, 235, 0], [216, 235, 0], [288, 235, 0],
    [177, 302, 1], [249, 302, 1],
    [126, 377, 0], [198, 377, 2], [270, 377, 0],
    [162, 455, 1], [234, 455, 3], [306, 455, 1],
    [126, 535, 0], [198, 535, 2], [270, 535, 0],
  ] as const;
  return points.map(([x, y, layer], index) => templateTile('free', index, x, y, layer));
}

export function makeTemplateProject(templateId: StackTemplateId): TapTileStackProject {
  const tiles = templateId === 'hourglass'
    ? hourglassTiles()
    : templateId === 't-shape'
      ? tShapeTiles()
      : templateId === 'terraces'
        ? terraceTiles()
        : freeTiles();
  return {
    format: 'taptile-stack-studio',
    version: '0.1.0',
    name: 'TapTile · 手工堆叠草稿',
    templateId,
    material: 'porcelain',
    theme: 'deep-ocean',
    snap: true,
    showLayerBadges: false,
    tiles,
    updatedAt: new Date().toISOString(),
  };
}

export function nextTileId(project: TapTileStackProject): string {
  const stamp = Date.now().toString(36);
  let suffix = project.tiles.length + 1;
  let candidate = `tile-${stamp}-${suffix}`;
  const ids = new Set(project.tiles.map((tile) => tile.id));
  while (ids.has(candidate)) {
    suffix += 1;
    candidate = `tile-${stamp}-${suffix}`;
  }
  return candidate;
}

export function maxLayer(tiles: StackTile[]): number {
  return tiles.reduce((maximum, tile) => Math.max(maximum, tile.layer), 0);
}

export function normalizeTile(tile: StackTile): StackTile {
  const normalizedLayer = Number.isFinite(tile.layer) ? Math.round(tile.layer) : 0;
  return {
    ...tile,
    x: clamp(tile.x, 18, STACK_STAGE.width - 18),
    y: clamp(tile.y, 142, STACK_STAGE.height - 26),
    layer: Math.max(0, normalizedLayer),
    rotation: clamp(tile.rotation, -45, 45),
    scale: clamp(tile.scale, 0.55, 1.65),
  };
}

export function estimateOverlapPairs(tiles: StackTile[]): number {
  let count = 0;
  for (let leftIndex = 0; leftIndex < tiles.length; leftIndex += 1) {
    const left = tiles[leftIndex];
    if (!left) continue;
    const leftRadius = (STACK_STAGE.tileSize * left.scale) / 2;
    for (let rightIndex = leftIndex + 1; rightIndex < tiles.length; rightIndex += 1) {
      const right = tiles[rightIndex];
      if (!right || left.layer === right.layer) continue;
      const rightRadius = (STACK_STAGE.tileSize * right.scale) / 2;
      const overlapX = Math.abs(left.x - right.x) < (leftRadius + rightRadius) * 0.82;
      const overlapY = Math.abs(left.y - right.y) < (leftRadius + rightRadius) * 0.82;
      if (overlapX && overlapY) count += 1;
    }
  }
  return count;
}

export function isStackProject(value: unknown): value is TapTileStackProject {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TapTileStackProject>;
  return candidate.format === 'taptile-stack-studio'
    && candidate.version === '0.1.0'
    && typeof candidate.name === 'string'
    && Array.isArray(candidate.tiles);
}
