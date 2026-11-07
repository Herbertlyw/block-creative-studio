import {
  createEncouragementGlyphQuadMesh,
  ENCOURAGEMENT_GLYPH_QUAD_LIMITS,
  type EncouragementGlyphQuad,
} from '../render/encouragementGlyphQuad';

/** Authored independent glyph planes, not measured alpha or recovered 3D. */
export interface DropEncouragementGlyph {
  id: string;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
}
export interface DropEncouragementGlyphPose {
  id: string;
  quad: EncouragementGlyphQuad;
  face: 'front' | 'back';
  opacity?: number;
  extrusion?: { x: number; y: number; steps?: number };
}
export interface DropEncouragementGlyphGlow {
  center: { x: number; y: number };
  radiusX: number;
  radiusY: number;
  color: 'white' | 'blue';
  blurPixels: number;
  opacity: number;
}
/** A bounded numeric light plane, not a source-frame/board texture or recovered alpha. */
export interface DropEncouragementGlyphEmission {
  points: Array<{ x: number; y: number }>;
  color: string;
  haloColor: string;
  opacity: number;
  blurPixels: number;
  layer: 'behind' | 'front';
}
export interface DropEncouragementGlyphKey {
  canonicalFrame: number;
  glyphs: DropEncouragementGlyphPose[];
  glows?: DropEncouragementGlyphGlow[];
  emissions?: DropEncouragementGlyphEmission[];
}
export interface DropEncouragementGlyphFrontHalo {
  glyphIds: string[];
  color: string;
  radiusPixels: number;
  blurPixels: number;
  opacity: number;
}
export const DROP_ENCOURAGEMENT_GLYPH_HALO_LIMITS = Object.freeze({
  maxSourceGlyphPixels: 262144,
  maxUniqueGlyphRects: 8,
  maxFrameGroups: 2,
  maxStageBoundsPixels: 65536,
  maxDeviceTiles: 16,
  maxOutputScale: 2,
  maxSupportPixels: 16,
  tileCore: 128,
  tileSide: 194,
  maxDeviceSupport: 33,
});
export interface DropEncouragementGlyphCue {
  frontHalo?: DropEncouragementGlyphFrontHalo;
  actionIndex: number;
  cycleIndex: number;
  canonicalFps: 30;
  atlasSlot: 'ui.atlas.6';
  backColor: string;
  sideColor: string;
  glyphs: DropEncouragementGlyph[];
  keys: DropEncouragementGlyphKey[];
}
export interface DropEncouragementGlyphBinding {
  cueIndex: number;
  originFrame: number;
  endFrame: number;
}
export interface DropEncouragementGlyphWave {
  cueIndex: number;
  elapsedFrames: number;
}
export const DROP_ENCOURAGEMENT_GLYPH_LIMITS = Object.freeze({
  maxCues: 256,
  maxGlyphs: 8,
  maxKeys: 240,
  maxTotalKeys: 4096,
  maxTotalPoses: 8192,
  maxRecipeMeshTriangles: 262144,
  maxFrameDrawTriangles: 32768,
  maxFrameScratchPixels: 2097152,
  maxFrameGlows: 2,
  maxKeyEmissions: 4,
  maxFrameEmissions: 4,
  maxEmissionPoints: 12,
  maxEmissionWidth: 384,
  maxEmissionHeight: 384,
  maxEmissionAreaPixels: 32768,
  maxEmissionBoundsPixels: 65536,
  maxFrameEmissionAreaPixels: 65536,
  maxFrameEmissionBoundsPixels: 65536,
  maxFrameEmissionBlurBoundsPixels: 262144,
  maxErrorPixels: 0.25,
  maxMeshTriangles: 2048,
});
const fail = (path: string): never => {
  throw new Error(`DROP_ENCOURAGEMENT_GLYPH_INVALID: ${path}`);
};
function object(v: unknown, path: string, allowed: string[]) {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !allowed.includes(k))
  )
    fail(path);
  return v as Record<string, unknown>;
}
function number(v: unknown, path: string, min: number, max: number, integer = false) {
  if (
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    (integer && !Number.isInteger(v))
  )
    fail(path);
  return v as number;
}
function array(v: unknown, path: string, min: number, max: number) {
  if (!Array.isArray(v) || v.length < min || v.length > max) fail(path);
  return v as unknown[];
}
function id(v: unknown, path: string) {
  if (typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(v)) fail(path);
  return v as string;
}
function color(v: unknown, path: string) {
  if (typeof v !== 'string' || !/^#[\da-f]{6}$/i.test(v)) fail(path);
  return v as string;
}
function point(v: unknown, path: string) {
  const p = object(v, path, ['x', 'y']);
  return { x: number(p.x, path + '.x', -16384, 16384), y: number(p.y, path + '.y', -16384, 16384) };
}

/** Validate a simple polygon and reserve its complete fill/halo footprint before drawing. */
export function dropEncouragementGlyphEmissionCost(emission: DropEncouragementGlyphEmission) {
  const points = emission?.points;
  if (
    !Array.isArray(points) ||
    points.length < 3 ||
    points.length > DROP_ENCOURAGEMENT_GLYPH_LIMITS.maxEmissionPoints
  )
    fail('emission.points');
  for (const p of points)
    if (
      !p ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      Math.abs(p.x) > 16384 ||
      Math.abs(p.y) > 16384
    )
      fail('emission.point');
  color(emission.color, 'emission.color');
  color(emission.haloColor, 'emission.haloColor');
  number(emission.opacity, 'emission.opacity', 0, 1);
  number(emission.blurPixels, 'emission.blurPixels', 0, 24);
  if (emission.layer !== 'behind' && emission.layer !== 'front') fail('emission.layer');
  const cross = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
  ) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const epsilon = 1e-8;
  const onSegment = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
  ) =>
    Math.abs(cross(a, b, c)) <= epsilon &&
    c.x >= Math.min(a.x, b.x) - epsilon &&
    c.x <= Math.max(a.x, b.x) + epsilon &&
    c.y >= Math.min(a.y, b.y) - epsilon &&
    c.y <= Math.max(a.y, b.y) + epsilon;
  const intersects = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
    d: { x: number; y: number },
  ) => {
    const ac = cross(a, b, c),
      ad = cross(a, b, d),
      ca = cross(c, d, a),
      cb = cross(c, d, b);
    return (
      (((ac > epsilon && ad < -epsilon) || (ac < -epsilon && ad > epsilon)) &&
        ((ca > epsilon && cb < -epsilon) || (ca < -epsilon && cb > epsilon))) ||
      onSegment(a, b, c) ||
      onSegment(a, b, d) ||
      onSegment(c, d, a) ||
      onSegment(c, d, b)
    );
  };
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) fail('emission.zeroEdge');
    // Adjacent collinear edges may continue, but cannot retrace the same segment.
    const c = points[(i + 2) % points.length]!;
    if (
      Math.abs(cross(a, b, c)) <= epsilon &&
      (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0
    )
      fail('emission.retracedEdge');
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (intersects(a, b, points[j]!, points[(j + 1) % points.length]!))
        fail('emission.selfIntersection');
    }
  }
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y),
    width = Math.max(...xs) - Math.min(...xs),
    height = Math.max(...ys) - Math.min(...ys);
  const areaPixels =
      Math.abs(
        points.reduce((sum, p, i) => {
          const q = points[(i + 1) % points.length]!;
          return sum + p.x * q.y - p.y * q.x;
        }, 0),
      ) / 2,
    boundsPixels = width * height;
  if (areaPixels < 0.01) fail('emission.degenerate');
  if (width > 384 || height > 384 || areaPixels > 32768 || boundsPixels > 65536)
    fail('emission.geometryBudget');
  // Three blur radii each side is a conservative resource allowance, not a claim
  // that browser shadow kernels or exact source pixels have finite support there.
  const blurBoundsPixels = (width + 6 * emission.blurPixels) * (height + 6 * emission.blurPixels);
  return { areaPixels, boundsPixels, blurBoundsPixels, fillTriangles: points.length - 2 };
}

