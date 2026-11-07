import {
  clearContactImpulse,
  inverseInertia,
  inertia as contactInertia,
  type ClearContactBody,
  type V3,
} from './clearContactGeometry';
/** Fixed-step, causal fragment dynamics. Positions are logical screen cells,
 * y points upwards; the board is behind this layer and the bottom is an exit.
 * The default solver contacts one cue; opt-in scheduled worlds also exchange
 * compliant contact impulses across cues. Rotating spheres remain proxies. */
/** Spatial keyframes; at is a normalized left-to-right column coordinate.
 * Both times are absolute offsets from cue start, in canonical 30 fps frames. */
export interface ClearPhysicsReleaseSegment {
  at: number;
  releaseFrame: number;
  detachFrame: number;
}
export interface ClearPhysicsProfile {
  gravity: number;
  /** Cue-local canonical30fps smooth external-force transition; independent of lifetime. */
  gravityEnvelope?: { startFrame: number; transitionFrames: number; targetGravity: number };
  damping: number;
  releaseFrontFrames: number;
  bondLifetimeFrames: number;
  radius: number;
  restitution: number;
  observationStrength: number;
  releaseSegments?: ClearPhysicsReleaseSegment[];
  /** Canonical frames over which a local bond loses its constraint force. */
  bondReleaseDurationFrames?: number;
  /** XPBD compliance (seconds squared for unit mass); zero retains legacy stiffness. */
  bondCompliance?: number;
  /** Equal/opposite impulses for paired fragment rows after local bond release. */
  separationSpeed?: number;
  /** Blend uniform splitting toward fixed material-grain signed central impulses. */
  separationVariation?: number;
  /** Opt-in cloth-like second-neighbour bending compliance, in s²/unit mass. */
  meshBendCompliance?: number;
  /** Fractional stretch above which a released structural edge starts tearing. */
  meshBreakStrain?: number;
  /** Canonical frames of persistent strain needed to tear an edge. */
  meshBreakFrames?: number;
  /** Minimum canonical frames after both nodes release before strain tearing. */
  meshTearDelayFrames?: number;
  /** Bounded orientation spring in radians/s²; zero leaves inertial spin alone. */
  meshAngularStiffness?: number;
  /** Local surviving-edge angular softening after its latest node release. */
  meshAngularRelease?: { holdFrames: number; fadeFrames: number; targetStiffness: number };
  /** Elastic support fades between local visible release and complete detach. */
  meshAnchorStiffness?: number;
  /** Elastic local attachment points couple translation and rotation (volume mesh only). */
  meshAttachmentStiffness?: number;
  /** Fraction of broken attachment elastic energy returned as a single recoil. */
  meshFractureEnergyRetention?: number;
  /** Participate in the compiled event world's shared contact field. */
  sharedContact?: boolean;
  /** Genuine physical depth layers; each node has mass 1 / depthLayers. */
  depthLayers?: 1 | 2;
  /** Per-axis multipliers for the one-time release angular impulse, not pose keys. */
  releaseSpinScale?: [number, number, number];
  /** Equal/opposite internal fracture spin, rad/s per front/back pair. */
  fractureSpinSpeed?: number;
  /** Static material grain identity, never a frame-wise noise or pose source. */
  materialSeed?: number;
  /** Rotating box envelopes with compliant single-point contacts; default sphere. */
  contactShape?: 'sphere' | 'box';
  /** Permit existing bounded contacts between released connected box fragments. */
  bondedContact?: boolean;
}
export interface ClearPhysicsSeed {
  id: string;
  x: number;
  y: number;
  column: number;
  row: number;
  z?: number;
  layer?: number;
}
export interface ClearPhysicsObservation {
  frame: number;
  tracks: Array<[number, number, number]>;
}
export interface ClearPhysicsPose {
  x: number;
  y: number;
  z: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  angularVelocity: [number, number, number];
  releaseAge: number;
}
export interface ClearPhysicsInput {
  seeds: ClearPhysicsSeed[];
  columns: number;
  elapsedSeconds: number;
  riseSpeed: number;
  profile: ClearPhysicsProfile;
  observations?: ClearPhysicsObservation[];
  /** Actual rendered cube dimensions in logical cells (depth is 0.9 × width). */
  fragmentSize?: { baseScale: number; releaseGrowthScale: number };
}
const DT = 1 / 120,
  STRIDE = 16;
