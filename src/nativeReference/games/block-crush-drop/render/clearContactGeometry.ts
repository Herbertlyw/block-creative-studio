/** Rounded fragments use their conservative oriented box envelope here.
 * SAT overlap is exact for these boxes; response uses one shared contact point,
 * not a full clipped face manifold. No board/floor geometry participates. */
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];
export interface ClearContactBody {
  position: V3;
  quaternion: Q4;
  halfExtents: V3;
  radius: number;
  shape: 'sphere' | 'box';
  inverseMass: number;
  velocity: V3;
  angularVelocity: V3;
}
export interface ClearContact {
  normal: V3;
  point: V3;
  penetration: number;
}
export const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul3 = (a: V3, b: number): V3 => [a[0] * b, a[1] * b, a[2] * b];
export const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length3 = (v: V3) => Math.hypot(...v);
function axes(q: Q4): [V3, V3, V3] {
  const [x, y, z, w] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  ];
}
function closest(body: ClearContactBody, point: V3): V3 {
  const delta = sub3(point, body.position);
  let result = body.position;
  axes(body.quaternion).forEach((axis, k) => {
    result = add3(
      result,
      mul3(
        axis,
        Math.max(-body.halfExtents[k]!, Math.min(body.halfExtents[k]!, dot3(delta, axis))),
      ),
    );
  });
  return result;
}
function sphereBox(sphere: ClearContactBody, box: ClearContactBody): ClearContact | undefined {
  let point = closest(box, sphere.position),
    delta = sub3(point, sphere.position),
    distance = length3(delta);
  if (distance >= sphere.radius) return undefined;
  if (distance > 1e-9)
    return { normal: mul3(delta, 1 / distance), point, penetration: sphere.radius - distance };
  const local = sub3(sphere.position, box.position),
    basis = axes(box.quaternion);
  let depth = Infinity,
    normal: V3 = [1, 0, 0];
  basis.forEach((axis, k) => {
    const component = dot3(local, axis),
      gap = box.halfExtents[k]! - Math.abs(component);
    if (gap < depth) {
      depth = gap;
      normal = mul3(axis, component >= 0 ? -1 : 1);
    }
  });
  point = sub3(sphere.position, mul3(normal, depth));
  return { normal, point, penetration: sphere.radius + depth };
}
export function findClearContact(
  a: ClearContactBody,
  b: ClearContactBody,
): ClearContact | undefined {
  const boundA = a.shape === 'box' ? length3(a.halfExtents) : a.radius,
    boundB = b.shape === 'box' ? length3(b.halfExtents) : b.radius;
  if (length3(sub3(b.position, a.position)) >= boundA + boundB) return;
  if (a.shape === 'sphere' && b.shape === 'sphere') {
    const delta = sub3(b.position, a.position),
      distance = length3(delta),
      penetration = a.radius + b.radius - distance;
    if (penetration <= 0) return;
    const normal: V3 = distance > 1e-9 ? mul3(delta, 1 / distance) : [0, 0, 1];
    return {
      normal,
      point: add3(a.position, mul3(normal, a.radius - penetration * 0.5)),
      penetration,
    };
  }
  if (a.shape === 'sphere') return sphereBox(a, b);
  if (b.shape === 'sphere') {
    const c = sphereBox(b, a);
    return c ? { ...c, normal: mul3(c.normal, -1) } : undefined;
  }
  const aa = axes(a.quaternion),
    bb = axes(b.quaternion),
    delta = sub3(b.position, a.position);
  const broadA = length3(a.halfExtents),
    broadB = length3(b.halfExtents);
  if (length3(delta) >= broadA + broadB) return;
  let penetration = Infinity,
    normal: V3 = [0, 0, 1];
  const candidates = [...aa, ...bb, ...aa.flatMap((x) => bb.map((y) => cross3(x, y)))];
  for (const raw of candidates) {
    const length = length3(raw);
    if (length < 1e-8) continue;
    const n = mul3(raw, 1 / length);
    const ra = aa.reduce((sum, axis, k) => sum + a.halfExtents[k]! * Math.abs(dot3(axis, n)), 0),
      rb = bb.reduce((sum, axis, k) => sum + b.halfExtents[k]! * Math.abs(dot3(axis, n)), 0);
    const signed = dot3(delta, n),
      overlap = ra + rb - Math.abs(signed);
    if (overlap <= 0) return;
    if (overlap < penetration) {
      penetration = overlap;
      normal = mul3(n, signed < 0 ? -1 : 1);
    }
  }
  // Shared point keeps reaction torques balanced. Alternating closest points
  // selects one point in the intersection; this is not a multi-point manifold.
  let pa = closest(a, b.position),
    pb = closest(b, pa);
  pa = closest(a, pb);
  return { normal, point: mul3(add3(pa, pb), 0.5), penetration };
}
export function inverseInertia(body: ClearContactBody, v: V3): V3 {
  if (!body.inverseMass) return [0, 0, 0];
  if (body.shape === 'sphere') return mul3(v, (2.5 * body.inverseMass) / body.radius ** 2);
  const [x, y, z] = body.halfExtents,
    diagonal = [
      (3 * body.inverseMass) / (y * y + z * z),
      (3 * body.inverseMass) / (x * x + z * z),
      (3 * body.inverseMass) / (x * x + y * y),
    ];
  return axes(body.quaternion).reduce<V3>(
    (sum, axis, k) => add3(sum, mul3(axis, dot3(v, axis) * diagonal[k]!)),
    [0, 0, 0],
  );
}
export function inertia(body: ClearContactBody, v: V3): V3 {
  if (!body.inverseMass) return [0, 0, 0];
  if (body.shape === 'sphere') return mul3(v, (0.4 * body.radius ** 2) / body.inverseMass);
  const [x, y, z] = body.halfExtents,
    diagonal = [
      (y * y + z * z) / (3 * body.inverseMass),
      (x * x + z * z) / (3 * body.inverseMass),
      (x * x + y * y) / (3 * body.inverseMass),
    ];
  return axes(body.quaternion).reduce<V3>(
    (sum, axis, k) => add3(sum, mul3(axis, dot3(v, axis) * diagonal[k]!)),
    [0, 0, 0],
  );
}
export function clearContactImpulse(a: ClearContactBody, b: ClearContactBody, dt: number) {
  const contact = findClearContact(a, b);
  if (!contact) return;
  const ra = sub3(contact.point, a.position),
    rb = sub3(contact.point, b.position),
    n = contact.normal;
  const relative = sub3(
      add3(b.velocity, cross3(b.angularVelocity, rb)),
      add3(a.velocity, cross3(a.angularVelocity, ra)),
    ),
    vn = dot3(relative, n);
  const effective = (direction: V3) =>
    a.inverseMass +
    b.inverseMass +
    dot3(
      direction,
      add3(
        cross3(inverseInertia(a, cross3(ra, direction)), ra),
        cross3(inverseInertia(b, cross3(rb, direction)), rb),
      ),
    );
  const kn = effective(n);
  if (kn < 1e-10) return;
  const jn = Math.max(0, (180 * contact.penetration - 12 * vn) * dt) / kn;
  const tangent = sub3(relative, mul3(n, vn)),
    speed = length3(tangent),
    direction = speed > 1e-9 ? mul3(tangent, 1 / speed) : ([0, 0, 0] as V3);
  const jt = speed > 1e-9 ? Math.min(speed / Math.max(1e-9, effective(direction)), 0.2 * jn) : 0;
  const impulse = add3(mul3(n, jn), mul3(direction, -jt));
  return {
    contact,
    linearA: mul3(impulse, -a.inverseMass),
    linearB: mul3(impulse, b.inverseMass),
    angularA: inverseInertia(a, cross3(ra, mul3(impulse, -1))),
    angularB: inverseInertia(b, cross3(rb, impulse)),
  };
}