export function dropEncouragementGlyphHaloBounds(
  cue: Pick<DropEncouragementGlyphCue, 'frontHalo'>,
  key: DropEncouragementGlyphKey,
) {
  const halo = cue.frontHalo;
  if (!halo || halo.opacity === 0) return;
  const poses = key.glyphs.filter(
    (p) => p.face === 'front' && halo.glyphIds.includes(p.id) && (p.opacity ?? 1) > 0,
  );
  if (!poses.length) return;
  const padding = halo.radiusPixels + 3 * halo.blurPixels + 2,
    points = poses.flatMap((p) => p.quad),
    left = Math.max(0, Math.min(...points.map((p) => p.x)) - padding),
    right = Math.min(1080, Math.max(...points.map((p) => p.x)) + padding),
    top = Math.max(0, Math.min(...points.map((p) => p.y)) - padding),
    bottom = Math.min(1920, Math.max(...points.map((p) => p.y)) + padding);
  if (left >= right || top >= bottom) return;
  // Reserve the worst permitted unrotated output scale. Runtime also checks the
  // exact clipped device bounds, including rotation and its reconstruction margin.
  const deviceTiles =
    Math.ceil(
      ((right - left) * DROP_ENCOURAGEMENT_GLYPH_HALO_LIMITS.maxOutputScale) /
        DROP_ENCOURAGEMENT_GLYPH_HALO_LIMITS.tileCore,
    ) *
    Math.ceil(
      ((bottom - top) * DROP_ENCOURAGEMENT_GLYPH_HALO_LIMITS.maxOutputScale) /
        DROP_ENCOURAGEMENT_GLYPH_HALO_LIMITS.tileCore,
    );
  return {
    left,
    right,
    top,
    bottom,
    areaPixels: (right - left) * (bottom - top),
    deviceTiles,
    poses,
  };
}
export function dropEncouragementGlyphKeyCost(
  cue: Pick<DropEncouragementGlyphCue, 'glyphs' | 'frontHalo'>,
  key: DropEncouragementGlyphKey,
) {
  let meshTriangles = 0,
    drawTriangles = 0,
    scratchPixels = 0;
  for (const pose of key.glyphs) {
    const glyph = cue.glyphs.find((g) => g.id === pose.id) ?? fail('pose.glyphId');
    const mesh = createEncouragementGlyphQuadMesh(pose.quad, {
      maxErrorPixels: DROP_ENCOURAGEMENT_GLYPH_LIMITS.maxErrorPixels,
      maxTriangles: DROP_ENCOURAGEMENT_GLYPH_LIMITS.maxMeshTriangles,
    });
    const e = pose.extrusion,
      length = e ? Math.hypot(e.x, e.y) : 0,
      passes = length === 0 ? 0 : (e?.steps ?? Math.min(16, Math.max(1, Math.ceil(length))));
    if (
      length > 32 ||
      pose.quad.some(
        (p) => Math.abs(p.x + (e?.x ?? 0)) > 16384 || Math.abs(p.y + (e?.y ?? 0)) > 16384,
      )
    )
      fail('pose.extrusion');
    meshTriangles += mesh.triangles.length;
    drawTriangles += mesh.triangles.length * (passes + 1);
    scratchPixels += glyph.sourceWidth * glyph.sourceHeight * (passes ? 2 : 1);
  }
  let emissionAreaPixels = 0,
    emissionBoundsPixels = 0,
    emissionBlurBoundsPixels = 0;
  for (const emission of key.emissions ?? []) {
    const cost = dropEncouragementGlyphEmissionCost(emission);
    emissionAreaPixels += cost.areaPixels;
    emissionBoundsPixels += cost.boundsPixels;
    emissionBlurBoundsPixels += cost.blurBoundsPixels;
    drawTriangles += cost.fillTriangles;
  }
  const halo = dropEncouragementGlyphHaloBounds(cue, key);
  if (halo) {
    const haloTriangles = halo.poses.reduce(
      (sum, p) =>
        sum +
        createEncouragementGlyphQuadMesh(p.quad, { maxErrorPixels: 0.25, maxTriangles: 2048 })
          .triangles.length,
      0,
    );
    drawTriangles += (haloTriangles + 8) * DROP_ENCOURAGEMENT_GLYPH_HALO_LIMITS.maxDeviceTiles;
  }
  return {
    meshTriangles,
    drawTriangles,
    scratchPixels,
    glows: key.glows?.length ?? 0,
    emissions: key.emissions?.length ?? 0,
    emissionAreaPixels,
    emissionBoundsPixels,
    emissionBlurBoundsPixels,
    ...(halo
      ? { haloGroups: 1, haloBoundsPixels: halo.areaPixels, haloDeviceTiles: halo.deviceTiles }
      : {}),
  };
}
export function parseDropEncouragementGlyphCues(value: unknown): DropEncouragementGlyphCue[] {
  const pairs = new Set<string>(),
    haloRects = new Map<string, DropEncouragementGlyph>();
  let totalKeys = 0,
    totalPoses = 0,
    totalTriangles = 0;
  return array(value, 'cues', 0, DROP_ENCOURAGEMENT_GLYPH_LIMITS.maxCues).map((raw, index) => {
    const path = `cues.${index}`,
      q = object(raw, path, [
        'actionIndex',
        'cycleIndex',
        'canonicalFps',
        'atlasSlot',
        'backColor',
        'sideColor',
        'glyphs',
        'keys',
        'frontHalo',
      ]);
    const actionIndex = number(q.actionIndex, path + '.actionIndex', 0, 999, true),
      cycleIndex = number(q.cycleIndex, path + '.cycleIndex', 0, 63, true),
      pair = `${actionIndex}:${cycleIndex}`;
    if (pairs.has(pair)) fail(path + '.duplicateTarget');
    pairs.add(pair);
    if (q.canonicalFps !== 30 || q.atlasSlot !== 'ui.atlas.6') fail(path + '.clockOrAtlas');
    const glyphs = array(q.glyphs, path + '.glyphs', 1, 8).map((raw, i) => {
      const p = `${path}.glyphs.${i}`,
        g = object(raw, p, ['id', 'sourceX', 'sourceY', 'sourceWidth', 'sourceHeight']);
      return {
        id: id(g.id, p + '.id'),
        sourceX: number(g.sourceX, p + '.sourceX', 0, 8192, true),
        sourceY: number(g.sourceY, p + '.sourceY', 0, 8192, true),
        sourceWidth: number(g.sourceWidth, p + '.sourceWidth', 1, 4096, true),
        sourceHeight: number(g.sourceHeight, p + '.sourceHeight', 1, 4096, true),
      };
    });
    if (new Set(glyphs.map((g) => g.id)).size !== glyphs.length) fail(path + '.glyphs.duplicate');
    let frontHalo: DropEncouragementGlyphFrontHalo | undefined;
    if (q.frontHalo !== undefined) {
      const h = object(q.frontHalo, path + '.frontHalo', [
          'glyphIds',
          'color',
          'radiusPixels',
          'blurPixels',
          'opacity',
        ]),
        glyphIds = array(h.glyphIds, path + '.frontHalo.glyphIds', 1, 8).map((v, i) =>
          id(v, path + '.frontHalo.glyphIds.' + i),
        );
      if (new Set(glyphIds).size !== glyphIds.length) fail(path + '.frontHalo.duplicateGlyph');
      frontHalo = {
        glyphIds,
        color: color(h.color, path + '.frontHalo.color'),
        radiusPixels: number(h.radiusPixels, path + '.frontHalo.radiusPixels', 0, 4),
        blurPixels: number(h.blurPixels, path + '.frontHalo.blurPixels', 0, 4),
        opacity: number(h.opacity, path + '.frontHalo.opacity', 0, 1),
      };
      if (
        frontHalo.radiusPixels + 3 * frontHalo.blurPixels > 16 ||
        (frontHalo.opacity > 0 && frontHalo.radiusPixels + frontHalo.blurPixels === 0)
      )
        fail(path + '.frontHalo.support');
      for (const id of glyphIds) {
        const g = glyphs.find((g) => g.id === id) ?? fail(path + '.frontHalo.glyphId');
        if (g.sourceWidth * g.sourceHeight > 262144) fail(path + '.frontHalo.sourcePixels');
        const rectKey = [g.sourceX, g.sourceY, g.sourceWidth, g.sourceHeight].join(':');
        if (!haloRects.has(rectKey)) {
          for (const q of haloRects.values())
            if (
              g.sourceX < q.sourceX + q.sourceWidth &&
              g.sourceX + g.sourceWidth > q.sourceX &&
              g.sourceY < q.sourceY + q.sourceHeight &&
              g.sourceY + g.sourceHeight > q.sourceY
            )
              fail(path + '.frontHalo.overlappingSourceRects');
          haloRects.set(rectKey, g);
        }
      }
      if (haloRects.size > 8) fail('frontHalo.uniqueRectBudget');
    }
    const keys = array(q.keys, path + '.keys', 1, 240).map((raw, i): DropEncouragementGlyphKey => {
      const p = `${path}.keys.${i}`,
        k = object(raw, p, ['canonicalFrame', 'glyphs', 'glows', 'emissions']),
        canonicalFrame = number(k.canonicalFrame, p + '.canonicalFrame', 0, 239, true);
      const poses = array(k.glyphs, p + '.glyphs', 0, 8).map(
        (raw, j): DropEncouragementGlyphPose => {
          const s = `${p}.glyphs.${j}`,
            g = object(raw, s, ['id', 'quad', 'face', 'opacity', 'extrusion']),
            glyphId = id(g.id, s + '.id');
          if (!glyphs.some((g) => g.id === glyphId)) fail(s + '.id');
          const quad = array(g.quad, s + '.quad', 4, 4).map((v, n) =>
            point(v, `${s}.quad.${n}`),
          ) as unknown as EncouragementGlyphQuad;
          if (g.face !== 'front' && g.face !== 'back') fail(s + '.face');
          let extrusion: DropEncouragementGlyphPose['extrusion'];
          if (g.extrusion !== undefined) {
            const e = object(g.extrusion, s + '.extrusion', ['x', 'y', 'steps']);
            extrusion = {
              x: number(e.x, s + '.extrusion.x', -32, 32),
              y: number(e.y, s + '.extrusion.y', -32, 32),
              ...(e.steps === undefined
                ? {}
                : { steps: number(e.steps, s + '.extrusion.steps', 1, 16, true) }),
            };
          }
          return {
            id: glyphId,
            quad,
            face: g.face as 'front' | 'back',
            ...(g.opacity === undefined
              ? {}
              : { opacity: number(g.opacity, s + '.opacity', 0, 1) }),
            ...(extrusion ? { extrusion } : {}),
          };
        },
      );
      if (new Set(poses.map((p) => p.id)).size !== poses.length) fail(p + '.glyphs.duplicate');
      const glows =
        k.glows === undefined
          ? undefined
          : array(k.glows, p + '.glows', 0, 2).map((raw, j): DropEncouragementGlyphGlow => {
              const s = `${p}.glows.${j}`,
                g = object(raw, s, [
                  'center',
                  'radiusX',
                  'radiusY',
                  'color',
                  'blurPixels',
                  'opacity',
                ]);
              if (g.color !== 'white' && g.color !== 'blue') fail(s + '.color');
              return {
                center: point(g.center, s + '.center'),
                radiusX: number(g.radiusX, s + '.radiusX', 0.01, 128),
                radiusY: number(g.radiusY, s + '.radiusY', 0.01, 128),
                color: g.color as 'white' | 'blue',
                blurPixels: number(g.blurPixels, s + '.blurPixels', 0, 24),
                opacity: number(g.opacity, s + '.opacity', 0, 0.2),
              };
            });
      const emissions =
        k.emissions === undefined
          ? undefined
          : array(k.emissions, p + '.emissions', 0, 4).map(
              (raw, j): DropEncouragementGlyphEmission => {
                const s = `${p}.emissions.${j}`,
                  e = object(raw, s, [
                    'points',
                    'color',
                    'haloColor',
                    'opacity',
                    'blurPixels',
                    'layer',
                  ]);
                if (e.layer !== 'behind' && e.layer !== 'front') fail(s + '.layer');
                return {
                  points: array(e.points, s + '.points', 3, 12).map((v, n) =>
                    point(v, `${s}.points.${n}`),
                  ),
                  color: color(e.color, s + '.color'),
                  haloColor: color(e.haloColor, s + '.haloColor'),
                  opacity: number(e.opacity, s + '.opacity', 0, 1),
                  blurPixels: number(e.blurPixels, s + '.blurPixels', 0, 24),
                  layer: e.layer as 'behind' | 'front',
                };
              },
            );
      const key = {
          canonicalFrame,
          glyphs: poses,
          ...(glows ? { glows } : {}),
          ...(emissions ? { emissions } : {}),
        },
        cost = dropEncouragementGlyphKeyCost({ glyphs, ...(frontHalo ? { frontHalo } : {}) }, key);
      if (
        cost.drawTriangles > 32768 ||
        cost.scratchPixels > 2097152 ||
        cost.emissions > 4 ||
        cost.emissionAreaPixels > 65536 ||
        cost.emissionBoundsPixels > 65536 ||
        cost.emissionBlurBoundsPixels > 262144
      )
        fail(p + '.frameBudget');
      if ((cost.haloBoundsPixels ?? 0) > 65536) fail(p + '.frontHalo.boundsBudget');
      if ((cost.haloDeviceTiles ?? 0) > 16) fail(p + '.frontHalo.tileBudget');
      totalPoses += poses.length;
      totalTriangles += cost.meshTriangles;
      if (totalPoses > 8192 || totalTriangles > 262144) fail('recipePoseOrMeshBudget');
      return key;
    });
    if (keys.some((k, i) => i > 0 && k.canonicalFrame <= keys[i - 1]!.canonicalFrame))
      fail(path + '.keys.order');
    totalKeys += keys.length;
    if (totalKeys > 4096) fail('totalKeys');
    return {
      actionIndex,
      cycleIndex,
      canonicalFps: 30,
      atlasSlot: 'ui.atlas.6',
      backColor: color(q.backColor, path + '.backColor'),
      sideColor: color(q.sideColor, path + '.sideColor'),
      glyphs,
      keys,
      ...(frontHalo ? { frontHalo } : {}),
    };
  });
}
/** Exactly one authored canonical bin. Missing frames/glyphs are transparent. */
export function sampleDropEncouragementGlyphKey(
  cue: DropEncouragementGlyphCue,
  elapsedFrames: number,
  outputFps: number,
): DropEncouragementGlyphKey | undefined {
  if (
    !Number.isFinite(elapsedFrames) ||
    elapsedFrames < 0 ||
    !Number.isFinite(outputFps) ||
    outputFps <= 0
  )
    return;
  const canonical = Math.floor((elapsedFrames * 30) / outputFps + 1e-8);
  return cue.keys.find((k) => k.canonicalFrame === canonical);
}
/** Native cue origins only; this UI lifetime never extends its game clear or Take. */
export function bindDropEncouragementGlyphCues(
  cues: readonly DropEncouragementGlyphCue[] | undefined,
  waves: ReadonlyArray<{
    actionIndex: number;
    cycleIndex: number;
    startFrame: number;
    originFrame?: number;
  }>,
  outputFps: number,
  totalFrames: number,
): DropEncouragementGlyphBinding[] {
  const events = new Map<
    number,
    {
      drawTriangles: number;
      scratchPixels: number;
      glows: number;
      emissions: number;
      emissionAreaPixels: number;
      emissionBoundsPixels: number;
      emissionBlurBoundsPixels: number;
      haloGroups: number;
      haloBoundsPixels: number;
      haloDeviceTiles: number;
    }
  >();
  const add = (
    frame: number,
    cost: ReturnType<typeof dropEncouragementGlyphKeyCost>,
    sign: number,
  ) => {
    const old = events.get(frame) ?? {
      drawTriangles: 0,
      scratchPixels: 0,
      glows: 0,
      emissions: 0,
      emissionAreaPixels: 0,
      emissionBoundsPixels: 0,
      emissionBlurBoundsPixels: 0,
      haloGroups: 0,
      haloBoundsPixels: 0,
      haloDeviceTiles: 0,
    };
    events.set(frame, {
      drawTriangles: old.drawTriangles + cost.drawTriangles * sign,
      scratchPixels: old.scratchPixels + cost.scratchPixels * sign,
      glows: old.glows + cost.glows * sign,
      emissions: old.emissions + cost.emissions * sign,
      emissionAreaPixels: old.emissionAreaPixels + cost.emissionAreaPixels * sign,
      emissionBoundsPixels: old.emissionBoundsPixels + cost.emissionBoundsPixels * sign,
      emissionBlurBoundsPixels: old.emissionBlurBoundsPixels + cost.emissionBlurBoundsPixels * sign,
      haloGroups: old.haloGroups + (cost.haloGroups ?? 0) * sign,
      haloBoundsPixels: old.haloBoundsPixels + (cost.haloBoundsPixels ?? 0) * sign,
      haloDeviceTiles: old.haloDeviceTiles + (cost.haloDeviceTiles ?? 0) * sign,
    });
  };
  const bindings = (cues ?? []).map((cue, cueIndex) => {
    const wave = waves.find(
      (w) => w.actionIndex === cue.actionIndex && w.cycleIndex === cue.cycleIndex,
    );
    if (!wave) throw new Error(`DROP_ENCOURAGEMENT_GLYPH_NATIVE_WAVE_MISSING: ${cueIndex}`);
    const originFrame = wave.originFrame ?? wave.startFrame,
      endFrame = originFrame + ((cue.keys.at(-1)!.canonicalFrame + 1) * outputFps) / 30;
    if (originFrame < 0 || endFrame > totalFrames + 1e-8)
      throw new Error(`DROP_ENCOURAGEMENT_GLYPH_OUTPUT_LIFETIME_EXCEEDED: ${cueIndex}`);
    for (const key of cue.keys) {
      const start = Math.ceil(originFrame + (key.canonicalFrame * outputFps) / 30 - 1e-8),
        end = Math.ceil(originFrame + ((key.canonicalFrame + 1) * outputFps) / 30 - 1e-8);
      if (end > start) {
        const cost = dropEncouragementGlyphKeyCost(cue, key);
        add(start, cost, 1);
        add(end, cost, -1);
      }
    }
    return { cueIndex, originFrame, endFrame };
  });
  let drawTriangles = 0,
    scratchPixels = 0,
    glows = 0,
    emissions = 0,
    emissionAreaPixels = 0,
    emissionBoundsPixels = 0,
    emissionBlurBoundsPixels = 0,
    haloGroups = 0,
    haloBoundsPixels = 0,
    haloDeviceTiles = 0;
  for (const [, delta] of [...events].sort((a, b) => a[0] - b[0])) {
    drawTriangles += delta.drawTriangles;
    scratchPixels += delta.scratchPixels;
    glows += delta.glows;
    emissions += delta.emissions;
    emissionAreaPixels += delta.emissionAreaPixels;
    emissionBoundsPixels += delta.emissionBoundsPixels;
    emissionBlurBoundsPixels += delta.emissionBlurBoundsPixels;
    haloGroups += delta.haloGroups;
    haloBoundsPixels += delta.haloBoundsPixels;
    haloDeviceTiles += delta.haloDeviceTiles;
    if (haloGroups > 2 || haloBoundsPixels > 65536 + 1e-8 || haloDeviceTiles > 16)
      throw new Error('DROP_ENCOURAGEMENT_GLYPH_HALO_CONCURRENT_BUDGET');
    if (
      drawTriangles > 32768 ||
      scratchPixels > 2097152 ||
      glows > 2 ||
      emissions > 4 ||
      emissionAreaPixels > 65536 + 1e-8 ||
      emissionBoundsPixels > 65536 + 1e-8 ||
      emissionBlurBoundsPixels > 262144 + 1e-8
    )
      throw new Error('DROP_ENCOURAGEMENT_GLYPH_CONCURRENT_BUDGET');
  }
  return bindings;
}

