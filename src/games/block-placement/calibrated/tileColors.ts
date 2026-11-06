// Derived production module; supplied reference files remain unchanged.
/** Presentation-only IDs keep each piece's color stable from rack through its clear. */
export type InlayDistribution =
  | { kind?: 'gem-inlay' | 'motif-atlas'; decoratedFraction: number; seed: number }
  | { kind: 'palette-atlas' };
const hash = (text: string) =>
  [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
export function shapeCellColor(color: string, row: number, col: number, inlay?: InlayDistribution) {
  if (!inlay) return color;
  if (inlay.kind === 'palette-atlas') return color.split(':')[0]!;
  const n = hash(`${color}:${row}:${col}:${inlay.seed}`);
  const gem = n / 0x100000000 < inlay.decoratedFraction ? 1 + (hash(`kind:${n}`) % 2) : 0;
  return `${color.split(':')[0]}:gem-${gem}`;
}
export function gemSpriteIndex(color: string) {
  const base = Number(/^skin-(\d+)/.exec(color)?.[1] ?? 0),
    gem = Number(/:gem-(\d+)/.exec(color)?.[1] ?? 0);
  return (base % 2) * 3 + gem;
}
export function materialSpriteIndex(color: string, kind: string) {
  const base = Number(/^skin-(\d+)/.exec(color)?.[1] ?? 0);
  return kind === 'palette-atlas'
    ? base
    : kind === 'motif-atlas'
      ? base * 3 + Number(/:gem-(\d+)/.exec(color)?.[1] ?? 0)
      : gemSpriteIndex(color);
}
export function recolorReplay(
  initial: any,
  steps: any[],
  colors: string[] | undefined,
  inlay?: InlayDistribution,
) {
  if (!colors) return { initial, steps };
  const key = (n: number) => `skin-${Math.abs(n) % colors.length}`;
  const piece = (p: any) => ({
    ...p,
    color:
      key([...p.id].reduce((h: number, c: string) => (h * 31 + c.charCodeAt(0)) >>> 0, 0)) +
      (inlay ? `:piece-${hash(p.id)}` : ''),
  });
  let board = initial.board.cells.map((row: any[], r: number) =>
    row.map((v: any, c: number) =>
      v === null
        ? null
        : shapeCellColor(
            key(inlay ? Math.floor(r / 2) + Math.floor(c / 3) : r + c) + `:initial`,
            r,
            c,
            inlay,
          ).replace(':initial', ''),
    ),
  );
  const state = (s: any, b: any[][]) => ({
    ...s,
    board: { ...s.board, cells: b.map((row) => [...row]) },
    pieces: s.pieces.map(piece),
  });
  const first = state(initial, board);
  const result = steps.map((st) => {
    const before = state(st.before, board),
      p = piece(st.piece);
    const placedColors: Record<string, string> = {};
    board = board.map((row: any[]) => [...row]);
    for (const cell of st.placedCells) {
      const color = shapeCellColor(
        p.color,
        inlay ? cell.row - st.action.anchor.row : 0,
        inlay ? cell.col - st.action.anchor.col : 0,
        inlay,
      );
      board[cell.row][cell.col] = color;
      placedColors[`${cell.row},${cell.col}`] = color;
    }
    for (const cell of st.clear.cells) board[cell.row][cell.col] = null;
    return { ...st, before, after: state(st.after, board), piece: p, placedColors };
  });
  return { initial: first, steps: result };
}
export function tintForColor(colors: string[] | undefined, color: string) {
  return colors?.[Number(/^skin-(\d+)/.exec(color)?.[1])] ?? colors?.[0];
}
export function mixColor(hex: string, white: number) {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((v) => parseInt(v, 16));
  return (
    '#' +
    rgb
      .map((v) =>
        Math.round(white >= 0 ? v + (255 - v) * white : v * (1 + white))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
function hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const hi = Math.max(r, g, b),
    lo = Math.min(r, g, b),
    d = hi - lo,
    l = (hi + lo) / 2;
  let h = 0;
  if (d) {
    h =
      (hi === r ? (g - b) / d + (g < b ? 6 : 0) : hi === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
  }
  return [h, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l];
}
function rgb(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  });
}
/** Preserve alpha, fine shading and neutral highlights; recolor the sprite, not its geometry. */
export function recolorPixels(data: Uint8ClampedArray, target: string) {
  const [th, ts, tl] = hsl(
    ...(target
      .slice(1)
      .match(/../g)!
      .map((v) => parseInt(v, 16)) as [number, number, number]),
  );
  const [, ss, sl] = hsl(231, 131, 166);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const [, s, l] = hsl(data[i]!, data[i + 1]!, data[i + 2]!);
    if (s < 0.08) continue;
    const light = Math.max(0.04, Math.min(0.98, tl! + (l! - sl!))),
      sat = Math.min(1, ts! * Math.min(1.15, s! / ss!));
    const c = rgb(th!, sat, light);
    data[i] = c[0]!;
    data[i + 1] = c[1]!;
    data[i + 2] = c[2]!;
  }
}
