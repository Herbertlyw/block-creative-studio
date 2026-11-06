import type { ReferenceCalibration } from './parseCalibration';
import type { BBGeometry } from '../planning/geometry';
import { drawClassicPraise } from './classicPraise';
import { drawLayeredCombo } from './referenceFeedback';
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => {
  x = clamp(x);
  return x * x * (3 - 2 * x);
};
/** Style-specific primitives shared by discrete HUD and feedback layers. */
export function createObservedPrimitives(
  ctx: CanvasRenderingContext2D,
  spec: ReferenceCalibration,
  images: Record<string, HTMLImageElement>,
  geometry: BBGeometry,
) {
  const { x: gx, y: gy, pitch, rows: boardSize } = geometry.board;
  function polygon(points: number[][], fill: string) {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  function round(x: number, y: number, w: number, h: number, r: number, fill: string) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }
  function text(
    label: string,
    x: number,
    y: number,
    size: number,
    fill: string,
    stroke?: string,
    italic = false,
  ) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${italic ? 'italic ' : ''}900 ${size}px Arial`;
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#17203b80';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = size * 0.045;
    if (stroke) {
      ctx.lineWidth = size * 0.095;
      ctx.strokeStyle = stroke;
      ctx.strokeText(label, x, y);
    }
    ctx.fillStyle = fill;
    ctx.fillText(label, x, y);
    ctx.restore();
  }
  function star(x: number, y: number, size: number, color: string) {
    ctx.save();
    ctx.translate(x, y);
    polygon(
      [
        [0, -size],
        [size * 0.23, -size * 0.23],
        [size, 0],
        [size * 0.23, size * 0.23],
        [0, size],
        [-size * 0.23, size * 0.23],
        [-size, 0],
        [-size * 0.23, -size * 0.23],
      ],
      color,
    );
    ctx.restore();
  }
  function praiseImage(label: string, x: number, y: number) {
    const key = /^good/i.test(label)
      ? 'praiseGood'
      : /^great/i.test(label)
        ? 'praiseGreat'
        : /^perfect/i.test(label)
          ? 'praisePerfect'
          : undefined;
    const im = key ? images[key] : undefined;
    if (!im) return false;
    const width = key === 'praisePerfect' ? 620 : key === 'praiseGreat' ? 530 : 450,
      height = (width * im.naturalHeight) / im.naturalWidth;
    ctx.drawImage(im, x - width / 2, y - height / 2, width, height);
    return true;
  }
  function praise(
    label: string,
    combo: number,
    age: number,
    x: number,
    y: number,
    variant?: string,
  ) {
    if (variant === 'classic' || variant === 'red') {
      drawClassicPraise(ctx, label, combo, age, x, y, variant === 'red');
      return;
    }
    if (variant === 'inset') {
      const isCombo = /^Combo/i.test(label),
        good = /^Good/i.test(label),
        word = isCombo ? 'Combo' : label;
      ctx.save();
      ctx.translate(x, y);
      const pop = 0.86 + 0.14 * ease(age / 0.12);
      ctx.scale(pop, pop);
      ctx.font = `italic 900 ${isCombo ? 102 : 100}px "Arial Rounded MT Bold",Arial,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.shadowOffsetY = 5;
      ctx.shadowBlur = 8;
      ctx.shadowColor = isCombo ? '#593292' : good ? '#416d22' : '#19597e';
      ctx.lineWidth = 16;
      ctx.strokeStyle = isCombo ? '#754eb2' : good ? '#54863a' : '#217ba8';
      ctx.strokeText(word, 0, 0);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.lineWidth = 6;
      ctx.strokeStyle = isCombo ? '#fff5b3' : good ? '#b2e78b' : '#9ee6ff';
      ctx.strokeText(word, 0, 0);
      const fill = ctx.createLinearGradient(0, -48, 0, 48);
      fill.addColorStop(0, isCombo ? '#fffbaa' : good ? '#e2ffc0' : '#c3f5ff');
      fill.addColorStop(1, isCombo ? '#ffe749' : good ? '#86d84b' : '#48c2ed');
      ctx.fillStyle = fill;
      ctx.fillText(word, 0, 0);
      if (!isCombo) {
        const w = ctx.measureText(word).width / 2;
        star(-w - 20, 23, 8, '#bdf5ff');
        star(w + 14, -25, 10, '#e4ffff');
        star(w + 30, 22, 6, '#99efff');
      }
      ctx.restore();
      return;
    }
    if (spec.effects?.comboMotion === 'layered' && /^Combo/i.test(label)) {
      drawLayeredCombo(ctx, spec.theme, combo, age, x, y);
      return;
    }
    if (spec.theme === 'pink' && /^Combo/i.test(label)) {
      const p = ease((age - 0.04) / 0.12),
        exit = 1 - ease((age - 0.44) / 0.17),
        digitExit = 1 - ease((age - 0.57) / 0.18);
      ctx.save();
      ctx.translate(x, y);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      const draw = (word: string, xx: number, size: number, fill: any) => {
        ctx.font = `italic 900 ${size}px "Arial Rounded MT Bold",Arial,sans-serif`;
        ctx.shadowColor = '#042267';
        ctx.shadowBlur = 9;
        ctx.shadowOffsetY = 9;
        ctx.strokeStyle = '#154ba9';
        ctx.lineWidth = 21;
        ctx.strokeText(word, xx, 0);
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = '#478ff5';
        ctx.lineWidth = 10;
        ctx.strokeText(word, xx, 0);
        ctx.fillStyle = fill;
        ctx.fillText(word, xx, 0);
      };
      ctx.save();
      ctx.globalAlpha = p * exit;
      ctx.scale(p * exit, p * exit);
      const wordFill = ctx.createLinearGradient(0, -60, 0, 70);
      wordFill.addColorStop(0, '#f6ffff');
      wordFill.addColorStop(1, '#a9eafa');
      draw('Combo', -70, 130, wordFill);
      ctx.restore();
      const q = ease((age - 0.09) / 0.1);
      ctx.save();
      ctx.globalAlpha = q * digitExit;
      ctx.translate(235, 0);
      ctx.scale(q * digitExit, q * digitExit);
      const gold = ctx.createLinearGradient(0, -85, 0, 70);
      gold.addColorStop(0, '#ffff82');
      gold.addColorStop(0.5, '#ffed34');
      gold.addColorStop(1, '#f9af19');
      draw(String(combo || 1), 0, 176, gold);
      ctx.restore();
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    const pop = 0.7 + 0.3 * ease(age / 0.16) + 0.07 * Math.sin(Math.PI * clamp(age / 0.23));
    ctx.scale(pop, pop);
    ctx.globalAlpha *= clamp(age / 0.055) * clamp((0.85 - age) / 0.17);
    if (spec.theme === 'grey' && praiseImage(label, 0, 0)) {
      ctx.restore();
      return;
    }
    const edge = spec.theme === 'purple' ? '#bd4ab0' : '#075699';
    if (/^Combo\s*\d*/i.test(label)) {
      const digits = String(combo || 1),
        numberWidth = digits.length * 110,
        wordWidth = 405,
        gap = 22,
        start = -(wordWidth + gap + numberWidth) / 2;
      const nx = start + wordWidth + gap + numberWidth / 2;
      glow(nx, 0, 110, '#ffdc5860', 0.9);
      ctx.save();
      ctx.strokeStyle = '#ffdf6670';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(nx, 0, 76, 90, 0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      text('Combo', start + wordWidth / 2, 3, 132, '#fff9fa', edge, true);
      const grad = ctx.createLinearGradient(0, -75, 0, 70);
      grad.addColorStop(
        0,
        spec.theme === 'pink' ? '#ffff81' : spec.theme === 'purple' ? '#fff7db' : '#22b9ea',
      );
      grad.addColorStop(
        1,
        spec.theme === 'pink' ? '#f2c719' : spec.theme === 'purple' ? '#ffc0e6' : '#0075b4',
      );
      text(digits, nx, -3, 188, grad as any, edge, true);
      for (let j = 0; j < 5; j++) {
        const a = j * 2.4 + age * 1.7;
        star(
          nx + Math.cos(a) * 92,
          Math.sin(a) * 79,
          4 + 3 * Math.sin(age * 11 + j) ** 2,
          '#fff19a',
        );
      }
    } else text(label, 0, 0, 94, '#eaffff', edge, true);
    ctx.restore();
  }
  function glow(x: number, y: number, r: number, color: string, alpha = 1) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    ctx.restore();
  }
  function crown(x: number, y: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = '#bd8214';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 3;
    polygon(
      [
        [0, 22],
        [27, 51],
        [51, 3],
        [76, 51],
        [104, 22],
        [91, 85],
        [12, 85],
      ],
      '#ffc400',
    );
    for (const [a, b] of [
      [0, 22],
      [51, 3],
      [104, 22],
    ]) {
      ctx.beginPath();
      ctx.arc(a, b, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    round(10, 82, 84, 11, 4, '#ffbf00');
    ctx.restore();
  }
  function gear(x: number, y: number, color: string, dot: boolean) {
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowBlur = 4;
    ctx.shadowColor = '#6d688650';
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = color;
    for (let i = 0; i < 8; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI) / 4);
      round(-10, -49, 20, 30, 4, color);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 37, 0, Math.PI * 2);
    ctx.arc(0, 0, 23, 0, Math.PI * 2, true);
    ctx.fill();
    if (dot) {
      ctx.beginPath();
      ctx.arc(37, -35, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#ec2610';
      ctx.fill();
    }
    ctx.restore();
  }
  function border(time: number, amount: number, combo: number) {
    if (amount <= 0) return;
    ctx.save();
    ctx.globalAlpha = amount;
    const color = combo >= 3 ? '#ff8ce7' : '#82eeed';
    for (const [width, blur, a] of [
      [14, 40, 0.22],
      [5, 20, 0.7],
      [2, 3, 1],
    ]) {
      ctx.globalAlpha = amount * a;
      ctx.shadowColor = color;
      ctx.shadowBlur = blur;
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.roundRect(gx - 8, gy - 8, pitch * boardSize + 16, pitch * boardSize + 16, 11);
      ctx.stroke();
    }
    if (combo >= 3) {
      for (const yy of [gy - 20, gy + pitch * boardSize + 20]) {
        ctx.save();
        ctx.translate(540, yy);
        ctx.scale(1, 0.18);
        glow(0, 0, 420, '#ffc3ed65', amount * 0.4);
        ctx.restore();
      }
      ctx.globalAlpha = amount;
      for (let i = 0; i < 58; i++) {
        const side = i % 4,
          u = (i * 0.6180339 + time * 0.015) % 1,
          offset = 14 + Math.sin(i * 2.7 + time * 2) * 9;
        const x =
            side === 0
              ? gx - offset
              : side === 1
                ? gx + pitch * boardSize + offset
                : gx + u * pitch * boardSize,
          y =
            side === 2
              ? gy - offset
              : side === 3
                ? gy + pitch * boardSize + offset
                : gy + u * pitch * boardSize;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(4, 4);
        ctx.shadowColor = '#ffa0df';
        ctx.shadowBlur = 9;
        ctx.fillStyle = '#ffe5f8';
        ctx.beginPath();
        ctx.moveTo(0, 1);
        ctx.bezierCurveTo(-2, -0.2, -1, -1.9, 0, -0.7);
        ctx.bezierCurveTo(1, -1.9, 2, -0.2, 0, 1);
        ctx.fill();
        ctx.restore();
      }
    }
    if (combo < 3 || combo >= 10) {
      const lamp = combo >= 25 ? '#c7fa7b' : combo >= 10 ? '#ffe793' : '#a9fbff';
      ctx.globalAlpha = amount;
      for (let side = 0; side < 4; side++)
        for (let j = 0; j < 12; j++) {
          const q = (j + 0.5) / 12,
            x =
              side === 0
                ? gx - 23
                : side === 1
                  ? gx + pitch * boardSize + 23
                  : gx + q * pitch * boardSize,
            y =
              side === 2
                ? gy - 23
                : side === 3
                  ? gy + pitch * boardSize + 23
                  : gy + q * pitch * boardSize;
          glow(x, y, 23, lamp + 'a0');
          ctx.shadowColor = lamp;
          ctx.shadowBlur = 12;
          ctx.fillStyle = '#fffad6';
          ctx.beginPath();
          ctx.arc(x, y, 5.5, 0, Math.PI * 2);
          ctx.fill();
        }
    }
    ctx.restore();
  }
  function trophy(t: number) {
    ctx.save();
    ctx.globalAlpha = Math.sin(Math.PI * clamp(t / 1.4));
    ctx.fillStyle = '#0005';
    ctx.fillRect(0, 0, 1080, 1920);
    glow(540, 960, 370, '#ffd45070');
    ctx.translate(540, 950);
    ctx.strokeStyle = '#eeb62d';
    ctx.lineWidth = 23;
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sign * 115, -65, 75, 83, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const gold = ctx.createLinearGradient(-100, 0, 100, 0);
    gold.addColorStop(0, '#a86009');
    gold.addColorStop(0.5, '#ffe87f');
    gold.addColorStop(1, '#d48c11');
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.moveTo(-135, -175);
    ctx.lineTo(135, -175);
    ctx.quadraticCurveTo(132, 40, 20, 53);
    ctx.lineTo(20, 150);
    ctx.lineTo(85, 173);
    ctx.lineTo(-85, 173);
    ctx.lineTo(-20, 150);
    ctx.lineTo(-20, 53);
    ctx.quadraticCurveTo(-132, 40, -135, -175);
    ctx.fill();
    round(-95, 170, 190, 33, 8, '#d8911a');
    polygon(
      [
        [0, -133],
        [55, -105],
        [55, -49],
        [0, -18],
        [-55, -49],
        [-55, -105],
      ],
      '#ef7625',
    );
    ctx.restore();
  }
  return { polygon, round, text, praiseImage, praise, glow, crown, gear, border, trophy };
}
