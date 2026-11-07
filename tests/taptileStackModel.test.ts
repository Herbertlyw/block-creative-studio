import { describe, expect, it } from 'vitest';
import {
  estimateOverlapPairs,
  FACE_LIBRARY,
  makeTemplateProject,
  maxLayer,
  normalizeTile,
  STACK_STAGE,
  type StackTemplateId,
} from '../src/taptile/stackModel';
import { TAPTILE_REFERENCE_BOARD_TOP_PX } from '../src/taptile/trayLayout';

describe('TapTile stack model', () => {
  it('creates four non-empty templates with stable unique tile ids', () => {
    const templates: StackTemplateId[] = ['hourglass', 't-shape', 'terraces', 'free'];
    for (const template of templates) {
      const project = makeTemplateProject(template);
      expect(project.tiles.length).toBeGreaterThan(10);
      expect(new Set(project.tiles.map((tile) => tile.id)).size).toBe(project.tiles.length);
      expect(maxLayer(project.tiles)).toBeGreaterThan(0);
    }
  });

  it('distributes complete triples deterministically instead of placing equal faces in runs', () => {
    const templates: StackTemplateId[] = ['hourglass', 't-shape', 'terraces', 'free'];
    for (const template of templates) {
      const first = makeTemplateProject(template).tiles;
      const second = makeTemplateProject(template).tiles;
      expect(second.map((tile) => tile.faceId)).toEqual(first.map((tile) => tile.faceId));
      expect(first.some((tile, index) => index > 0 && tile.faceId !== first[index - 1]?.faceId)).toBe(true);
      for (const face of FACE_LIBRARY) {
        const count = first.filter((tile) => tile.faceId === face.id).length;
        expect(count % 3, `${template}: ${face.id} has ${count}`).toBe(0);
      }
      const rows = new Map<string, typeof first>();
      for (const tile of first) {
        const key = `${tile.layer}:${tile.y}`;
        rows.set(key, [...(rows.get(key) ?? []), tile]);
      }
      for (const [rowKey, row] of rows) {
        const ordered = [...row].sort((left, right) => left.x - right.x);
        for (let index = 2; index < ordered.length; index += 1) {
          const run = ordered.slice(index - 2, index + 1);
          const contiguous = run.every((tile, runIndex) => runIndex === 0
            || Math.abs(tile.x - run[runIndex - 1]!.x) <= STACK_STAGE.tileSize + 0.001);
          expect(contiguous && new Set(run.map((tile) => tile.faceId)).size === 1, `${template}: triple run in ${rowKey}`).toBe(false);
        }
      }
    }
  });

  it('does not overlap horizontally aligned tiles on the same template layer', () => {
    const templates: StackTemplateId[] = ['hourglass', 't-shape', 'terraces', 'free'];
    for (const template of templates) {
      const tiles = makeTemplateProject(template).tiles;
      for (let leftIndex = 0; leftIndex < tiles.length; leftIndex += 1) {
        const left = tiles[leftIndex];
        if (!left) continue;
        for (let rightIndex = leftIndex + 1; rightIndex < tiles.length; rightIndex += 1) {
          const right = tiles[rightIndex];
          if (!right || left.layer !== right.layer || Math.abs(left.y - right.y) > 0.001) continue;
          const minimumDistance = (STACK_STAGE.tileSize * left.scale) / 2 + (STACK_STAGE.tileSize * right.scale) / 2;
          expect(Math.abs(left.x - right.x), `${template}: ${left.id} / ${right.id}`).toBeGreaterThanOrEqual(minimumDistance - 0.001);
        }
      }
    }
  });

  it('keeps every template tile below the fixed top tray', () => {
    const templates: StackTemplateId[] = ['hourglass', 't-shape', 'terraces', 'free'];
    for (const template of templates) {
      for (const tile of makeTemplateProject(template).tiles) {
        const tileTopPx = (tile.y - (STACK_STAGE.tileSize * tile.scale) / 2) * 2.5;
        expect(tileTopPx, `${template}: ${tile.id}`).toBeGreaterThanOrEqual(TAPTILE_REFERENCE_BOARD_TOP_PX);
      }
    }
  });

  it('normalizes editor transforms without allowing unusable values', () => {
    const tile = normalizeTile({
      id: 'probe',
      x: -500,
      y: 5_000,
      layer: 99,
      rotation: 180,
      scale: 8,
      faceId: 'bear',
      locked: false,
    });
    expect(tile.x).toBeGreaterThanOrEqual(18);
    expect(tile.y).toBeLessThanOrEqual(742);
    expect(tile.layer).toBe(99);
    expect(tile.rotation).toBe(45);
    expect(tile.scale).toBe(1.65);
  });

  it('keeps arbitrary non-negative integer layers for deep stacks', () => {
    const tile = normalizeTile({
      id: 'deep-layer',
      x: 200,
      y: 300,
      layer: 47.7,
      rotation: 0,
      scale: 1,
      faceId: 'bear',
      locked: false,
    });
    expect(tile.layer).toBe(48);
    expect(normalizeTile({ ...tile, layer: -3 }).layer).toBe(0);
  });

  it('detects cross-layer overlap while ignoring same-layer neighbors', () => {
    const project = makeTemplateProject('free');
    const first = project.tiles[0];
    const second = project.tiles[1];
    if (!first || !second) throw new Error('Free template must contain tiles.');
    const stacked = [
      { ...first, x: 200, y: 300, layer: 0 },
      { ...second, x: 205, y: 304, layer: 1 },
    ];
    expect(estimateOverlapPairs(stacked)).toBe(1);
    expect(estimateOverlapPairs(stacked.map((tile) => ({ ...tile, layer: 2 })))).toBe(0);
  });
});