const smooth = (v: number) => {
  const q = Math.max(0, Math.min(1, v));
  return q * q * (3 - 2 * q);
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
type Track = Array<{ t: number; x: number; y: number; vx: number; vy: number }>;
interface Simulation {
  state: Float64Array;
  snapshots: Float64Array[];
  release: number[];
  detach: number[];
  bonds: Array<[number, number, number]>;
  tracks: Map<number, Track>;
  broken: Set<number>;
  strainAge: Float64Array;
  structuralCount: number;
  bendSupports: Map<number, number[]>;
  lattice: Map<string, number>;
}
const cache = new Map<string, Simulation>();
const observationIds = new WeakMap<object, number>();
let nextObservationId = 1;
function keyFor(input: ClearPhysicsInput) {
  let id = 0;
  if (input.observations) {
    id = observationIds.get(input.observations) ?? nextObservationId++;
    observationIds.set(input.observations, id);
  }
  return JSON.stringify([
    input.seeds.map((s) => [
      s.id,
      Math.round(s.x * 1e5),
      Math.round(s.y * 1e5),
      s.column,
      s.row,
      s.z ?? 0,
      s.layer ?? 0,
    ]),
    input.columns,
    input.riseSpeed,
    input.profile,
    input.fragmentSize,
    id,
  ]);
}
function releaseTimes(input: ClearPhysicsInput, column: number): [number, number] {
  const at = column / Math.max(1, input.columns - 1),
    schedule = input.profile.releaseSegments;
  if (!schedule?.length) {
    const release = input.profile.releaseFrontFrames * at;
    return [release / 30, (release + input.profile.bondLifetimeFrames) / 30];
  }
  let left = schedule[0]!,
    right = left;
  for (const segment of schedule) {
    right = segment;
    if (segment.at >= at) break;
    left = segment;
  }
  const f = right.at > left.at ? clamp((at - left.at) / (right.at - left.at), 0, 1) : 0;
  return [
    (left.releaseFrame + (right.releaseFrame - left.releaseFrame) * f) / 30,
    (left.detachFrame + (right.detachFrame - left.detachFrame) * f) / 30,
  ];
}
function create(input: ClearPhysicsInput): Simulation {
  const state = new Float64Array(input.seeds.length * STRIDE),
    release: number[] = [],
    detach: number[] = [],
    bonds: Array<[number, number, number]> = [];
  const lookup = new Map(input.seeds.map((s, i) => [`${s.column}:${s.row}:${s.layer ?? 0}`, i]));
  input.seeds.forEach((s, i) => {
    const o = i * STRIDE;
    state[o] = s.x;
    state[o + 1] = s.y;
    state[o + 2] = s.z ?? 0;
    state[o + 9] = 1;
    const times = releaseTimes(input, s.column);
    release.push(times[0]);
    detach.push(times[1]);
    for (const [dx, dy] of (input.profile.meshBendCompliance !== undefined
      ? [
          [1, 0],
          [0, 1],
          [1, 1],
          [-1, 1],
        ]
      : [
          [1, 0],
          [0, 1],
          [1, 1],
        ]) as Array<[number, number]>) {
      const j = lookup.get(`${s.column + dx}:${s.row + dy}:${s.layer ?? 0}`);
      if (j !== undefined) bonds.push([i, j, Math.hypot(dx, dy) * 0.5]);
    }
  });
  // Connect actual depth nodes, including face diagonals to resist shear.
  if (input.profile.depthLayers === 2)
    input.seeds.forEach((seed, i) => {
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const j = lookup.get(`${seed.column + dx}:${seed.row + dy}:${(seed.layer ?? 0) + 1}`);
        if (j !== undefined) bonds.push([i, j, Math.hypot(dx, dy, 1) * 0.5]);
      }
    });
  const structuralCount = bonds.length,
    bendSupports = new Map<number, number[]>();
  const structuralEdges = new Map(
    bonds.map(([a, b], i) => [`${Math.min(a, b)}:${Math.max(a, b)}`, i]),
  );
  if (input.profile.meshBendCompliance !== undefined) {
    input.seeds.forEach((_, i) => {
      const seed = input.seeds[i]!;
      for (const [dx, dy] of [
        [2, 0],
        [0, 2],
      ] as const) {
        const j = lookup.get(`${seed.column + dx}:${seed.row + dy}:${seed.layer ?? 0}`),
          middle = lookup.get(`${seed.column + dx / 2}:${seed.row + dy / 2}:${seed.layer ?? 0}`);
        if (j === undefined || middle === undefined) continue;
        const supports = [
          [i, middle],
          [middle, j],
        ].map(([a, b]) => structuralEdges.get(`${Math.min(a!, b!)}:${Math.max(a!, b!)}`)!);
        bendSupports.set(bonds.length, supports);
        bonds.push([i, j, Math.hypot(dx, dy) * 0.5]);
      }
    });
  }
  const tracks = new Map<number, Track>();
  for (const frame of input.observations ?? []) {
    for (const [id, x, y] of frame.tracks) {
      const list = tracks.get(id) ?? [];
      const prev = list.at(-1),
        t = frame.frame / 30;
      const span = prev ? t - prev.t : 0;
      // Reject implausible feature swaps; never snap particles onto observations.
      if (prev && (span <= 0 || Math.hypot(x - prev.x, y - prev.y) / span > 70)) continue;
      const vx = prev ? (x - prev.x) / span : 0,
        vy = prev ? (y - prev.y) / span : 0;
      list.push({ t, x, y, vx, vy });
      tracks.set(id, list);
    }
  }
  return {
    state,
    snapshots: [state.slice()],
    release,
    detach,
    bonds,
    tracks,
    broken: new Set(),
    strainAge: new Float64Array(bonds.length),
    structuralCount,
    bendSupports,
    lattice: lookup,
  };
}
function observation(track: Track | undefined, t: number) {
  if (!track?.length) return undefined;
  let previous = track[0]!;
  for (let i = 1; i < track.length; i++) {
    const next = track[i]!;
    if (next.t > t) break;
    previous = next;
  }
  if (t < previous.t) return undefined;
  const age = t - previous.t,
    fade = 1 - smooth(age / 0.22);
  if (!fade) return undefined;
  return {
    x: previous.x + previous.vx * age,
    y: previous.y + previous.vy * age,
    vx: previous.vx,
    vy: previous.vy,
    weight: fade,
  };
}
function quaternionStep(s: Float64Array, o: number) {
  const x = s[o + 6]!,
    y = s[o + 7]!,
    z = s[o + 8]!,
    w = s[o + 9]!;
  const ax = s[o + 10]!,
    ay = s[o + 11]!,
    az = s[o + 12]!;
  const q = [
    x + DT * 0.5 * (ax * w + ay * z - az * y),
    y + DT * 0.5 * (-ax * z + ay * w + az * x),
    z + DT * 0.5 * (ax * y - ay * x + az * w),
    w - DT * 0.5 * (ax * x + ay * y + az * z),
  ];
  const norm = Math.hypot(...q);
  q.forEach((v, j) => (s[o + 6 + j] = v / norm));
  const [qx, qy, qz, qw] = q.map((v) => v / norm) as [number, number, number, number];
  const angles = [
    Math.atan2(2 * (qx * qw - qy * qz), 1 - 2 * (qx * qx + qy * qy)),
    Math.asin(clamp(2 * (qx * qz + qy * qw), -1, 1)),
    Math.atan2(2 * (qz * qw - qx * qy), 1 - 2 * (qy * qy + qz * qz)),
  ];
  angles.forEach((v, j) => {
    const prev = s[o + 13 + j]!;
    s[o + 13 + j] = prev + Math.atan2(Math.sin(v - prev), Math.cos(v - prev));
  });
}
function rotateVector(s: Float64Array, o: number, r: number[]): number[] {
  const x = s[o + 6]!,
    y = s[o + 7]!,
    z = s[o + 8]!,
    w = s[o + 9]!;
  const tx = 2 * (y * r[2]! - z * r[1]!),
    ty = 2 * (z * r[0]! - x * r[2]!),
    tz = 2 * (x * r[1]! - y * r[0]!);
  return [
    r[0]! + w * tx + y * tz - z * ty,
    r[1]! + w * ty + z * tx - x * tz,
    r[2]! + w * tz + x * ty - y * tx,
  ];
}
function attachmentGeometry(sim: Simulation, input: ClearPhysicsInput, a: number, b: number) {
  const s = sim.state,
    oa = a * STRIDE,
    ob = b * STRIDE,
    sa = input.seeds[a]!,
    sb = input.seeds[b]!;
  const rest = [(sb.x - sa.x) / 2, (sb.y - sa.y) / 2, ((sb.z ?? 0) - (sa.z ?? 0)) / 2];
  const ra = rotateVector(s, oa, rest),
    rb = rotateVector(
      s,
      ob,
      rest.map((v) => -v),
    );
  return { ra, rb, error: [0, 1, 2].map((k) => s[oa + k]! + ra[k]! - s[ob + k]! - rb[k]!) };
}
function attachmentForces(sim: Simulation, input: ClearPhysicsInput, t: number, free: boolean[]) {
  const stiffness = input.profile.meshAttachmentStiffness ?? 0;
  if (
    !stiffness ||
    input.profile.depthLayers !== 2 ||
    input.profile.meshBendCompliance === undefined
  )
    return;
  const s = sim.state,
    delta = new Float64Array(s.length),
    invMass = 2,
    invInertia = (2.5 * invMass) / input.profile.radius ** 2;
  const cross = (a: number[], b: number[]) => [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
  for (const [index, [a, b]] of sim.bonds.entries()) {
    if (index >= sim.structuralCount || sim.broken.has(index)) continue;
    const strength =
      1 -
      smooth(
        (t - Math.min(sim.detach[a]!, sim.detach[b]!)) /
          Math.max(DT, (input.profile.bondReleaseDurationFrames ?? 5.4) / 30),
      );
    if (!strength) continue;
    const oa = a * STRIDE,
      ob = b * STRIDE,
      { ra, rb, error } = attachmentGeometry(sim, input, a, b);
    // A central elastic force at the two attachment points balances orbital
    // and spin torque. Held nodes supply an external support reaction.
    const force = error.map((v) => -stiffness * strength * v);
    const torqueA = cross(ra, force),
      torqueB = cross(
        rb,
        force.map((v) => -v),
      );
    const angularA =
        input.profile.contactShape === 'box'
          ? inverseInertia(contactBody(sim, input, a, t), torqueA as V3)
          : torqueA.map((v) => v * invInertia),
      angularB =
        input.profile.contactShape === 'box'
          ? inverseInertia(contactBody(sim, input, b, t), torqueB as V3)
          : torqueB.map((v) => v * invInertia);
    for (let k = 0; k < 3; k++) {
      if (free[a]) {
        delta[oa + 3 + k] = delta[oa + 3 + k]! + force[k]! * invMass * DT;
        delta[oa + 10 + k] = delta[oa + 10 + k]! + angularA[k]! * DT;
      }
      if (free[b]) {
        delta[ob + 3 + k] = delta[ob + 3 + k]! - force[k]! * invMass * DT;
        delta[ob + 10 + k] = delta[ob + 10 + k]! + angularB[k]! * DT;
      }
    }
  }
  // One multiplier for the whole paired field, rather than clipping individual
  // bodies and silently injecting net linear/angular momentum.
  let scale = 1;
  for (let o = 0; o < delta.length; o += STRIDE) {
    const linear = Math.hypot(delta[o + 3]!, delta[o + 4]!, delta[o + 5]!),
      angular = Math.hypot(delta[o + 10]!, delta[o + 11]!, delta[o + 12]!);
    if (linear > 80 * DT) scale = Math.min(scale, (80 * DT) / linear);
    if (angular > 80 * DT) scale = Math.min(scale, (80 * DT) / angular);
  }
  for (let o = 0; o < s.length; o += STRIDE)
    for (let k = 0; k < 3; k++) {
      const dv = delta[o + 3 + k]! * scale;
      s[o + 3 + k] = s[o + 3 + k]! + dv;
      s[o + k] = s[o + k]! + dv * DT;
      s[o + 10 + k] = s[o + 10 + k]! + delta[o + 10 + k]! * scale;
    }
}
/** Fracture recoil is evaluated once at the break substep, never at sample time. */
function fractureRecoil(sim: Simulation, input: ClearPhysicsInput, edges: number[], t: number) {
  const retention = input.profile.meshFractureEnergyRetention ?? 0,
    stiffness = input.profile.meshAttachmentStiffness ?? 0;
  if (!retention || !stiffness || input.profile.depthLayers !== 2 || !edges.length) return;
  const s = sim.state,
    mass = 0.5,
    inertia = 0.4 * mass * input.profile.radius ** 2,
    delta = new Float64Array(s.length);
  const cross = (a: number[], b: number[]) => [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
  let budget = 0;
  for (const edge of edges) {
    if (edge >= sim.structuralCount) continue;
    const [a, b] = sim.bonds[edge]!,
      oa = a * STRIDE,
      ob = b * STRIDE,
      { ra, rb, error } = attachmentGeometry(sim, input, a, b),
      length = Math.hypot(...error);
    if (length < 1e-8) continue;
    const strength =
      1 -
      smooth(
        (t - Math.min(sim.detach[a]!, sim.detach[b]!)) /
          Math.max(DT, (input.profile.bondReleaseDurationFrames ?? 5.4) / 30),
      );
    const energy = 0.5 * stiffness * strength * length * length * retention;
    if (!energy) continue;
    const n = error.map((v) => v / length),
      linearA = n.map((v) => -v / mass),
      linearB = n.map((v) => v / mass);
    const torqueA = cross(
        ra,
        n.map((v) => -v),
      ),
      torqueB = cross(rb, n);
    const angularA =
        input.profile.contactShape === 'box'
          ? inverseInertia(contactBody(sim, input, a, t), torqueA as V3)
          : torqueA.map((v) => v / inertia),
      angularB =
        input.profile.contactShape === 'box'
          ? inverseInertia(contactBody(sim, input, b, t), torqueB as V3)
          : torqueB.map((v) => v / inertia);
    const effectiveInverseMass =
      mass * (linearA.reduce((a, v) => a + v * v, 0) + linearB.reduce((a, v) => a + v * v, 0)) +
      angularA.reduce((sum, v, k) => sum + v * torqueA[k]!, 0) +
      angularB.reduce((sum, v, k) => sum + v * torqueB[k]!, 0);
    let work = 0;
    for (let k = 0; k < 3; k++)
      work +=
        mass * (s[oa + 3 + k]! * linearA[k]! + s[ob + 3 + k]! * linearB[k]!) +
        s[oa + 10 + k]! * torqueA[k]! +
        s[ob + 10 + k]! * torqueB[k]!;
    const impulse =
      (-work + Math.sqrt(work * work + 2 * effectiveInverseMass * energy)) / effectiveInverseMass;
    for (let k = 0; k < 3; k++) {
      delta[oa + 3 + k] = delta[oa + 3 + k]! + linearA[k]! * impulse;
      delta[ob + 3 + k] = delta[ob + 3 + k]! + linearB[k]! * impulse;
      delta[oa + 10 + k] = delta[oa + 10 + k]! + angularA[k]! * impulse;
      delta[ob + 10 + k] = delta[ob + 10 + k]! + angularB[k]! * impulse;
    }
    budget += energy;
  }
  // Simultaneous edge impulses interact. Bound their actual combined kinetic
  // energy increment, not merely the sum of independently bounded impulses.
  let quadratic = 0,
    linear = 0,
    scale = 1;
  for (let o = 0; o < s.length; o += STRIDE) {
    const angularDelta: V3 = [delta[o + 10]!, delta[o + 11]!, delta[o + 12]!],
      angularMomentum =
        input.profile.contactShape === 'box'
          ? contactInertia(contactBody(sim, input, o / STRIDE, t), angularDelta)
          : angularDelta.map((v) => v * inertia);
    for (let k = 0; k < 3; k++) {
      quadratic += 0.5 * (mass * delta[o + 3 + k]! ** 2 + delta[o + 10 + k]! * angularMomentum[k]!);
      linear += mass * s[o + 3 + k]! * delta[o + 3 + k]! + s[o + 10 + k]! * angularMomentum[k]!;
    }
    const dv = Math.hypot(delta[o + 3]!, delta[o + 4]!, delta[o + 5]!),
      dw = Math.hypot(delta[o + 10]!, delta[o + 11]!, delta[o + 12]!);
    if (dv > 40 * DT) scale = Math.min(scale, (40 * DT) / dv);
    if (dw > 40 * DT) scale = Math.min(scale, (40 * DT) / dw);
  }
  if (quadratic > 0 && quadratic * scale * scale + linear * scale > budget)
    scale = Math.min(
      scale,
      (-linear + Math.sqrt(linear * linear + 4 * quadratic * budget)) / (2 * quadratic),
    );
  for (let o = 0; o < s.length; o += STRIDE)
    for (let k = 0; k < 3; k++) {
      const dv = delta[o + 3 + k]! * scale;
      s[o + 3 + k] = s[o + 3 + k]! + dv;
      s[o + 10 + k] = s[o + 10 + k]! + delta[o + 10 + k]! * scale;
    }
}
function materialGrain(seed: number, column: number, row: number): number[] {
  const hash = (salt: number) => {
    let n = (seed ^ Math.imul(column + 1, 73856093) ^ Math.imul(row + 1, 19349663) ^ salt) >>> 0;
    n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
    n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
    return (((n ^ (n >>> 16)) >>> 0) / 4294967295) * 2 - 1;
  };
  const v = [hash(0x1234567), hash(0x7654321), hash(0x13579bd)],
    length = Math.hypot(...v);
  return length > 1e-8 ? v.map((x) => x / length) : [1, 0, 0];
}
function contactBody(
  sim: Simulation,
  input: Omit<ClearPhysicsInput, 'elapsedSeconds'>,
  index: number,
  t: number,
): ClearContactBody {
  const s = sim.state,
    o = index * STRIDE,
    age = clamp((t - sim.release[index]!) / 0.6, 0, 1);
  const scale = input.fragmentSize
    ? input.fragmentSize.baseScale + input.fragmentSize.releaseGrowthScale * age
    : input.profile.radius * 2;
  return {
    position: [s[o]!, s[o + 1]!, s[o + 2]!],
    quaternion: [s[o + 6]!, s[o + 7]!, s[o + 8]!, s[o + 9]!],
    velocity: [s[o + 3]!, s[o + 4]!, s[o + 5]!],
    angularVelocity: [s[o + 10]!, s[o + 11]!, s[o + 12]!],
    halfExtents: [scale * 0.5, scale * 0.5, scale * 0.45],
    radius: input.profile.radius,
    shape: input.profile.contactShape ?? 'sphere',
    inverseMass: input.profile.depthLayers ?? 1,
  };
}
function addContactDelta(delta: Float64Array, index: number, linear: V3, angular: V3) {
  const o = index * STRIDE;
  for (let k = 0; k < 3; k++) {
    delta[o + 3 + k] = delta[o + 3 + k]! + linear[k]!;
    delta[o + 10 + k] = delta[o + 10 + k]! + angular[k]!;
  }
}
function boxSelfContact(
  sim: Simulation,
  input: ClearPhysicsInput,
  t: number,
  free: boolean[],
  bonded: Set<string>,
) {
  const bodies = input.seeds.map((_, i) => contactBody(sim, input, i, t)),
    delta = new Float64Array(sim.state.length);
  // The bucket is a full conservative bounding-sphere diameter, including
  // rendered growth. A rotated corner can extend beyond the old sphere radius.
  const diameter = 2 * Math.max(...bodies.map((body) => Math.hypot(...body.halfExtents))),
    grid = new Map<string, number[]>();
  bodies.forEach((body, i) => {
    const key = body.position.map((v) => Math.floor(v / diameter)).join(',');
    const bucket = grid.get(key) ?? [];
    bucket.push(i);
    grid.set(key, bucket);
  });
  bodies.forEach((body, a) => {
    if (!free[a]) return;
    const [gx, gy, gz] = body.position.map((v) => Math.floor(v / diameter));
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++)
          for (const other of grid.get(`${gx! + x},${gy! + y},${gz! + z}`) ?? []) {
            if (
              other <= a ||
              !free[other] ||
              (bonded.has(`${a}:${other}`) && !input.profile.bondedContact)
            )
              continue;
            const contact = clearContactImpulse(body, bodies[other]!, DT);
            if (!contact) continue;
            addContactDelta(delta, a, contact.linearA, contact.angularA);
            addContactDelta(delta, other, contact.linearB, contact.angularB);
          }
  });
  let scale = 1;
  for (let o = 0; o < delta.length; o += STRIDE) {
    const dv = Math.hypot(delta[o + 3]!, delta[o + 4]!, delta[o + 5]!),
      dw = Math.hypot(delta[o + 10]!, delta[o + 11]!, delta[o + 12]!);
    if (dv > 60 * DT) scale = Math.min(scale, (60 * DT) / dv);
    if (dw > 40 * DT) scale = Math.min(scale, (40 * DT) / dw);
  }
  for (let o = 0; o < delta.length; o += STRIDE)
    for (let k = 0; k < 3; k++) {
      sim.state[o + 3 + k] = sim.state[o + 3 + k]! + delta[o + 3 + k]! * scale;
      sim.state[o + 10 + k] = sim.state[o + 10 + k]! + delta[o + 10 + k]! * scale;
    }
}
function advance(sim: Simulation, input: ClearPhysicsInput) {
  const s = sim.state,
    prev = s.slice(),
    t = sim.snapshots.length * DT,
    p = input.profile;
  const free = sim.release.map((r) => t >= r),
    inv = free.map((v) => (v ? (p.depthLayers ?? 1) : 0));
  input.seeds.forEach((seed, i) => {
    const o = i * STRIDE;
    if (p.contactShape === 'box' && free[i]) {
      // Rendered growth changes inertia. Preserve angular momentum while changing
      // dimensions; growth is an authored expansion, not a new torque source.
      const momentum = contactInertia(contactBody(sim, input, i, t - DT), [
        s[o + 10]!,
        s[o + 11]!,
        s[o + 12]!,
      ]);
      const angular = inverseInertia(contactBody(sim, input, i, t), momentum);
      for (let k = 0; k < 3; k++) s[o + 10 + k] = angular[k]!;
    }
    if (!free[i]) {
      s[o] = seed.x;
      s[o + 1] = seed.y + input.riseSpeed * t;
      s[o + 2] = seed.z ?? 0;
      s[o + 3] = 0;
      s[o + 4] = input.riseSpeed;
      s[o + 5] = 0;
      return;
    }
    if (t - DT < sim.release[i]! || (sim.snapshots.length === 1 && sim.release[i] === 0)) {
      // One release impulse; no frame-wise noise or imposed pose animation.
      const along = seed.column / Math.max(1, input.columns - 1);
      s[o + 3] = -0.8 * (1 - along);
      s[o + 4] = input.riseSpeed - 2.4;
      s[o + 5] = 1.2;
      s[o + 10] = 1.6 + 0.35 * Math.sin(seed.column * 0.7 + seed.row * 0.4);
      s[o + 11] = 0.45 * Math.sin(seed.column * 0.45 + seed.row * 0.8);
      s[o + 12] = -0.2;
      if (p.releaseSpinScale)
        for (let k = 0; k < 3; k++) s[o + 10 + k] = s[o + 10 + k]! * p.releaseSpinScale[k]!;
      if (p.depthLayers === 2) {
        // At fracture, child centres inherit the parent's rigid angular velocity.
        // Equal front/back offsets give zero net linear impulse; apply only once.
        const partner = sim.lattice.get(`${seed.column}:${seed.row}:${1 - (seed.layer ?? 0)}`);
        const depthOffset =
          partner === undefined ? 0 : ((seed.z ?? 0) - (input.seeds[partner]!.z ?? 0)) / 2;
        s[o + 3] = s[o + 3]! + s[o + 11]! * depthOffset;
        s[o + 4] = s[o + 4]! - s[o + 10]! * depthOffset;
        if (partner !== undefined && p.fractureSpinSpeed) {
          const axis = materialGrain(p.materialSeed ?? 0, seed.column, seed.row);
          // Same grain axis and magnitude on the paired bodies, opposite impulses.
          // Cap the pair together so its net spin momentum remains unchanged.
          let speed = p.fractureSpinSpeed;
          for (let k = 0; k < 3; k++)
            if (Math.abs(axis[k]!) > 1e-8)
              speed = Math.min(
                speed,
                Math.max(0, 12 - Math.abs(s[o + 10 + k]!)) / Math.abs(axis[k]!),
              );
          const sign = (seed.layer ?? 0) === 0 ? 1 : -1;
          for (let k = 0; k < 3; k++) s[o + 10 + k] = s[o + 10 + k]! + sign * speed * axis[k]!;
        }
      }
    }
    const separationAt = sim.detach[i]! + (p.bondReleaseDurationFrames ?? 5.4) / 30;
    if (
      p.separationSpeed &&
      sim.snapshots.length === Math.max(1, Math.ceil(separationAt / DT - 1e-9))
    ) {
      // Same-column row pairs detach on the same fixed step, independently of
      // adjacent-column stagger. Equal masses get equal/opposite impulses.
      const direction = seed.row % 2 === 0 ? 1 : -1;
      let normal = [1, 0.35, 0.2];
      if (p.meshBendCompliance !== undefined) {
        normal = [0, 0, 0]; // A missing partner cannot receive an invented net impulse.
        // Split transversely to the CURRENT mesh, not along a fixed screen axis.
        // Both partners read one pre-step state and hence receive exact opposites.
        const topRow = seed.row - (seed.row % 2);
        const top = sim.lattice.get(`${seed.column}:${topRow}:${seed.layer ?? 0}`),
          bottom = sim.lattice.get(`${seed.column}:${topRow + 1}:${seed.layer ?? 0}`);
        if (top !== undefined && bottom !== undefined) {
          const center = (column: number) => {
            const a = sim.lattice.get(`${column}:${topRow}:${seed.layer ?? 0}`),
              b = sim.lattice.get(`${column}:${topRow + 1}:${seed.layer ?? 0}`);
            return a === undefined || b === undefined
              ? undefined
              : [0, 1, 2].map((k) => (prev[a * STRIDE + k]! + prev[b * STRIDE + k]!) * 0.5);
          };
          const middle = center(seed.column)!,
            left = center(seed.column - 1) ?? middle,
            right = center(seed.column + 1) ?? middle;
          const tangent = right.map((v, k) => v - left[k]!),
            length = Math.hypot(...tangent);
          const across = [0, 1, 2].map((k) => prev[top * STRIDE + k]! - prev[bottom * STRIDE + k]!);
          if (length > 1e-8) {
            const unit = tangent.map((v) => v / length),
              along = across.reduce((sum, v, k) => sum + v * unit[k]!, 0);
            normal = across.map((v, k) => v - along * unit[k]!);
          } else normal = across;
          let width = Math.hypot(...normal);
          if (width < 1e-6) {
            const unit = length > 1e-8 ? tangent.map((v) => v / length) : [1, 0, 0];
            const axis = unit
              .map((v, k) => ({ v: Math.abs(v), k }))
              .sort((a, b) => a.v - b.v || a.k - b.k)[0]!.k;
            normal = unit.map((v, k) => (k === axis ? 1 : 0) - unit[axis]! * v);
            width = Math.hypot(...normal);
            const sign = normal.reduce((sum, v, k) => sum + v * across[k]!, 0) < 0 ? -1 : 1;
            normal = normal.map((v) => v * sign);
          }
          normal = normal.map((v) => v / width);
        }
      }
      let speed = p.separationSpeed;
      if (p.separationVariation) {
        const topRow = seed.row - (seed.row % 2),
          layer = seed.layer ?? 0;
        const top = sim.lattice.get(`${seed.column}:${topRow}:${layer}`),
          bottom = sim.lattice.get(`${seed.column}:${topRow + 1}:${layer}`);
        normal = [0, 0, 0];
        if (top !== undefined && bottom !== undefined) {
          // Central impulses conserve both orbital and spin angular momentum.
          // Read the same pre-step positions for both partners, never an updated
          // neighbour pose. Material heterogeneity is fixed, not frame-wise noise.
          const across = [0, 1, 2].map((k) => prev[top * STRIDE + k]! - prev[bottom * STRIDE + k]!);
          const length = Math.hypot(...across);
          if (length > 1e-8) normal = across.map((v) => v / length);
          const grain = materialGrain(p.materialSeed ?? 0, seed.column, topRow * 2 + layer)[0]!;
          speed *= 1 - p.separationVariation + p.separationVariation * grain;
        }
      }
      for (let k = 0; k < 3; k++) s[o + 3 + k] = s[o + 3 + k]! + direction * speed * normal[k]!;
    }
    const envelope = p.gravityEnvelope;
    // Preserve the old arithmetic exactly when disabled or constant. This uses
    // integration time, never the requested render time or the cue lifetime.
    const gravity =
      !envelope || envelope.targetGravity === p.gravity
        ? p.gravity
        : p.gravity +
          (envelope.targetGravity - p.gravity) *
            smooth((t * 30 - envelope.startFrame) / envelope.transitionFrames);
    let ax = 0,
      ay = -gravity,
      az = 0;
    if (p.meshAnchorStiffness && p.meshBendCompliance !== undefined) {
      const strength =
        1 - smooth((t - sim.release[i]!) / Math.max(DT, sim.detach[i]! - sim.release[i]!));
      const k = p.meshAnchorStiffness * strength,
        drag = 2 * Math.sqrt(k) * strength;
      ax += clamp(k * (seed.x - s[o]!) - drag * s[o + 3]!, -100, 100);
      ay += clamp(
        k * (seed.y + input.riseSpeed * t - s[o + 1]!) - drag * (s[o + 4]! - input.riseSpeed),
        -100,
        100,
      );
      az += clamp(k * ((seed.z ?? 0) - s[o + 2]!) - drag * s[o + 5]!, -100, 100);
    }
    const obs =
      (seed.layer ?? 0) === 0
        ? observation(sim.tracks.get(seed.row * input.columns + seed.column), t)
        : undefined;
    if (obs && p.observationStrength > 0) {
      const k = p.observationStrength * obs.weight;
      ax += clamp(k * (obs.x - s[o]!) + 2 * Math.sqrt(k) * (obs.vx - s[o + 3]!), -100, 100);
      ay += clamp(k * (obs.y - s[o + 1]!) + 2 * Math.sqrt(k) * (obs.vy - s[o + 4]!), -100, 100);
    }
    const decay = Math.exp(-p.damping * DT);
    s[o + 3] = (s[o + 3]! + ax * DT) * decay;
    s[o + 4] = (s[o + 4]! + ay * DT) * decay;
    s[o + 5] = (s[o + 5]! + az * DT) * decay;
    for (let k = 0; k < 3; k++) s[o + k] = s[o + k]! + s[o + 3 + k]! * DT;
  });
  // Mesh tearing is causal: accumulate predicted strain before constraint
  // projection. Only released edges can tear, and broken edges never heal.
  const fractured: number[] = [];
  if (p.meshBendCompliance !== undefined)
    for (const [index, [a, b, rest]] of sim.bonds.entries()) {
      if (
        !free[a] ||
        !free[b] ||
        sim.broken.has(index) ||
        t - Math.max(sim.release[a]!, sim.release[b]!) < (p.meshTearDelayFrames ?? 0) / 30
      )
        continue;
      const oa = a * STRIDE,
        ob = b * STRIDE;
      let strain = Math.abs(
        Math.hypot(s[ob]! - s[oa]!, s[ob + 1]! - s[oa + 1]!, s[ob + 2]! - s[oa + 2]!) / rest - 1,
      );
      if (p.meshAttachmentStiffness && p.depthLayers === 2 && index < sim.structuralCount)
        strain = Math.max(strain, Math.hypot(...attachmentGeometry(sim, input, a, b).error) / rest);
      sim.strainAge[index] =
        strain > (p.meshBreakStrain ?? 0.5)
          ? sim.strainAge[index]! + DT
          : Math.max(0, sim.strainAge[index]! - DT);
      if (sim.strainAge[index]! >= (p.meshBreakFrames ?? 3) / 30) {
        sim.broken.add(index);
        fractured.push(index);
      }
    }
  // A bend cannot bridge a cut or a missing lattice node.
  for (const [index, supports] of sim.bendSupports)
    if (supports.some((edge) => sim.broken.has(edge))) sim.broken.add(index);
  attachmentForces(sim, input, t, free);
  // Bond stiffness is a function of this substep only, never the requested end.
  const lambdas = new Float64Array(sim.bonds.length);
  for (let iteration = 0; iteration < 5; iteration++)
    for (const [bondIndex, [a, b, rest]] of sim.bonds.entries()) {
      const weight = inv[a]! + inv[b]!;
      if (!weight || sim.broken.has(bondIndex)) continue;
      const detachAt = Math.min(sim.detach[a]!, sim.detach[b]!);
      const duration = (p.bondReleaseDurationFrames ?? 5.4) / 30;
      const strength = 1 - smooth((t - detachAt) / Math.max(DT, duration));
      const stiffness = 0.65 * strength;
      if (stiffness <= 0) continue;
      const oa = a * STRIDE,
        ob = b * STRIDE,
        delta = [s[ob]! - s[oa]!, s[ob + 1]! - s[oa + 1]!, s[ob + 2]! - s[oa + 2]!],
        distance = Math.hypot(...delta);
      if (distance < 1e-8) continue;
      let correction: number;
      const compliance = bondIndex >= sim.structuralCount ? p.meshBendCompliance : p.bondCompliance;
      if (compliance && compliance > 0) {
        // XPBD: force fades by increasing compliance, not by imposing a new pose.
        // Lambda belongs to this fixed substep; past constraints cannot depend on
        // the future request time or the output video's sampling rate.
        const alpha = compliance / (DT * DT * Math.max(1e-6, strength));
        const change = (-(distance - rest) - alpha * lambdas[bondIndex]!) / (weight + alpha);
        lambdas[bondIndex] = lambdas[bondIndex]! + change;
        correction = -change / distance;
      } else correction = (stiffness * (distance - rest)) / distance / weight;
      for (let k = 0; k < 3; k++) {
        s[oa + k] = s[oa + k]! + delta[k]! * correction * inv[a]!;
        s[ob + k] = s[ob + k]! - delta[k]! * correction * inv[b]!;
      }
    }
  // A surviving edge exerts bounded torque on the fragment's local X/Y
  // axis. Torque integrates angular momentum; tearing never rewrites a pose.
  if (p.meshBendCompliance !== undefined && p.meshAngularStiffness) {
    for (const [index, [a, b]] of sim.bonds.entries()) {
      if (index >= sim.structuralCount || sim.broken.has(index)) continue;
      const age =
          (t - Math.min(sim.detach[a]!, sim.detach[b]!)) /
          Math.max(DT, (p.bondReleaseDurationFrames ?? 5.4) / 30),
        strength = 1 - smooth(age);
      if (!strength) continue;
      const angularRelease = p.meshAngularRelease;
      const angularFactor =
        !angularRelease || angularRelease.targetStiffness === p.meshAngularStiffness
          ? 1
          : angularRelease.targetStiffness / p.meshAngularStiffness +
            (1 - angularRelease.targetStiffness / p.meshAngularStiffness) *
              (1 -
                smooth(
                  ((t - Math.max(sim.release[a]!, sim.release[b]!)) * 30 -
                    angularRelease.holdFrames) /
                    angularRelease.fadeFrames,
                ));
      const sa = input.seeds[a]!,
        sb = input.seeds[b]!;
      const depthEdge = (sa.layer ?? 0) !== (sb.layer ?? 0);
      if (
        depthEdge
          ? sa.column !== sb.column || sa.row !== sb.row
          : sa.column !== sb.column && sa.row !== sb.row
      )
        continue;
      const oa = a * STRIDE,
        ob = b * STRIDE,
        d = [s[ob]! - s[oa]!, s[ob + 1]! - s[oa + 1]!, s[ob + 2]! - s[oa + 2]!],
        length = Math.hypot(...d);
      if (length < 1e-8) continue;
      // Local row indices run downwards in the seed grid.
      const direction = depthEdge ? -1 : sa.column === sb.column ? -1 : 1,
        target = d.map((q) => (q / length) * direction);
      for (const i of [a, b]) {
        if (!free[i]) continue;
        const o = i * STRIDE,
          x = s[o + 6]!,
          y = s[o + 7]!,
          z = s[o + 8]!,
          w = s[o + 9]!;
        const axis = depthEdge
          ? [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]
          : sa.column === sb.column
            ? [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)]
            : [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)];
        const torque = [
          axis[1]! * target[2]! - axis[2]! * target[1]!,
          axis[2]! * target[0]! - axis[0]! * target[2]!,
          axis[0]! * target[1]! - axis[1]! * target[0]!,
        ];
        for (let k = 0; k < 3; k++)
          s[o + 10 + k] = clamp(
            s[o + 10 + k]! +
              clamp(torque[k]! * p.meshAngularStiffness * strength * angularFactor, -40, 40) * DT,
            -12,
            12,
          );
      }
    }
  }
  const bonded = new Set<string>();
  if (p.meshBendCompliance !== undefined)
    for (const [index, [a, b]] of sim.bonds.entries())
      if (
        !sim.broken.has(index) &&
        t < Math.min(sim.detach[a]!, sim.detach[b]!) + (p.bondReleaseDurationFrames ?? 5.4) / 30
      )
        bonded.add(`${Math.min(a, b)}:${Math.max(a, b)}`);
  // Spatial grid keeps self-contact local. A sphere is the conservative
  // collision proxy for each rotating cube; no collisions with board/floor.
  if (p.contactShape === 'box') {
    input.seeds.forEach((_, i) => {
      if (!free[i]) return;
      const o = i * STRIDE;
      for (let k = 0; k < 3; k++) s[o + 3 + k] = (s[o + k]! - prev[o + k]!) / DT;
    });
    boxSelfContact(sim, input, t, free, bonded);
  } else {
    const diameter = p.radius * 2,
      grid = new Map<string, number[]>();
    input.seeds.forEach((_, i) => {
      const o = i * STRIDE,
        key = `${Math.floor(s[o]! / diameter)},${Math.floor(s[o + 1]! / diameter)},${Math.floor(s[o + 2]! / diameter)}`;
      const bucket = grid.get(key) ?? [];
      bucket.push(i);
      grid.set(key, bucket);
    });
    const contacts: Array<{ a: number; b: number; normal: number[]; velocity: number[] }> = [];
    input.seeds.forEach((_, a) => {
      const oa = a * STRIDE,
        gx = Math.floor(s[oa]! / diameter),
        gy = Math.floor(s[oa + 1]! / diameter),
        gz = Math.floor(s[oa + 2]! / diameter);
      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -1; z <= 1; z++)
            for (const b of grid.get(`${gx + x},${gy + y},${gz + z}`) ?? []) {
              if (b <= a || (!inv[a] && !inv[b]) || bonded.has(`${a}:${b}`)) continue;
              const ob = b * STRIDE;
              const dx = s[ob]! - s[oa]!,
                dy = s[ob + 1]! - s[oa + 1]!,
                dz = s[ob + 2]! - s[oa + 2]!,
                distance = Math.hypot(dx, dy, dz);
              if (distance >= diameter || distance < 1e-8) continue;
              const nx = dx / distance,
                ny = dy / distance,
                nz = dz / distance,
                depth = (diameter - distance) / (inv[a]! + inv[b]!);
              const velocity = [0, 1, 2].map(
                (k) => (s[ob + k]! - prev[ob + k]! - (s[oa + k]! - prev[oa + k]!)) / DT,
              );
              for (const [k, n] of [nx, ny, nz].entries()) {
                s[oa + k] = s[oa + k]! - n * depth * inv[a]!;
                s[ob + k] = s[ob + k]! + n * depth * inv[b]!;
              }
              contacts.push({ a, b, normal: [nx, ny, nz], velocity });
            }
    });
    input.seeds.forEach((_, i) => {
      if (!free[i]) return;
      const o = i * STRIDE;
      for (let k = 0; k < 3; k++) s[o + 3 + k] = (s[o + k]! - prev[o + k]!) / DT;
    });
    for (const { a, b, normal: n, velocity: v } of contacts) {
      const oa = a * STRIDE,
        ob = b * STRIDE,
        weight = inv[a]! + inv[b]!;
      const vn = v.reduce((sum, q, k) => sum + q * n[k]!, 0);
      const currentVn = n.reduce((sum, q, k) => sum + (s[ob + 3 + k]! - s[oa + 3 + k]!) * q, 0);
      // Projection resolves penetration but must not create separating energy.
      // Restitution uses contact velocity measured BEFORE positional correction.
      const targetVn = vn < 0 ? -p.restitution * vn : vn;
      const impulse = (targetVn - currentVn) / weight;
      const tangent = v.map((q, k) => q - vn * n[k]!);
      const tangentSpeed = Math.hypot(...tangent);
      const friction =
        vn < 0 ? Math.min(tangentSpeed / weight, (0.25 * (1 + p.restitution) * -vn) / weight) : 0;
      const frictionVector = tangent.map((q) =>
        tangentSpeed > 1e-8 ? (q / tangentSpeed) * friction : 0,
      );
      const torque = [
        n[1]! * frictionVector[2]! - n[2]! * frictionVector[1]!,
        n[2]! * frictionVector[0]! - n[0]! * frictionVector[2]!,
        n[0]! * frictionVector[1]! - n[1]! * frictionVector[0]!,
      ];
      for (let k = 0; k < 3; k++) {
        s[oa + 3 + k] = s[oa + 3 + k]! - n[k]! * impulse * inv[a]! + frictionVector[k]! * inv[a]!;
        s[ob + 3 + k] = s[ob + 3 + k]! + n[k]! * impulse * inv[b]! - frictionVector[k]! * inv[b]!;
        // Solid-sphere proxy I=2/5*m*r^2. Tangential impulse spins both contacts.
        s[oa + 10 + k] = clamp(
          s[oa + 10 + k]! + ((torque[k]! * 2.5) / p.radius) * inv[a]!,
          -12,
          12,
        );
        s[ob + 10 + k] = clamp(
          s[ob + 10 + k]! + ((torque[k]! * 2.5) / p.radius) * inv[b]!,
          -12,
          12,
        );
      }
    }
  }
  fractureRecoil(sim, input, fractured, t);
  input.seeds.forEach((_, i) => {
    if (!free[i]) return;
    const o = i * STRIDE;
    const momentum =
      p.contactShape === 'box'
        ? contactInertia(contactBody(sim, input, i, t), [s[o + 10]!, s[o + 11]!, s[o + 12]!])
        : undefined;
    quaternionStep(s, o);
    if (momentum) {
      const angular = inverseInertia(contactBody(sim, input, i, t), momentum);
      for (let k = 0; k < 3; k++) s[o + 10 + k] = angular[k]!;
    }
  });
  sim.snapshots.push(s.slice());
}
/** Random-access evaluation reads the same immutable integration prefix. */
export function evaluateClearPhysics(input: ClearPhysicsInput): Map<string, ClearPhysicsPose> {
  const key = keyFor(input);
  let sim = cache.get(key);
  if (!sim) {
    sim = create(input);
    cache.set(key, sim);
    if (cache.size > 6) cache.delete(cache.keys().next().value!);
  }
  const target = Math.max(0, input.elapsedSeconds) / DT,
    lo = Math.floor(target),
    hi = Math.ceil(target);
  while (sim.snapshots.length <= hi) advance(sim, input);
  const a = sim.snapshots[lo]!,
    b = sim.snapshots[hi]!,
    f = target - lo,
    out = new Map<string, ClearPhysicsPose>();
  const get = (o: number, k: number) => a[o + k]! + (b[o + k]! - a[o + k]!) * f;
  input.seeds.forEach((seed, i) => {
    const o = i * STRIDE;
    out.set(seed.id, {
      x: get(o, 0),
      y: get(o, 1),
      z: get(o, 2),
      velocityX: get(o, 3),
      velocityY: get(o, 4),
      velocityZ: get(o, 5),
      rotationX: get(o, 13),
      rotationY: get(o, 14),
      rotationZ: get(o, 15),
      angularVelocity: [get(o, 10), get(o, 11), get(o, 12)],
      releaseAge: clamp((input.elapsedSeconds - sim!.release[i]!) / 0.6, 0, 1),
    });
  });
  return out;
}
export function clearPhysicsCache(): void {
  cache.clear();
  worldCache.clear();
}

