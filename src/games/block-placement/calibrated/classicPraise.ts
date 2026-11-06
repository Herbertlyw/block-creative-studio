// Derived production module; supplied reference files remain unchanged.
const sat = (n: number) => Math.max(0, Math.min(1, n));
/** Rounded, outlined typography measured from the short grey reference family. */
export function drawClassicPraise(
  ctx: CanvasRenderingContext2D,
  label: string,
  combo: number,
  age: number,
  x: number,
  y: number,
  red = false,
  geometry?: { width: number; height: number; palette?: string; digitScale?: number },
) {
  const isCombo = /^Combo/i.test(label),
    digits = isCombo && /\d/.test(label) ? String(combo) : '';
  const pal = geometry?.palette,
    cream = pal === 'cream-mint',
    winged = pal === 'winged',
    violet = pal === 'violet',
    silver = pal === 'silver-lime',
    yellow = pal === 'yellow' || (red && /^Great/i.test(label)),
    warm = pal === 'coral-gold' || (!pal && isCombo && combo >= 4);
  red = red || pal === 'rose';
  const amber = pal === 'amber',
    banner = pal === 'purple-banner';
  const edge = amber
      ? '#ca731d'
      : banner
        ? '#752899'
        : cream
          ? '#27594d'
          : pal === 'cyan-rose'
            ? '#b1386f'
            : violet
              ? '#66269e'
              : winged
                ? '#466abd'
                : silver
                  ? '#515c78'
                  : red
                    ? yellow
                      ? '#7a60bf'
                      : '#bd334c'
                    : warm
                      ? '#c7472d'
                      : '#176cb5',
    outer = amber
      ? '#fffbe7'
      : banner
        ? '#ffb9f2'
        : cream
          ? '#aac781'
          : pal === 'cyan-rose'
            ? '#ed92b9'
            : violet
              ? '#f4d7ff'
              : winged
                ? '#fff6ec'
                : silver
                  ? '#d6e0f4'
                  : red
                    ? yellow
                      ? '#fff1a1'
                      : '#ff657a'
                    : warm
                      ? '#ffd1b1'
                      : '#d2fbff';
  const word = isCombo ? 'Combo' : label.replace(/[.!]+$/, '!');
  const size = isCombo ? 130 : 105;
  ctx.save();
  ctx.translate(x, y);
  const pop = geometry ? 1 : 0.48 + 0.52 * Math.sin(Math.PI * 0.5 * sat(age / 0.13));
  ctx.scale(pop, pop);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.font = `${isCombo ? 'italic ' : ''}900 ${size}px "Arial Rounded MT Bold",Arial,sans-serif`;
  const wordWidth = ctx.measureText(word).width,
    digitSize =
      geometry && digits
        ? Math.max(
            165,
            Math.min(
              350,
              ((geometry.height / geometry.width) * (wordWidth + 17)) /
                Math.max(
                  0.12,
                  0.79 - (geometry.height / geometry.width) * (digits.length * 0.58 + 0.25),
                ),
            ),
          )
        : 165;
  ctx.font = `${isCombo ? 'italic ' : ''}900 ${digitSize}px "Arial Rounded MT Bold",Arial,sans-serif`;
  const digitWidth = digits ? ctx.measureText(digits).width : 0,
    totalWidth = wordWidth + digitWidth + 17;
  if (geometry)
    ctx.scale(
      geometry.width / totalWidth,
      geometry.height / (digits ? digitSize * 0.84 + 17 : size * 0.79 + 17),
    );
  if (banner) {
    ctx.save();
    ctx.shadowColor = '#a83feb';
    ctx.shadowBlur = 16;
    const g = ctx.createLinearGradient(-wordWidth * 0.56, 0, wordWidth * 0.56, 0);
    g.addColorStop(0, '#7f20d077');
    g.addColorStop(0.2, '#9534dcee');
    g.addColorStop(0.8, '#9534dcee');
    g.addColorStop(1, '#7f20d077');
    ctx.fillStyle = g;
    ctx.fillRect(-wordWidth * 0.56, -size * 0.45, wordWidth * 1.12, size * 0.9);
    ctx.restore();
  }
  if (digits && combo >= 3) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const cx = wordWidth / 2 + digitSize * 0.15,
      g = ctx.createRadialGradient(cx, 0, 6, cx, 0, 115);
    g.addColorStop(0, '#ffed7899');
    g.addColorStop(1, '#ffcb0000');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 115, -115, 230, 230);
    ctx.restore();
  }
  if (pal === 'blue-sun' && digits) {
    ctx.save();
    ctx.translate(wordWidth / 2 + digitSize * 0.15, 0);
    ctx.strokeStyle = '#ffee83';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#fff877';
    ctx.shadowBlur = 10;
    for (let i = 0; i < 18; i++) {
      const a = (i * Math.PI) / 9 + age * 0.3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 80, Math.sin(a) * 80);
      ctx.lineTo(Math.cos(a) * (105 + (i % 3) * 15), Math.sin(a) * (105 + (i % 3) * 15));
      ctx.stroke();
    }
    ctx.restore();
  }
  if (winged) {
    ctx.save();
    ctx.shadowColor = '#a6b8ff';
    ctx.shadowBlur = 16;
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#d4c8ff';
    for (const sign of [-1, 1]) {
      ctx.save();
      ctx.translate(sign * (wordWidth / 2 + 30), 5);
      ctx.scale(sign, 1);
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = k === 0 ? '#ffffff' : '#e9cfff';
        ctx.beginPath();
        ctx.moveTo(0, 15);
        ctx.quadraticCurveTo(70, -10 - k * 13, 85, -65 + k * 18);
        ctx.quadraticCurveTo(25, -35 + k * 16, -8, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.beginPath();
    ctx.moveTo(-wordWidth * 0.6, 65);
    ctx.lineTo(wordWidth * 0.6, 65);
    ctx.stroke();
    ctx.restore();
  }
  const offset = -digitWidth / 2;
  const draw = (s: string, xx: number, sz: number, isDigit = false) => {
    ctx.font = `${isCombo ? 'italic ' : ''}900 ${sz}px "Arial Rounded MT Bold",Arial,sans-serif`;
    ctx.shadowOffsetY = 6;
    ctx.shadowBlur = 6;
    ctx.shadowColor = warm ? '#853c3299' : '#14345b99';
    ctx.lineWidth = 17;
    ctx.strokeStyle = isDigit && violet ? '#bb7424' : edge;
    ctx.strokeText(s, xx, 0);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = 7;
    ctx.strokeStyle = isDigit && violet ? '#fff1bf' : outer;
    ctx.strokeText(s, xx, 0);
    const fill = ctx.createLinearGradient(0, -sz * 0.4, 0, sz * 0.4);
    fill.addColorStop(
      0,
      amber
        ? '#fffac4'
        : banner
          ? '#ffffff'
          : cream
            ? isDigit
              ? '#edffc1'
              : '#fff6d5'
            : isDigit && violet
              ? '#ffffc4'
              : violet
                ? '#ffffff'
                : winged
                  ? '#ff72b6'
                  : isDigit || yellow
                    ? '#fffeb0'
                    : red
                      ? '#ff627a'
                      : '#ffffff',
    );
    fill.addColorStop(
      1,
      amber
        ? '#ffb336'
        : banner
          ? '#ef74e7'
          : cream
            ? isDigit
              ? '#b3dc70'
              : '#f7d7a2'
            : isDigit && violet
              ? '#ffc94b'
              : pal === 'cyan-rose'
                ? '#a1e6ef'
                : violet
                  ? '#edb9ff'
                  : winged
                    ? '#ffdf59'
                    : isDigit && silver
                      ? '#b0de40'
                      : isDigit || yellow
                        ? '#ffe533'
                        : red
                          ? '#ff3458'
                          : warm
                            ? '#ffc3b4'
                            : silver
                              ? '#ecebff'
                              : '#43c4f5',
    );
    ctx.fillStyle = fill;
    ctx.fillText(s, xx, 0);
  };
  draw(word, offset, size);
  if (digits) draw(digits, wordWidth / 2, digitSize * (geometry?.digitScale ?? 1), true);
  ctx.restore();
}
