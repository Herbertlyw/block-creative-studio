/** Presentation identity shared by opaque and transparent native renderers. */
export function crushFragmentIdentity(id: string): {
  parentId: string;
  quadrant: number;
  layer: 0 | 1;
  volume: boolean;
} {
  const match = id.match(/:fragment-([01])-([01])(?::layer-([01]))?$/);
  return match
    ? {
        parentId: id.slice(0, match.index),
        quadrant: Number(match[2]) * 2 + Number(match[1]),
        layer: Number(match[3] ?? 0) as 0 | 1,
        volume: match[3] !== undefined,
      }
    : { parentId: id, quadrant: 0, layer: 0, volume: false };
}

/** BoxGeometry groups: +X,-X,+Y,-Y,+Z,-Z. Grid Y increases upwards. */
export function crushFragmentInteriorFace(quadrant: number, face: number, layer: 0 | 1): boolean {
  const x = quadrant % 2,
    y = Math.floor(quadrant / 2);
  return face === 0
    ? x === 0
    : face === 1
      ? x === 1
      : face === 2
        ? y === 0
        : face === 3
          ? y === 1
          : face === 4
            ? layer === 1
            : face === 5
              ? layer === 0
              : false;
}