/** Full immutable event schedule. Seconds share the video's absolute clock. */
export interface ClearPhysicsEvent {
  startSeconds: number;
  endSeconds: number;
  input: Omit<ClearPhysicsInput, 'elapsedSeconds'>;
}
interface PhysicsWorld {
  events: ClearPhysicsEvent[];
  simulations: Simulation[];
  step: number;
}
const worldCache = new Map<string, PhysicsWorld>();

/** Compliant cross-event contact. No floor/board contacts or cue birth impulse.
 * Equal/opposite bounded force avoids exploding initially overlapping proxies.
 * Intra-event bonded neighbours are handled by the mesh, not this pass. */
function crossEventContact(world: PhysicsWorld, time: number) {
  const impulses = world.simulations.map((sim) => new Float64Array(sim.state.length));
  for (let ea = 0; ea < world.events.length; ea++)
    for (let eb = ea + 1; eb < world.events.length; eb++) {
      const a = world.events[ea]!,
        b = world.events[eb]!;
      if (
        time <= a.startSeconds ||
        time <= b.startSeconds ||
        time >= a.endSeconds ||
        time >= b.endSeconds
      )
        continue;
      const sa = world.simulations[ea]!,
        sb = world.simulations[eb]!,
        ra = a.input.profile.radius,
        rb = b.input.profile.radius,
        diameter = ra + rb;
      const boxMode =
        a.input.profile.contactShape === 'box' || b.input.profile.contactShape === 'box';
      const boxesA = boxMode
          ? a.input.seeds.map((_, i) => contactBody(sa, a.input, i, time - a.startSeconds))
          : [],
        boxesB = boxMode
          ? b.input.seeds.map((_, i) => contactBody(sb, b.input, i, time - b.startSeconds))
          : [];
      for (let i = 0; i < a.input.seeds.length; i++)
        for (let j = 0; j < b.input.seeds.length; j++) {
          if (time - a.startSeconds < sa.release[i]! || time - b.startSeconds < sb.release[j]!)
            continue;
          if (boxMode) {
            const contact = clearContactImpulse(boxesA[i]!, boxesB[j]!, DT);
            if (contact) {
              addContactDelta(impulses[ea]!, i, contact.linearA, contact.angularA);
              addContactDelta(impulses[eb]!, j, contact.linearB, contact.angularB);
            }
            continue;
          }
          const oa = i * STRIDE,
            ob = j * STRIDE,
            x = sb.state[ob]! - sa.state[oa]!,
            y = sb.state[ob + 1]! - sa.state[oa + 1]!,
            z = sb.state[ob + 2]! - sa.state[oa + 2]!,
            distance = Math.hypot(x, y, z);
          if (distance >= diameter) continue;
          // Coincident births use a stable depth normal, never a random displacement.
          const n = distance > 1e-8 ? [x / distance, y / distance, z / distance] : [0, 0, 1],
            v = [0, 1, 2].map((k) => sb.state[ob + 3 + k]! - sa.state[oa + 3 + k]!),
            vn = v.reduce((sum, q, k) => sum + q * n[k]!, 0);
          const massA = 1 / (a.input.profile.depthLayers ?? 1),
            massB = 1 / (b.input.profile.depthLayers ?? 1);
          const impulse = clamp(180 * (diameter - distance) - 12 * vn, 0, 60) * DT;
          const tangent = v.map((q, k) => q - vn * n[k]!),
            ts = Math.hypot(...tangent),
            friction = Math.min(ts * 0.5, 0.2 * impulse);
          const ft = tangent.map((q) => (ts > 1e-8 ? (q / ts) * friction : 0));
          const torque = [
            n[1]! * ft[2]! - n[2]! * ft[1]!,
            n[2]! * ft[0]! - n[0]! * ft[2]!,
            n[0]! * ft[1]! - n[1]! * ft[0]!,
          ];
          for (let k = 0; k < 3; k++) {
            impulses[ea]![oa + 3 + k] =
              impulses[ea]![oa + 3 + k]! + (-n[k]! * impulse + ft[k]!) / massA;
            impulses[eb]![ob + 3 + k] =
              impulses[eb]![ob + 3 + k]! + (n[k]! * impulse - ft[k]!) / massB;
            impulses[ea]![oa + 10 + k] =
              impulses[ea]![oa + 10 + k]! + (torque[k]! * 2.5) / ra / massA;
            impulses[eb]![ob + 10 + k] =
              impulses[eb]![ob + 10 + k]! + (torque[k]! * 2.5) / rb / massB;
          }
        }
    }
  // Bound aggregate (not only pairwise) contact acceleration. One scale for
  // the entire impulse field retains each pair's equal/opposite linear impulse.
  let scale = 1;
  impulses.forEach((delta) => {
    for (let o = 0; o < delta.length; o += STRIDE) {
      const linear = Math.hypot(delta[o + 3]!, delta[o + 4]!, delta[o + 5]!),
        angular = Math.hypot(delta[o + 10]!, delta[o + 11]!, delta[o + 12]!);
      if (linear > 60 * DT) scale = Math.min(scale, (60 * DT) / linear);
      if (angular > 40 * DT) scale = Math.min(scale, (40 * DT) / angular);
    }
  });
  world.simulations.forEach((sim, index) => {
    const delta = impulses[index]!;
    for (let o = 0; o < sim.state.length; o += STRIDE)
      for (let k = 0; k < 3; k++) {
        sim.state[o + 3 + k] = sim.state[o + 3 + k]! + delta[o + 3 + k]! * scale;
        sim.state[o + 10 + k] = clamp(sim.state[o + 10 + k]! + delta[o + 10 + k]! * scale, -12, 12);
      }
  });
}

