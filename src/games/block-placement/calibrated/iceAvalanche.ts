// Derived production module; supplied reference files remain unchanged.
type Point = [number, number];
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const noise = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const cache = new Map<number, Point[][]>();
/** A seeded Voronoi partition covers the complete face without rectangular cracks. */
export function iceFractureCells(seed: number): Point[][] {
  const cached = cache.get(seed);
  if (cached) return cached;
  const sites: Point[] = [];
  for (let i = 0; sites.length < 8 && i < 500; i++) {
    const p: Point = [noise(seed + i * 7) - 0.5, noise(seed + i * 7 + 1) - 0.5];
    if (sites.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.19)) sites.push(p);
  }
  const cells = sites.map((a, i) => {
    let poly: Point[] = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ];
    for (let j = 0; j < sites.length; j++) {
      if (i === j) continue;
      const b = sites[j],
        nx = b[0] - a[0],
        ny = b[1] - a[1],
        limit = (b[0] * b[0] + b[1] * b[1] - a[0] * a[0] - a[1] * a[1]) / 2,
        out: Point[] = [];
      for (let k = 0; k < poly.length; k++) {
        const p = poly[k],
          q = poly[(k + 1) % poly.length],
          dp = p[0] * nx + p[1] * ny - limit,
          dq = q[0] * nx + q[1] * ny - limit;
        if (dp <= 0) out.push(p);
        if (dp <= 0 !== dq <= 0) {
          const u = dp / (dp - dq);
          out.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]);
        }
      }
      poly = out;
    }
    return poly;
  });
  cache.set(seed, cells);
  return cells;
}
export function avalanchePose(age: number, seed: number, pitch: number) {
  const t = Math.max(0, age - 0.11),
    depth = noise(seed + 4);
  return {
    x: (noise(seed) - 0.5) * pitch * 8 * t,
    y: pitch * ((noise(seed + 1) - 0.85) * 4 * t + (7 + depth * 42) * t * t),
    rotation: (noise(seed + 2) - 0.5) * t * 12,
    scale: 1 + depth * t * 6.5,
    alpha: 1 - clamp((age - 0.58) / 0.18),
  };
}
function path(ctx: CanvasRenderingContext2D, points: Point[], pitch: number, ox = 0, oy = 0) {
  ctx.beginPath();
  points.forEach(([x, y], i) =>
    i ? ctx.lineTo(x * pitch + ox, y * pitch + oy) : ctx.moveTo(x * pitch + ox, y * pitch + oy),
  );
  ctx.closePath();
}
function shades(hex: string) {
  const v = hex.match(/[a-f0-9]{2}/gi)?.map((x) => parseInt(x, 16)) ?? [50, 130, 245];
  const [r, g, b] = v;
  if (r > b * 1.2 && g > b * 1.2 && g > r * 0.7)
    return ['#92512a', '#fab248', '#ffe8a0', '#fff8d9'];
  if (r > b * 1.2 && r > g * 1.2) return ['#b90b13', '#f13d32', '#ff8570', '#ffd0c3'];
  if (g > r * 1.2 && g > b * 0.9) return ['#075800', '#39c300', '#83eb20', '#e3ffbe'];
  if (r > b * 1.2 && g > b * 1.2) return ['#92512a', '#fab248', '#ffe8a0', '#fff8d9'];
  if (r > g * 1.1 && b > g * 1.1) return ['#462293', '#9852f2', '#dfbaff', '#f7e7ff'];
  return ['#004dda', '#087fff', '#42beff', '#b1ebff'];
}
type Vertex = [number, number, number];
/** A bevelled prism is projected in 3D, so each shard keeps visible thickness as it turns. */
function crystal(
  ctx: CanvasRenderingContext2D,
  poly: Point[],
  pitch: number,
  seed: number,
  age: number,
  colors: string[],
) {
  const ax =
      (noise(seed + 21) - 0.5) * 1.2 + Math.max(0, age - 0.14) * (noise(seed + 22) - 0.5) * 7,
    ay = (noise(seed + 23) - 0.5) * 1.5 + Math.max(0, age - 0.14) * (noise(seed + 24) - 0.5) * 8;
  const rotate = ([x, y, z]: Vertex): Vertex => {
    const yy = y * Math.cos(ax) - z * Math.sin(ax),
      zz = y * Math.sin(ax) + z * Math.cos(ax);
    return [x * Math.cos(ay) + zz * Math.sin(ay), yy, -x * Math.sin(ay) + zz * Math.cos(ay)];
  };
  const xs = poly.map((p) => p[0]),
    ys = poly.map((p) => p[1]);
  const rx = Math.max(0.13, (Math.max(...xs) - Math.min(...xs)) * 0.47),
    ry = Math.max(0.13, (Math.max(...ys) - Math.min(...ys)) * 0.47),
    rz = Math.sqrt(rx * ry) * 0.88;
  const ring = (scale: number, z: number, phase: number) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = (i * Math.PI) / 3 + phase,
        r = scale * (0.84 + noise(seed + i * 3 + 41) * 0.28);
      return rotate([Math.cos(a) * rx * r, Math.sin(a) * ry * r, z * rz]);
    });
  const front = ring(0.64, 0.8, 0.05),
    rim = ring(1, 0, 0),
    back = ring(0.66, -0.76, -0.04);
  const top = rotate([rx * 0.06, ry * -0.08, rz]),
    bottom = rotate([-rx * 0.06, ry * 0.06, -rz]);
  const faces: Vertex[][] = [];
  for (let k = 0; k < 6; k++) {
    const j = (k + 1) % 6;
    faces.push(
      [top, front[k], front[j]],
      [front[k], rim[k], rim[j], front[j]],
      [rim[k], back[k], back[j], rim[j]],
      [bottom, back[j], back[k]],
    );
  }
  const rgb = (hex: string) => hex.match(/[a-f0-9]{2}/gi)!.map((x) => parseInt(x, 16)),
    dark = rgb(colors[0]),
    light = rgb(colors[2]);
  faces.sort(
    (a, b) =>
      a.reduce((v, p) => v + p[2], 0) / a.length - b.reduce((v, p) => v + p[2], 0) / b.length,
  );
  for (const face of faces) {
    const a = face[0],
      u = face[1].map((v, i) => v - a[i]),
      v = face[2].map((v, i) => v - a[i]);
    const normal = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ],
      len = Math.hypot(...normal) || 1;
    // Light from above-left. Deeper faces stay saturated rather than becoming grey sheets.
    const diffuse = Math.max(0, (-normal[0] * 0.35 - normal[1] * 0.55 + normal[2] * 0.76) / len),
      brightness = 0.07 + 0.93 * diffuse;
    const c = dark.map((d, i) => Math.round(d + (light[i] - d) * brightness));
    path(
      ctx,
      face.map(([x, y, z]) => [x * (1 + z * 0.16), y * (1 + z * 0.16)] as Point),
      pitch,
    );
    ctx.fillStyle = `rgb(${c.join(',')})`;
    ctx.fill();
  }
}
/** Dense faceted ice, cracked in place first, then scattered into a downward avalanche. */
export function drawIceAvalanche(h: any, st: any, age: number, time: number, board: any[][]) {
  if (age < 0) return;
  const { ctx, gx, gy, pitch } = h;
  const face = Object.values(st.placedColors ?? {})[0] ?? st.piece.color;
  const colors = shades(h.faceColor?.(face) ?? '#408fee');
  const vertical = st.clear.cols.length > 0 && st.clear.rows.length === 0;
  const centerX =
    st.clear.cells.reduce((s: number, c: any) => s + c.col + 0.5, 0) / st.clear.cells.length;
  const centerY =
    st.clear.cells.reduce((s: number, c: any) => s + c.row + 0.5, 0) / st.clear.cells.length;
  for (const [index, cell] of st.clear.cells.entries()) {
    const polygons = iceFractureCells((index % 13) * 37 + 11);
    for (let layer = 0; layer < 3; layer++)
      for (let j = 0; j < polygons.length; j++) {
        const seed = index * 137 + j * 11 + layer * 457,
          p = avalanchePose(age, seed, pitch);
        if (p.alpha <= 0) continue;
        const poly = polygons[j],
          mx = poly.reduce((s, q) => s + q[0], 0) / poly.length,
          my = poly.reduce((s, q) => s + q[1], 0) / poly.length;
        const points = poly.map(([x, y]) => [(x - mx) * 1.6, (y - my) * 1.6] as Point),
          thick = pitch * (0.08 + 0.04 * noise(seed + 9));
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(
          gx +
            (centerX + (cell.col + 0.5 + mx - centerX) * 1.22) * pitch +
            p.x * (vertical ? 1.4 : 1),
          gy +
            (centerY + (cell.row + 0.5 + my - centerY) * (vertical ? 1.4 : 2.7)) * pitch +
            p.y -
            (vertical ? 0 : Math.max(0, 2.5 - centerY) * pitch * clamp(age / 0.12)),
        );
        ctx.rotate(p.rotation);
        ctx.scale(p.scale, p.scale);
        crystal(ctx, points, pitch, seed, age, colors);
        ctx.restore();
      }
  }
}
