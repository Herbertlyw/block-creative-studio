// Derived production module; supplied reference files remain unchanged.
import { boardSide } from './boardGeometry';
import type { ReferenceEffects } from '../../../nativeReference/games/block-placement/presentation/referenceEffects';
import { smooth, noise, glow, star, lightPath, palette, type C } from './libraryDrawing';
type Config = NonNullable<ReferenceEffects['screenAtmosphere']>;
export function screenAtmosphereEnvelope(age: number) {
  return age < 0 || age >= 0.85 ? 0 : smooth(age / 0.085) * (1 - smooth((age - 0.22) / 0.63));
}
const rgba = (hex: string, a: number) =>
  hex +
  Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, '0');
/** Adapts the six premium-block-fx side-light designs to the calibrated full viewport.
 * Camera independent; zero idle glow; the centre never receives a full-screen wash. */
export function drawScreenAtmosphere(
  c: C,
  board: readonly number[],
  age: number,
  time: number,
  config: Config,
) {
  const a = screenAtmosphereEnvelope(age) * config.intensity;
  if (!config.enabled || a <= 0) return;
  const W = 1080,
    H = 1920,
    [bx, by, p] = board as [number, number, number],
    cy = by + p * 3.84 * (boardSide(board) / 8);
  c.save();
  c.beginPath();
  c.rect(0, 0, W, H);
  c.clip();
  c.globalCompositeOperation = 'screen';
  const style = config.style;
  if (style === 'glacial-wings' || style === 'glacial-surge') {
    const strong = style === 'glacial-surge',
      width = strong ? 270 : 230;
    for (let side = 0; side < 2; side++) {
      const x = side ? W : 0,
        d = side ? -1 : 1,
        g = c.createLinearGradient(x, 0, x + d * width, 0);
      for (const [k, col, op] of [
        [0, '#bcf7ff', 0.85],
        [0.06, '#57eaff', 0.7],
        [0.24, '#198fff', 0.42],
        [1, '#226dff', 0],
      ] as const)
        g.addColorStop(k, rgba(col, a * op * (strong ? 1 : 0.7)));
      c.fillStyle = g;
      c.fillRect(side ? W - width : 0, 0, width, H);
      for (let j = 0; j < (strong ? 5 : 4); j++) {
        const y = ((time * (100 + j * 12) + j * 420) % 2200) - 200;
        glow(
          c,
          x + d * (10 + j * 9),
          y,
          strong ? 160 : 130,
          j % 2 ? '#866cff' : '#75e5ff',
          a * 0.34,
          0.15,
          2.4,
        );
      }
      if (strong)
        for (let j = 0; j < 15; j++) {
          const y = (noise(99, j) * H - time * 65 + H * 8) % H;
          star(c, x + d * (10 + noise(5, j) * 64), y, 3 + noise(44, j) * 5, '#abf7ff', a * 0.6);
        }
    }
  } else if (style === 'aurora-veil') {
    for (let side = 0; side < 2; side++)
      for (let layer = 0; layer < 3; layer++) {
        const x = side ? W : 0,
          d = side ? -1 : 1,
          col = layer === 0 ? '#62d5d7' : layer === 1 ? '#9185ef' : '#ba83d9';
        for (const [width, opacity, blur] of [
          [80, 0.035, 28],
          [44, 0.065, 20],
          [17, 0.12, 12],
          [2, 0.18, 7],
        ]) {
          const g = c.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0, rgba(col, a * opacity * 0.4));
          g.addColorStop(0.3, rgba(col, a * opacity));
          g.addColorStop(0.65, rgba(layer === 1 ? '#73e5ce' : col, a * opacity));
          g.addColorStop(1, rgba(col, a * opacity * 0.4));
          c.strokeStyle = g;
          c.lineWidth = width;
          c.shadowColor = col;
          c.shadowBlur = blur;
          c.beginPath();
          for (let y = -40; y <= H + 40; y += 16) {
            const xx =
              x +
              d *
                (22 +
                  layer * 22 +
                  Math.sin((y / H) * Math.PI * 2.4 + time * 0.45 + layer * 0.85) * 24);
            if (y === -40) c.moveTo(xx, y);
            else c.lineTo(xx, y);
          }
          c.stroke();
        }
      }
    c.shadowBlur = 0;
    for (let i = 0; i < 18; i++) {
      const side = i % 2,
        x = (side ? W - 1 : 1) + (side ? -1 : 1) * (15 + noise(91, i) * 80),
        y = (noise(18, i) * H - time * (12 + noise(29, i) * 20) + H * 10) % H;
      star(c, x, y, 2 + noise(17, i) * 3, '#c3edff', a * 0.45);
    }
  } else if (style === 'star-warp') {
    glow(c, 0, cy, 630, '#ae4dff', a * 0.55, 0.36, 1.5);
    glow(c, W, cy, 630, '#28baff', a * 0.65, 0.36, 1.5);
    // Restrict rays to side gutters instead of covering score, rack or central board.
    c.save();
    c.beginPath();
    c.rect(0, 0, 155, H);
    c.rect(W - 155, 0, 155, H);
    c.clip();
    for (let i = 0; i < 66; i++) {
      const angle = noise(334, i) * Math.PI * 2,
        q = (noise(67, i) + time * 0.3) % 1,
        r = 380 + q * 580,
        x = W / 2 + Math.cos(angle) * r,
        y = cy + Math.sin(angle) * r * 1.25,
        tail = 25 + q * 105;
      lightPath(
        c,
        [
          [x - Math.cos(angle) * tail, y - Math.sin(angle) * tail * 1.25],
          [x, y],
        ],
        palette[(i + 2) % 6]!,
        a * (0.25 + 0.7 * q),
        1.4 + q * 1.8,
      );
      if (i % 4 === 0) star(c, x, y, 4 + q * 6, '#f4e9ff', a * 0.7, angle);
    }
    c.restore();
  } else {
    const strong = style === 'solar-flare';
    for (let side = 0; side < 2; side++) {
      const x = side ? W : 0,
        d = side ? -1 : 1;
      glow(
        c,
        x,
        cy,
        strong ? 690 : 550,
        strong ? '#ff893a' : '#ffbf67',
        a * (strong ? 0.62 : 0.42),
        0.32,
        1.55,
      );
      for (const yy of [H * 0.08, H * 0.91])
        glow(c, x, yy, strong ? 380 : 300, '#ffd3a0', a * (strong ? 0.5 : 0.3), 0.6, 0.6);
      for (let j = 0; j < (strong ? 24 : 7); j++) {
        const yy = (noise(334, j) * H - time * (strong ? 90 + noise(3, j) * 100 : 22) + H * 12) % H,
          xx = x + d * (10 + noise(663, j) * 66);
        if (strong) {
          const len = 12 + noise(11, j) * 48;
          lightPath(
            c,
            [
              [xx, yy + len],
              [xx, yy],
            ],
            j % 3 ? '#ffbb4e' : '#ff7138',
            a * 0.55,
            2 + noise(91, j) * 2,
          );
        }
        if (j % 3 === 0 || !strong)
          star(
            c,
            xx,
            yy,
            strong ? 5 + noise(19, j) * 5 : 2 + noise(19, j) * 3,
            '#ffe5ab',
            a * 0.55,
          );
      }
    }
  }
  c.restore();
}
