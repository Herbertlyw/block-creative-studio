import {
  snapAuthoringCoordinateToExportPixel,
  TAPTILE_AUTHORING_STAGE,
  TAPTILE_EXPORT_STAGE,
} from './pixelGeometry';

export const STACK_STAGE = {
  width: TAPTILE_AUTHORING_STAGE.width,
  height: TAPTILE_AUTHORING_STAGE.height,
  tileSize: 68,
} as const;

export const STACK_EXPORT_STAGE = TAPTILE_EXPORT_STAGE;

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
  snapGapPx?: number;
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

function templateTile(
  template: StackTemplateId,
  index: number,
  x: number,
  y: number,
  layer: number,
): StackTile {
  return {
    id: `${template}-${index + 1}`,
    x: snapAuthoringCoordinateToExportPixel(x),
    y: snapAuthoringCoordinateToExportPixel(y),
    layer,
    rotation: 0,
    scale: 1,
    faceId: FACE_LIBRARY[0]?.id ?? 'bear',
    locked: false,
  };
}

const TEMPLATE_FACE_SEEDS: Record<StackTemplateId, number> = {
  'hourglass': 0x48a21f35,
  't-shape': 0x7c31b9e7,
  'terraces': 0x2df064ab,
  'free': 0x619ac483,
};

// These six tiles are a long-lived regression path used by the renderer and
// director tests. They are spatially separated across three rows, so keeping
// them as the first two safe triples does not recreate the old visible runs.
const TEMPLATE_REMOVAL_PREFIX: Partial<Record<StackTemplateId, string[]>> = {
  hourglass: [
    'hourglass-43',
    'hourglass-44',
    'hourglass-45',
    'hourglass-46',
    'hourglass-47',
    'hourglass-48',
  ],
};

function seededUnit(seedState: { value: number }): number {
  let value = seedState.value | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  seedState.value = value | 0;
  return (value >>> 0) / 0x1_0000_0000;
}

function seededShuffle<T>(values: readonly T[], seedState: { value: number }): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(seededUnit(seedState) * (index + 1));
    const current = shuffled[index]!;
    shuffled[index] = shuffled[swapIndex]!;
    shuffled[swapIndex] = current;
  }
  return shuffled;
}

function blocksTemplateTile(blocker: StackTile, blocked: StackTile): boolean {
  if (blocker.layer <= blocked.layer) return false;
  const blockerHalfSize = (STACK_STAGE.tileSize * blocker.scale) / 2;
  const blockedHalfSize = (STACK_STAGE.tileSize * blocked.scale) / 2;
  const overlapWidth = Math.max(
    0,
    Math.min(blocker.x + blockerHalfSize, blocked.x + blockedHalfSize)
      - Math.max(blocker.x - blockerHalfSize, blocked.x - blockedHalfSize),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(blocker.y + blockerHalfSize, blocked.y + blockedHalfSize)
      - Math.max(blocker.y - blockerHalfSize, blocked.y - blockedHalfSize),
  );
  const overlapArea = overlapWidth * overlapHeight;
  const blockedArea = (blockedHalfSize * 2) ** 2;
  // Equivalent to the V2 compiler's 900 px / 4% policy after the 2.5× export scale.
  const threshold = Math.max(900 / (2.5 ** 2), blockedArea * 0.04);
  return overlapArea + 0.001 >= threshold;
}

function seededSafeRemovalOrder(tiles: readonly StackTile[], template: StackTemplateId): StackTile[] {
  const seedState = { value: TEMPLATE_FACE_SEEDS[template] };
  const remaining = new Map(tiles.map((tile) => [tile.id, tile]));
  const removalOrder: StackTile[] = [];

  const playableTiles = (): StackTile[] => [...remaining.values()].filter((tile) =>
    ![...remaining.values()].some((candidate) => candidate.id !== tile.id && blocksTemplateTile(candidate, tile)));

  const remove = (tile: StackTile): void => {
    remaining.delete(tile.id);
    removalOrder.push(tile);
  };

  for (const tileId of TEMPLATE_REMOVAL_PREFIX[template] ?? []) {
    const tile = remaining.get(tileId);
    if (!tile || !playableTiles().some((candidate) => candidate.id === tileId)) {
      throw new Error(`Template ${template} has an invalid safe removal prefix at ${tileId}.`);
    }
    remove(tile);
  }

  while (remaining.size > 0) {
    const playable = playableTiles();
    if (playable.length === 0) throw new Error(`Template ${template} has no safe removal order.`);
    const currentTriple = removalOrder.slice(removalOrder.length - (removalOrder.length % 3));
    const ranked = playable.map((tile) => {
      const separation = currentTriple.length === 0
        ? 0
        : Math.min(...currentTriple.map((selected) => Math.hypot(tile.x - selected.x, tile.y - selected.y)));
      return { tile, separation, tieBreak: seededUnit(seedState) };
    }).sort((left, right) => right.separation - left.separation
      || right.tieBreak - left.tieBreak
      || left.tile.id.localeCompare(right.tile.id));
    // Pick among equally useful, well-separated candidates so the result reads
    // as shuffled rather than as a repeated scanline pattern.
    const bestSeparation = ranked[0]?.separation ?? 0;
    const candidatePool = ranked.filter((candidate) => candidate.separation >= bestSeparation - 0.001);
    const chosen = candidatePool[Math.floor(seededUnit(seedState) * candidatePool.length)]?.tile ?? ranked[0]!.tile;
    remove(chosen);
  }
  return removalOrder;
}