/** Stable scheduled world: future events are registered at creation, inactive
 * particles exert no force, and every request extends the same 120Hz prefix. */
export function evaluateClearPhysicsWorld(
  events: ClearPhysicsEvent[],
  elapsedSeconds: number,
): Map<string, ClearPhysicsPose> {
  for (const event of events) {
    if (
      !Number.isFinite(event.startSeconds) ||
      !Number.isFinite(event.endSeconds) ||
      event.startSeconds < 0 ||
      event.endSeconds <= event.startSeconds ||
      [event.startSeconds, event.endSeconds].some(
        (t) => Math.abs(t / DT - Math.round(t / DT)) > 1e-7,
      )
    )
      throw new Error('CRUSH_PHYSICS_WORLD_EVENT_NOT_ON_120HZ_GRID');
  }
  const key = JSON.stringify(
    events.map((e) => [e.startSeconds, e.endSeconds, keyFor({ ...e.input, elapsedSeconds: 0 })]),
  );
  let world = worldCache.get(key);
  if (!world) {
    world = {
      events,
      simulations: events.map((e) => create({ ...e.input, elapsedSeconds: 0 })),
      step: 0,
    };
    worldCache.set(key, world);
    if (worldCache.size > 3) worldCache.delete(worldCache.keys().next().value!);
  }
  const target = Math.max(0, elapsedSeconds) / DT;
  while (world.step < Math.ceil(target - 1e-9)) {
    world.step++;
    const time = world.step * DT;
    world.events.forEach((event, index) => {
      const local = time - event.startSeconds;
      if (local > 1e-9 && time < event.endSeconds + 1e-9)
        advance(world!.simulations[index]!, { ...event.input, elapsedSeconds: local });
    });
    crossEventContact(world, time);
    // Contact impulses enter the stored state before the next integration step.
    world.events.forEach((event, index) => {
      if (time > event.startSeconds && time < event.endSeconds) {
        const sim = world!.simulations[index]!;
        sim.snapshots[sim.snapshots.length - 1] = sim.state.slice();
      }
    });
  }
  const out = new Map<string, ClearPhysicsPose>();
  events.forEach((event, index) => {
    const local = elapsedSeconds - event.startSeconds;
    if (local < 0 || elapsedSeconds >= event.endSeconds) return;
    const sim = world!.simulations[index]!,
      position = local / DT,
      lo = Math.floor(position + 1e-9),
      hi = Math.ceil(position - 1e-9),
      f = position - lo;
    const a = sim.snapshots[lo]!,
      b = sim.snapshots[hi]!;
    if (!a || !b) throw new Error('CRUSH_PHYSICS_WORLD_PREFIX_MISSING');
    const get = (o: number, k: number) => a[o + k]! + (b[o + k]! - a[o + k]!) * f;
    event.input.seeds.forEach((seed, i) => {
      const o = i * STRIDE;
      out.set(seed.id, {
        x: get(o, 0),
        y: get(o, 1),
        z: get(o, 2),
        velocityX: get(o, 3),
        velocityY: get(o, 4),
        velocityZ: get(o, 5),
        rotationX: get(o, 13),
        rotationY: get(o, 14),
        rotationZ: get(o, 15),
        angularVelocity: [get(o, 10), get(o, 11), get(o, 12)],
        releaseAge: clamp((local - sim.release[i]!) / 0.6, 0, 1),
      });
    });
  });
  return out;
}

