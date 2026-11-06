// Derived production module; supplied reference files remain unchanged.
const sat = (v: number) => Math.max(0, Math.min(1, v));
/** Separated narrow italic word and larger number; entry stays native and seekable. */
export function measuredComboPhase(age: number) {
  return {
    word: sat(age / 0.24),
    number: sat((age - 0.16) / 0.15),
    numberScale: 1 + 0.32 * (1 - sat((age - 0.16) / 0.2)),
  };
}
export function drawMeasuredCombo(
  ctx: CanvasRenderingContext2D,
  combo: number,
  age: number,
  x: number,
  y: number,
  geometry: { width: number; height: number; palette?: string },
) {
  const warm = geometry.palette === 'amber',
    phase = measuredComboPhase(age),
    digits = String(combo),
    word = 'Combo',
    size = 110,
    digitSize = 165;
  if (!warm) {
    phase.number = sat((age - 0.09) / 0.1);
    phase.numberScale = 1 + 0.32 * (1 - sat((age - 0.09) / 0.2));
  }
  ctx.save();
  ctx.font = `italic 700 ${size}px Arial,sans-serif`;
  const ww = ctx.measureText(word).width;
  ctx.font = `italic 700 ${digitSize}px Arial,sans-serif`;
  const dw = ctx.measureText(digits).width,
    total = ww + dw + 6;
  ctx.translate(x, y);
  ctx.scale(geometry.width / (total + 16), geometry.height / 158);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const yy = 50,
    left = -total / 2;
  if (age < 0.34) {
    ctx.save();
    ctx.globalAlpha *= 1 - sat((age - 0.15) / 0.19);
    ctx.strokeStyle = warm ? '#fff1b3' : '#d8f7ff';
    ctx.lineWidth = 3;
    for (const [yy, off, len] of [
      [-10, 40, 100],
      [70, 90, 85],
      [-35, 190, 35],
    ]) {
      ctx.beginPath();
      ctx.moveTo(left + off, yy);
      ctx.lineTo(left + off + len, yy);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (!warm && age > 0.08 && age < 0.48) {
    ctx.save();
    ctx.globalAlpha *= sat((age - 0.08) / 0.06) * (1 - sat((age - 0.22) / 0.26));
    ctx.translate(left + ww + dw / 2 + 5, 0);
    ctx.shadowColor = '#fff167';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = '#fff692';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3 + 0.28,
        xx = Math.cos(angle) * 87,
        yy = Math.sin(angle) * 87;
      i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(left - 12, -115, (ww + 24) * phase.word, 200);
  ctx.clip();
  ctx.font = `italic 700 ${size}px Arial,sans-serif`;
  ctx.lineWidth = 12;
  ctx.strokeStyle = warm ? '#95520d' : '#243676';
  ctx.shadowColor = warm ? '#fcb84a' : '#849cee';
  ctx.shadowBlur = 7;
  ctx.strokeText(word, left, yy);
  ctx.shadowBlur = 0;
  ctx.fillStyle = warm ? '#fff0bb' : '#d5f5ff';
  ctx.fillText(word, left, yy);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha *= phase.number;
  ctx.translate(left + ww + dw / 2 + 5, yy - 50);
  ctx.scale(phase.numberScale, phase.numberScale);
  ctx.font = `italic 700 ${digitSize}px Arial,sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 12;
  ctx.strokeStyle = warm ? '#a26113' : '#344089';
  ctx.shadowBlur = 6;
  ctx.shadowColor = warm ? '#b47613' : '#b5a9e9';
  ctx.strokeText(digits, 0, 50);
  ctx.shadowBlur = 0;
  ctx.fillStyle = warm ? '#ffdc6b' : '#fff037';
  ctx.fillText(digits, 0, 50);
  ctx.restore();
  ctx.restore();
}
