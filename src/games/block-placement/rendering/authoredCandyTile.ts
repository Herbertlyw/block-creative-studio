import {
  BLAST_FACE_GEOMETRY,
  type BlastFaceSwatch,
  type BlastRgb,
} from '../../../nativeReference/reference2d/referenceProfile';

function rgb(red: number, green: number, blue: number): string {
  return `rgb(${Math.round(red)},${Math.round(green)},${Math.round(blue)})`;
}

function rgbFrom(color: BlastRgb, scale = 1): string {
  return rgb(
    Math.min(255, Math.max(0, color[0] * scale)),
    Math.min(255, Math.max(0, color[1] * scale)),
    Math.min(255, Math.max(0, color[2] * scale)),
  );
}

function fillTrapezoid(
  context: CanvasRenderingContext2D,
  points: ReadonlyArray<readonly [number, number]>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  start: string,
  end: string,
): void {
  const gradient = context.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, start);
  gradient.addColorStop(1, end);
  context.beginPath();
  const origin = points[0];
  if (!origin) return;
  context.moveTo(origin[0], origin[1]);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point) context.lineTo(point[0], point[1]);
  }
  context.closePath();
  context.fillStyle = gradient;
  context.fill();
}

/** Kimik3 ZTC4F4273 painter: sharp square, 2px outline, 17px 45° bevels, 3-stop face. */
export function paintCandyBlastTile(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  swatch: BlastFaceSwatch,
): void {
  if (size <= 1) return;
  const scale = size / BLAST_FACE_GEOMETRY.unitPx;
  const outline = Math.max(0.5, BLAST_FACE_GEOMETRY.outlinePx * scale);
  const bevel = Math.max(1, BLAST_FACE_GEOMETRY.bevelPx * scale);
  const inner = size - outline * 2;
  const faceSize = inner - bevel * 2;

  context.fillStyle = rgbFrom(swatch.outline);
  context.fillRect(x, y, size, size);
  if (inner <= 1) return;

  const ox = x + outline;
  const oy = y + outline;
  const right = ox + inner;
  const bottom = oy + inner;

  context.save();
  context.beginPath();
  context.rect(ox, oy, inner, inner);
  context.clip();

  if (faceSize <= 1) {
    context.fillStyle = rgbFrom(swatch.faceMid);
    context.fillRect(ox, oy, inner, inner);
    context.restore();
    return;
  }

  const fx = ox + bevel;
  const fy = oy + bevel;
  const faceRight = fx + faceSize;
  const faceBottom = fy + faceSize;

  fillTrapezoid(
    context,
    [
      [ox, oy],
      [fx, fy],
      [fx, faceBottom],
      [ox, bottom],
    ],
    ox,
    oy,
    fx,
    oy,
    rgbFrom(swatch.bevelLeft, 1.02),
    rgbFrom(swatch.bevelLeft, 0.95),
  );
  fillTrapezoid(
    context,
    [
      [right, oy],
      [right, bottom],
      [faceRight, faceBottom],
      [faceRight, fy],
    ],
    faceRight,
    oy,
    right,
    oy,
    rgbFrom(swatch.bevelRight),
    rgbFrom(swatch.bevelRight, 0.72),
  );
  fillTrapezoid(
    context,
    [
      [ox, oy],
      [right, oy],
      [faceRight, fy],
      [fx, fy],
    ],
    ox,
    oy,
    ox,
    fy,
    rgbFrom(swatch.bevelTop, 0.985),
    rgbFrom(swatch.bevelTop, 1.02),
  );
  fillTrapezoid(
    context,
    [
      [ox, bottom],
      [right, bottom],
      [faceRight, faceBottom],
      [fx, faceBottom],
    ],
    ox,
    faceBottom,
    ox,
    bottom,
    rgbFrom(swatch.bevelBottom),
    rgbFrom(swatch.bevelBottom, 0.78),
  );

  const face = context.createLinearGradient(fx, fy, fx, faceBottom);
  face.addColorStop(0, rgbFrom(swatch.faceTop));
  face.addColorStop(0.5, rgbFrom(swatch.faceMid));
  face.addColorStop(1, rgbFrom(swatch.faceBottom));
  context.fillStyle = face;
  context.fillRect(fx, fy, faceSize, faceSize);
  context.restore();
}