const n = (minimum: number, maximum: number) => ({ type: 'number', minimum, maximum });
const int = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });
const pointSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y'],
  properties: { x: n(-16384, 16384), y: n(-16384, 16384) },
};
const idSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 64,
  pattern: '^[A-Za-z][A-Za-z0-9_.-]{0,63}$',
};
const colorSchema = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
export const DROP_ENCOURAGEMENT_GLYPH_CUES_SCHEMA = {
  type: 'array',
  maxItems: 256,
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'actionIndex',
      'cycleIndex',
      'canonicalFps',
      'atlasSlot',
      'backColor',
      'sideColor',
      'glyphs',
      'keys',
    ],
    properties: {
      actionIndex: int(0, 999),
      cycleIndex: int(0, 63),
      canonicalFps: { const: 30 },
      atlasSlot: { const: 'ui.atlas.6' },
      backColor: colorSchema,
      sideColor: colorSchema,
      frontHalo: {
        type: 'object',
        additionalProperties: false,
        required: ['glyphIds', 'color', 'radiusPixels', 'blurPixels', 'opacity'],
        properties: {
          glyphIds: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: idSchema },
          color: colorSchema,
          radiusPixels: n(0, 4),
          blurPixels: n(0, 4),
          opacity: n(0, 1),
        },
      },
      glyphs: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'sourceX', 'sourceY', 'sourceWidth', 'sourceHeight'],
          properties: {
            id: idSchema,
            sourceX: int(0, 8192),
            sourceY: int(0, 8192),
            sourceWidth: int(1, 4096),
            sourceHeight: int(1, 4096),
          },
        },
      },
      keys: {
        type: 'array',
        minItems: 1,
        maxItems: 240,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['canonicalFrame', 'glyphs'],
          properties: {
            canonicalFrame: int(0, 239),
            glyphs: {
              type: 'array',
              maxItems: 8,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'quad', 'face'],
                properties: {
                  id: idSchema,
                  quad: { type: 'array', minItems: 4, maxItems: 4, items: pointSchema },
                  face: { enum: ['front', 'back'] },
                  opacity: n(0, 1),
                  extrusion: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['x', 'y'],
                    properties: { x: n(-32, 32), y: n(-32, 32), steps: int(1, 16) },
                  },
                },
              },
            },
            glows: {
              type: 'array',
              maxItems: 2,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['center', 'radiusX', 'radiusY', 'color', 'blurPixels', 'opacity'],
                properties: {
                  center: pointSchema,
                  radiusX: n(0.01, 128),
                  radiusY: n(0.01, 128),
                  color: { enum: ['white', 'blue'] },
                  blurPixels: n(0, 24),
                  opacity: n(0, 0.2),
                },
              },
            },
            emissions: {
              type: 'array',
              maxItems: 4,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['points', 'color', 'haloColor', 'opacity', 'blurPixels', 'layer'],
                properties: {
                  points: { type: 'array', minItems: 3, maxItems: 12, items: pointSchema },
                  color: colorSchema,
                  haloColor: colorSchema,
                  opacity: n(0, 1),
                  blurPixels: n(0, 24),
                  layer: { enum: ['behind', 'front'] },
                },
              },
            },
          },
        },
      },
    },
  },
};
export const DROP_ENCOURAGEMENT_GLYPH_ATLAS_MAX_PIXELS =
  ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxDecodedPixels;
