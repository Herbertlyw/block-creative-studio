import { describe, expect, it } from 'vitest';
import {
  estimateOverlapPairs,
  makeTemplateProject,
  maxLayer,
  normalizeTile,
  type StackTemplateId,
} from '../src/taptile/stackModel';

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