function distributeTemplateFaces(tiles: readonly StackTile[], template: StackTemplateId): StackTile[] {
  if (tiles.length % 3 !== 0) {
    throw new Error(`Template ${template} must contain a multiple of three tiles.`);
  }
  const seedState = { value: TEMPLATE_FACE_SEEDS[template] ^ 0x5f37_59df };
  const faceOrder = seededShuffle(FACE_LIBRARY.map((face) => face.id), seedState);
  const removalOrder = seededSafeRemovalOrder(tiles, template);
  const faceByTileId = new Map<string, string>();
  for (let index = 0; index < removalOrder.length; index += 1) {
    const groupIndex = Math.floor(index / 3);
    faceByTileId.set(removalOrder[index]!.id, faceOrder[groupIndex % faceOrder.length] ?? 'bear');
  }
  return tiles.map((tile) => ({ ...tile, faceId: faceByTileId.get(tile.id) ?? 'bear' }));
}

function pushCenteredRow(
  target: StackTile[],
  template: StackTemplateId,
  count: number,
  y: number,
  layer: number,
  pitch = STACK_STAGE.tileSize,
  centerX = STACK_STAGE.width / 2,
): void {
  const startX = centerX - ((count - 1) * pitch) / 2;
  for (let column = 0; column < count; column += 1) {
    target.push(templateTile(template, target.length, startX + column * pitch, y, layer));
  }
}

function hourglassTiles(): StackTile[] {
  const tiles: StackTile[] = [];
  const widths = [6, 5, 4, 3, 2, 2, 3, 4, 5, 6];
  widths.forEach((count, row) => {
    pushCenteredRow(tiles, 'hourglass', count, 200 + row * 51, row % 3);
  });
  pushCenteredRow(tiles, 'hourglass', 3, 342, 4);
  pushCenteredRow(tiles, 'hourglass', 3, 545, 4);
  pushCenteredRow(tiles, 'hourglass', 2, 706, 0);
  return tiles;
}

function tShapeTiles(): StackTile[] {
  const tiles: StackTile[] = [];
  pushCenteredRow(tiles, 't-shape', 6, 200, 0);
  pushCenteredRow(tiles, 't-shape', 6, 249, 1, STACK_STAGE.tileSize, STACK_STAGE.width / 2 + 7);
  pushCenteredRow(tiles, 't-shape', 5, 298, 2);
  for (let row = 0; row < 5; row += 1) {
    pushCenteredRow(tiles, 't-shape', 2, 347 + row * 49, 1 + (row % 3));
  }
  pushCenteredRow(tiles, 't-shape', 5, 574, 0);
  pushCenteredRow(tiles, 't-shape', 6, 623, 1);
  pushCenteredRow(tiles, 't-shape', 6, 672, 2, STACK_STAGE.tileSize, STACK_STAGE.width / 2 - 5);
  pushCenteredRow(tiles, 't-shape', 1, 724, 0);
  return tiles;
}

function terraceTiles(): StackTile[] {
  const tiles: StackTile[] = [];
  for (let row = 0; row < 4; row += 1) {
    pushCenteredRow(tiles, 'terraces', 6, 200 + row * 48, row, STACK_STAGE.tileSize, STACK_STAGE.width / 2 + (row % 2 ? 8 : -8));
  }
  for (let row = 0; row < 4; row += 1) {
    pushCenteredRow(tiles, 'terraces', 5, 430 + row * 48, row % 3, STACK_STAGE.tileSize, STACK_STAGE.width / 2 + (row % 2 ? -10 : 10));
  }
  pushCenteredRow(tiles, 'terraces', 6, 650, 1);
  pushCenteredRow(tiles, 'terraces', 1, 716, 0);
  return tiles;
}

function freeTiles(): StackTile[] {
  const points = [
    [144, 235, 0], [216, 235, 0], [288, 235, 0],
    [177, 302, 1], [249, 302, 1],
    [126, 377, 0], [198, 377, 2], [270, 377, 0],
    [162, 455, 1], [234, 455, 3], [306, 455, 1],
    [126, 535, 0], [198, 535, 2], [270, 535, 0], [342, 535, 0],
  ] as const;
  return points.map(([x, y, layer], index) => templateTile('free', index, x, y, layer));
}

export function makeTemplateProject(templateId: StackTemplateId): TapTileStackProject {
  const geometryTiles = templateId === 'hourglass'
    ? hourglassTiles()
    : templateId === 't-shape'
      ? tShapeTiles()
      : templateId === 'terraces'
        ? terraceTiles()
        : freeTiles();
  const tiles = distributeTemplateFaces(geometryTiles, templateId);
  return {
    format: 'taptile-stack-studio',
    version: '0.1.0',
    name: 'TapTile · 手工堆叠草稿',
    templateId,
    material: 'porcelain',
    theme: 'deep-ocean',
    snap: true,
    snapGapPx: 0,
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
    x: snapAuthoringCoordinateToExportPixel(clamp(tile.x, 18, STACK_STAGE.width - 18)),
    y: snapAuthoringCoordinateToExportPixel(clamp(tile.y, 142, STACK_STAGE.height - 26)),
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