/** Render-only read of the already integrated complete world. No ghost bodies. */
export interface ClearPhysicsHistoryPose extends ClearPhysicsPose {
  quaternion: [number, number, number, number];
}
export function sampleClearPhysicsWorldHistory(
  events: ClearPhysicsEvent[],
  currentSeconds: number,
  sampleSeconds: number,
): Map<string, ClearPhysicsHistoryPose> {
  if (
    !Number.isFinite(currentSeconds) ||
    Math.abs(currentSeconds * 120 - Math.round(currentSeconds * 120)) > 1e-7 ||
    !Number.isFinite(sampleSeconds) ||
    sampleSeconds > currentSeconds + 1e-9
  )
    throw new Error('CRUSH_EXPOSURE_HISTORY_TIME_INVALID');
  evaluateClearPhysicsWorld(events, currentSeconds);
  if (sampleSeconds < 0) return new Map();
  const key = JSON.stringify(
    events.map((e) => [e.startSeconds, e.endSeconds, keyFor({ ...e.input, elapsedSeconds: 0 })]),
  );
  const world = worldCache.get(key)!;
  const out = new Map<string, ClearPhysicsHistoryPose>();
  events.forEach((event, index) => {
    const local = sampleSeconds - event.startSeconds;
    if (local < 0 || sampleSeconds >= event.endSeconds) return;
    const sim = world.simulations[index]!,
      position = local / DT,
      lo = Math.floor(position + 1e-9),
      hi = Math.ceil(position - 1e-9),
      f = Math.max(0, Math.min(1, position - lo));
    const a = sim.snapshots[lo]!,
      b = sim.snapshots[hi]!;
    if (!a || !b) throw new Error('CRUSH_EXPOSURE_HISTORY_PREFIX_MISSING');
    const get = (o: number, k: number) => a[o + k]! + (b[o + k]! - a[o + k]!) * f;
    event.input.seeds.forEach((seed, i) => {
      const o = i * STRIDE,
        qa = [0, 1, 2, 3].map((k) => a[o + 6 + k]!),
        raw = [0, 1, 2, 3].map((k) => b[o + 6 + k]!);
      let dot = qa.reduce((sum, v, k) => sum + v * raw[k]!, 0);
      const qb = dot < 0 ? raw.map((v) => -v) : raw;
      dot = Math.min(1, Math.abs(dot));
      const theta = Math.acos(dot),
        sine = Math.sin(theta),
        wa = dot > 0.9995 ? 1 - f : Math.sin((1 - f) * theta) / sine,
        wb = dot > 0.9995 ? f : Math.sin(f * theta) / sine;
      const q = qa.map((v, k) => wa * v + wb * qb[k]!),
        n = Math.hypot(...q);
      out.set(seed.id, {
        x: get(o, 0),
        y: get(o, 1),
        z: get(o, 2),
        velocityX: get(o, 3),
        velocityY: get(o, 4),
        velocityZ: get(o, 5),
        rotationX: get(o, 13),
        rotationY: get(o, 14),
        rotationZ: get(o, 15),
        angularVelocity: [get(o, 10), get(o, 11), get(o, 12)],
        releaseAge: clamp((local - sim.release[i]!) / 0.6, 0, 1),
        quaternion: q.map((v) => v / n) as [number, number, number, number],
      });
    });
  });
  return out;
}
