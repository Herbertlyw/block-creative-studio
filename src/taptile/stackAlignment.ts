import { STACK_STAGE, type StackTile } from './stackModel';

export type StackAlignmentCommand =
  | 'left'
  | 'center-x'
  | 'right'
  | 'top'
  | 'center-y'
  | 'bottom'
  | 'distribute-x'
  | 'distribute-y';

function tileRadius(tile: StackTile): number {
  const halfSize = (STACK_STAGE.tileSize * tile.scale) / 2;
  const radians = (tile.rotation * Math.PI) / 180;
  return halfSize * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)));
}

function alignHorizontal(selected: StackTile[], command: 'left' | 'center-x' | 'right'): Map<string, number> {
  const left = Math.min(...selected.map((tile) => tile.x - tileRadius(tile)));
  const right = Math.max(...selected.map((tile) => tile.x + tileRadius(tile)));
  const center = (left + right) / 2;
  return new Map(selected.map((tile) => {
    const radius = tileRadius(tile);
    const x = command === 'left' ? left + radius : command === 'right' ? right - radius : center;
    return [tile.id, x];
  }));
}

function alignVertical(selected: StackTile[], command: 'top' | 'center-y' | 'bottom'): Map<string, number> {
  const top = Math.min(...selected.map((tile) => tile.y - tileRadius(tile)));
  const bottom = Math.max(...selected.map((tile) => tile.y + tileRadius(tile)));
  const center = (top + bottom) / 2;
  return new Map(selected.map((tile) => {
    const radius = tileRadius(tile);
    const y = command === 'top' ? top + radius : command === 'bottom' ? bottom - radius : center;
    return [tile.id, y];
  }));
}

function distribute(selected: StackTile[], axis: 'x' | 'y'): Map<string, number> {
  const ordered = [...selected].sort((left, right) => left[axis] - right[axis]);
  const first = ordered[0];
  const last = ordered.at(-1);
  if (!first || !last || ordered.length < 3) return new Map();
  const firstRadius = tileRadius(first);
  const lastRadius = tileRadius(last);
  const outerStart = first[axis] - firstRadius;
  const outerEnd = last[axis] + lastRadius;
  const occupied = ordered.reduce((total, tile) => total + tileRadius(tile) * 2, 0);
  const gap = (outerEnd - outerStart - occupied) / (ordered.length - 1);
  const positions = new Map<string, number>();
  let cursor = outerStart;
  for (const tile of ordered) {
    const radius = tileRadius(tile);
    positions.set(tile.id, cursor + radius);
    cursor += radius * 2 + gap;
  }
  return positions;
}

export function alignStackTiles(
  tiles: readonly StackTile[],
  selectedIds: ReadonlySet<string> | readonly string[],
  command: StackAlignmentCommand,
): StackTile[] {
  const ids = new Set(selectedIds);
  const selected = tiles.filter((tile) => ids.has(tile.id));
  const minimum = command === 'distribute-x' || command === 'distribute-y' ? 3 : 2;
  if (selected.length < minimum) return [...tiles];

  if (command === 'left' || command === 'center-x' || command === 'right') {
    const positions = alignHorizontal(selected, command);
    return tiles.map((tile) => positions.has(tile.id) ? { ...tile, x: positions.get(tile.id) ?? tile.x } : tile);
  }
  if (command === 'top' || command === 'center-y' || command === 'bottom') {
    const positions = alignVertical(selected, command);
    return tiles.map((tile) => positions.has(tile.id) ? { ...tile, y: positions.get(tile.id) ?? tile.y } : tile);
  }

  const axis = command === 'distribute-x' ? 'x' : 'y';
  const positions = distribute(selected, axis);
  return tiles.map((tile) => positions.has(tile.id) ? { ...tile, [axis]: positions.get(tile.id) ?? tile[axis] } : tile);
}
