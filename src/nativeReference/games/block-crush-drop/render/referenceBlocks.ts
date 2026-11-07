import * as THREE from 'three';
import type { BlockCrushDropConfig } from '../types';

/** 4319/4327 reference direction: saturated faces, broad planar bevels, fine seams. */
export const REFERENCE_BLOCK_COLORS = [
  '#25c83b',
  '#f26821',
  '#a650e0',
  '#fac72b',
  '#365ce8',
  '#19c4ec',
] as const;
const initialRows = new WeakMap<BlockCrushDropConfig, Map<string, number>>();
const colorAt = (index: number) =>
  REFERENCE_BLOCK_COLORS[
    ((index % REFERENCE_BLOCK_COLORS.length) + REFERENCE_BLOCK_COLORS.length) %
      REFERENCE_BLOCK_COLORS.length
  ]!;

export function referenceQueueColor(batchIndex: number, slot: number): string {
  return colorAt(batchIndex * 3 + slot);
}

/** Bind bands to cell provenance, never current y: compaction must not repaint survivors. */
export function referenceBlockColor(id: string, config: BlockCrushDropConfig): string {
  const parentId = id.replace(/:fragment-[01]-[01]$/, '');
  let rows = initialRows.get(config);
  if (!rows) {
    rows = new Map(config.initialCells.map((cell) => [cell.id, cell.y]));
    initialRows.set(config, rows);
  }
  const row = rows.get(parentId);
  if (row !== undefined) return colorAt(Math.floor(row / 3));
  const rising = parentId.match(/^rising-row-(\d+)-/);
  if (rising) return colorAt(Math.floor((-Number(rising[1]) - 1) / 3));
  const input = parentId.match(/-batch-(\d+)-slot-(\d+)-/);
  if (input) return referenceQueueColor(Number(input[1]), Number(input[2]));
  let hash = 0;
  for (const character of parentId) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return colorAt(hash);
}

type Point = [number, number, number];
/** Actual closed volume. Independent planar faces retain the reference's sharp light breaks. */
export function createReferenceBlockGeometry(): THREE.BufferGeometry {
  const positions: number[] = [],
    colors: number[] = [];
  const quad = (points: Point[], brightness: number | number[]) => {
    for (const index of [0, 1, 2, 0, 2, 3]) {
      positions.push(...points[index]!);
      const value = typeof brightness === 'number' ? brightness : brightness[index]!;
      colors.push(value, value, value);
    }
  };
  const outer: Point[] = [
    [-0.5, -0.5, 0.04],
    [0.5, -0.5, 0.04],
    [0.5, 0.5, 0.04],
    [-0.5, 0.5, 0.04],
  ];
  const face: Point[] = [
    [-0.37, -0.37, 0.24],
    [0.37, -0.37, 0.24],
    [0.37, 0.37, 0.24],
    [-0.37, 0.37, 0.24],
  ];
  const back: Point[] = outer.map(([x, y]) => [x, y, -0.24]);
  quad(face, [0.86, 0.86, 1.02, 1.02]);
  const bevelLight = [0.32, 0.55, 1.6, 0.78];
  const sideLight = [0.25, 0.38, 0.75, 0.48];
  for (let edge = 0; edge < 4; edge++) {
    const next = (edge + 1) % 4;
    quad([outer[edge]!, outer[next]!, face[next]!, face[edge]!], bevelLight[edge]!);
    quad([back[edge]!, back[next]!, outer[next]!, outer[edge]!], sideLight[edge]!);
  }
  quad([...back].reverse(), 0.32);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Queue and 2D fallback use the same face/bevel proportions as the 3D block. */
export function drawReferenceBlock(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha = 1,
): void {
  const inset = size * 0.008,
    left = x + inset,
    top = y + inset,
    edge = size - inset * 2,
    bevel = edge * 0.13;
  const base = new THREE.Color(color);
  const shade = (amount: number) => `#${base.clone().multiplyScalar(amount).getHexString()}`;
  const polygon = (points: number[][], fill: string) => {
    context.beginPath();
    points.forEach(([px, py], i) =>
      i === 0 ? context.moveTo(px!, py!) : context.lineTo(px!, py!),
    );
    context.closePath();
    context.fillStyle = fill;
    context.fill();
  };
  context.save();
  context.globalAlpha = alpha;
  const r = left + edge,
    b = top + edge,
    l1 = left + bevel,
    r1 = r - bevel,
    t1 = top + bevel,
    b1 = b - bevel;
  polygon(
    [
      [left, top],
      [r, top],
      [r1, t1],
      [l1, t1],
    ],
    shade(1.6),
  );
  polygon(
    [
      [r, top],
      [r, b],
      [r1, b1],
      [r1, t1],
    ],
    shade(0.55),
  );
  polygon(
    [
      [r, b],
      [left, b],
      [l1, b1],
      [r1, b1],
    ],
    shade(0.32),
  );
  polygon(
    [
      [left, b],
      [left, top],
      [l1, t1],
      [l1, b1],
    ],
    shade(0.78),
  );
  const gradient = context.createLinearGradient(0, t1, 0, b1);
  gradient.addColorStop(0, shade(1.02));
  gradient.addColorStop(1, shade(0.86));
  context.fillStyle = gradient;
  context.fillRect(l1, t1, r1 - l1, b1 - t1);
  context.restore();
}
