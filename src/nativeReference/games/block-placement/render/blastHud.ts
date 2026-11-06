/** Kimik3 ZTC4F4273 HUD: crown 102×72 and gear 93×88, measured on 1080×1920. */

const TWO_PI = Math.PI * 2;

export const BLAST_CROWN = {
  width: 102,
  height: 72,
  balls: [
    { cx: 9, cy: 28, r: 9 },
    { cx: 51, cy: 9.5, r: 10 },
    { cx: 93, cy: 28, r: 9 },
  ],
  body: [
    [20, 63], [16, 48], [14, 43], [9, 35], [22, 37], [26, 41],
    [44, 18], [58, 18], [76, 41], [80, 37], [93, 35], [86, 43],
    [84, 48], [82, 63],
  ] as const,
  band: { x: 18, y: 64, right: 86, bottom: 72, radius: 4.5 },
} as const;

export const BLAST_GEAR = {
  width: 93,
  height: 88,
  cx: 51,
  cy: 45.7,
  tip: 41,
  ring: 31,
  hole: 18.5,
  toothWidth: 14,
  toothRadius: 4,
  teeth: 8,
} as const;

const GOLD_TOP = rgb(255, 214, 60);
const GOLD_MID = rgb(251, 183, 8);
const GOLD_BOT = rgb(242, 164, 8);
const BAND_TOP = rgb(248, 178, 20);
const BAND_BOT = rgb(233, 146, 26);
const BAND_RIM = rgb(253, 202, 48);
const GOLD_EDGE = rgb(196, 132, 18);
const SPEC = rgb(255, 240, 150);
const SHADOW = 'rgba(42,36,88,0.38)';

const ICE_TOP = rgb(214, 247, 255);
const ICE_BOT = rgb(178, 218, 249);
const ICE_RIM_HI = rgb(230, 252, 255);
const ICE_RIM_LO = rgb(148, 188, 226);

function rgb(red: number, green: number, blue: number): string {
  return `rgb(${red},${green},${blue})`;
}

function appendRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function appendCrownSilhouette(context: CanvasRenderingContext2D, x: number, y: number): void {
  for (const ball of BLAST_CROWN.balls) {
    context.moveTo(x + ball.cx + ball.r, y + ball.cy);
    context.arc(x + ball.cx, y + ball.cy, ball.r, 0, TWO_PI);
  }
  const [first, ...rest] = BLAST_CROWN.body;
  context.moveTo(x + first[0], y + first[1]);
  for (const point of rest) context.lineTo(x + point[0], y + point[1]);
  context.closePath();
  const band = BLAST_CROWN.band;
  appendRoundedRect(context, x + band.x, y + band.y, band.right - band.x, band.bottom - band.y, band.radius);
}

export function paintBlastCrown(context: CanvasRenderingContext2D, x: number, y: number): void {
  const { band } = BLAST_CROWN;
  context.save();
  context.shadowColor = SHADOW;
  context.shadowBlur = 1.6;
  context.shadowOffsetY = 2;
  context.beginPath();
  appendCrownSilhouette(context, x, y);
  const gold = context.createLinearGradient(x, y + 8, x, y + 64);
  gold.addColorStop(0, GOLD_TOP);
  gold.addColorStop(0.5, GOLD_MID);
  gold.addColorStop(1, GOLD_BOT);
  context.fillStyle = gold;
  context.fill();
  context.shadowColor = 'transparent';

  context.save();
  context.beginPath();
  appendRoundedRect(context, x + band.x, y + band.y, band.right - band.x, band.bottom - band.y, band.radius);
  context.clip();
  const bandFill = context.createLinearGradient(x, y + band.y, x, y + band.bottom);
  bandFill.addColorStop(0, BAND_TOP);
  bandFill.addColorStop(1, BAND_BOT);
  context.fillStyle = bandFill;
  context.fillRect(x + band.x, y + band.y, band.right - band.x, band.bottom - band.y);
  context.fillStyle = BAND_RIM;
  context.globalAlpha = 0.6;
  context.fillRect(x + band.x, y + band.y, band.right - band.x, 1.6);
  context.restore();

  context.beginPath();
  appendCrownSilhouette(context, x, y);
  context.strokeStyle = GOLD_EDGE;
  context.lineWidth = 1.1;
  context.stroke();

  for (const ball of BLAST_CROWN.balls) {
    context.beginPath();
    context.ellipse(
      x + ball.cx - ball.r * 0.18,
      y + ball.cy - ball.r * 0.32,
      ball.r * 0.24,
      ball.r * 0.22,
      -0.4,
      0,
      TWO_PI,
    );
    context.fillStyle = SPEC;
    context.globalAlpha = 0.85;
    context.fill();
    context.globalAlpha = 1;
  }
  context.restore();
}

function appendGearTeeth(context: CanvasRenderingContext2D, x: number, y: number): void {
  const { cx, cy, tip, ring, toothWidth, toothRadius, teeth } = BLAST_GEAR;
  const originX = x + cx;
  const originY = y + cy;
  const toothLength = tip - (ring - 5);
  for (let index = 0; index < teeth; index += 1) {
    context.save();
    context.translate(originX, originY);
    context.rotate((index / teeth) * TWO_PI);
    appendRoundedRect(context, -toothWidth / 2, -tip, toothWidth, toothLength, toothRadius);
    context.restore();
  }
}

export function paintBlastGear(context: CanvasRenderingContext2D, x: number, y: number): void {
  const { cx, cy, tip, ring, hole } = BLAST_GEAR;
  const originX = x + cx;
  const originY = y + cy;
  const ice = context.createLinearGradient(x, y + cy - tip, x, y + cy + tip);
  ice.addColorStop(0, ICE_TOP);
  ice.addColorStop(1, ICE_BOT);
  const rim = context.createLinearGradient(x, y + cy - tip, x, y + cy + tip);
  rim.addColorStop(0, ICE_RIM_HI);
  rim.addColorStop(1, ICE_RIM_LO);

  context.save();
  context.beginPath();
  appendGearTeeth(context, x, y);
  context.fillStyle = ice;
  context.fill();
  context.strokeStyle = rim;
  context.lineWidth = 1.1;
  context.stroke();

  context.beginPath();
  context.arc(originX, originY, ring, 0, TWO_PI);
  context.moveTo(originX + hole, originY);
  context.arc(originX, originY, hole, 0, TWO_PI, true);
  context.fillStyle = ice;
  context.fill();
  context.strokeStyle = rim;
  context.stroke();
  context.restore();
}
