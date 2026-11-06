import type { PieceShape } from './types';

/** Authored poses from the verified reference worktree; excluded from all seeded shape lists. */
export function appendReferenceAuthoredShapes(SHAPES: PieceShape[]): void {
  SHAPES.push({
    id: 'square-4',
    label: '方四',
    cells: Array.from({ length: 16 }, (_, i) => [Math.floor(i / 4), i % 4] as [number, number]),
  });

  // These are fixed authored orientations, not an in-game rotate mechanic.
  const authoredBases: Record<string, [number, number][]> = {
    rect23: [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    l3: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    l4: [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
    ],
    l5: [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [2, 2],
    ],
    t4: [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
    ],
    t5: [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
      [2, 1],
    ],
    s4: [
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
    ],
    p5: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
    ],
    u5: [
      [0, 0],
      [0, 1],
      [1, 0],
      [2, 0],
      [2, 1],
    ],
    diag3: [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
    diag2: [
      [0, 0],
      [1, 1],
    ],
    // Measured fixed poses in reference C4F48462; opt-in only, no seeded-supply changes.
    wideT5: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 1],
    ],
    corner8: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2],
    ],
    split4: [
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 2],
    ],
    // Measured large fixed poses in C4F50915; authored supply only.
    ring12: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0],
      [1, 3],
      [2, 0],
      [2, 3],
      [3, 0],
      [3, 1],
      [3, 2],
      [3, 3],
    ],
    'corners-center8': [
      [0, 0],
      [0, 3],
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
      [3, 0],
      [3, 3],
    ],
    l7: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
    l9: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ],
    stair6: [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [2, 0],
    ],
    rect24: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
    ],
    branch6: [
      [0, 2],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2],
      [3, 2],
    ],
    longL5: [
      [0, 0],
      [0, 1],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
    step4: [
      [0, 0],
      [1, 1],
      [1, 2],
      [1, 3],
    ],
    step22: [
      [0, 0],
      [0, 1],
      [1, 2],
      [1, 3],
    ],
    boot9: [
      [0, 1],
      [0, 2],
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
      [3, 0],
      [3, 1],
      [3, 2],
    ],
  };
  for (const [name, base] of Object.entries(authoredBases)) {
    const seen = new Set<string>();
    for (let reflection = 0; reflection < 2; reflection++) {
      let cells: [number, number][] = base.map(([r, c]) => [r, reflection ? -c : c]);
      for (let rotation = 0; rotation < 4; rotation++) {
        const minR = Math.min(...cells.map((c) => c[0])),
          minC = Math.min(...cells.map((c) => c[1]));
        const normalized: [number, number][] = cells.map(([r, c]) => [r - minR, c - minC]);
        normalized.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const key = JSON.stringify(normalized);
        if (!seen.has(key)) {
          SHAPES.push({
            id: `authored-${name}-${reflection}${rotation}`,
            label: `${name} ${reflection}${rotation}`,
            cells: normalized,
          });
          seen.add(key);
        }
        cells = cells.map(([r, c]) => [c, -r]);
      }
    }
  }
}
