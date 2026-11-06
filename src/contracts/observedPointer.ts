import Ajv from 'ajv/dist/2020';
import schema from '../../contracts/bb/workbench-extensions/observed-pointer-overlay-v1.schema.json';
const check = new Ajv({ strict: false }).compile(schema);
const valid = (value: unknown): boolean => Boolean(check(value));
import { measuredFrameSeconds, validateReferenceMeasurement } from './referenceMeasurement';
import { sourceDesignMap, type SourceDesignMap } from './sourceDesignMap';
import { projectContentHash } from './observedSourceLink';
import { paintPointer } from '../games/block-placement/rendering/pointerLayer';

export type PointerOverlay = {
  contract: 'bcs.workbench.pointer-overlay';
  version: '1.0.0';
  projectSha256: string;
  takeId: string;
  fps: number;
  style: { kind: 'ring'; radius: number; anchor: 'center' };
  tracks: Array<{ actionId: string; points: Array<{ time: number; x: number; y: number }> }>;
};
declare const verifiedPointerBrand: unique symbol;
/** Only a pointer checked against the original project can be bound to a frame source. */
export type VerifiedPointerOverlay = PointerOverlay & { readonly [verifiedPointerBrand]: true };
export async function buildObservedPointer(
  project: unknown,
  annotation: any,
  measurement: unknown,
  sourceHash: string,
  width: number,
  height: number,
  mapping: SourceDesignMap,
  radius: number,
): Promise<PointerOverlay> {
  if (!mapping?.confirmed) throw new Error('必须先确认源画面映射和指针锚点。');
  const map = sourceDesignMap(mapping, width, height),
    m = validateReferenceMeasurement(measurement, sourceHash, width, height),
    doc = project as any;
  if (
    !Number.isFinite(radius) ||
    radius < 4 ||
    radius > 100 ||
    !Array.isArray(annotation?.actions) ||
    doc?.takes?.length !== 1 ||
    !doc.direction?.style?.referenceCalibration
  )
    throw new Error('指针合同需要单 Take、合法半径和校准轨道。');
  const tracks = annotation.actions.map((a: any) => ({
    actionId: a.id,
    points: a.path.map((point: any) => ({
      time: measuredFrameSeconds(m, point.frame),
      ...map.sourceToDesign(point.x * width, point.y * height),
    })),
  }));
  const pointer: PointerOverlay = {
    contract: 'bcs.workbench.pointer-overlay',
    version: '1.0.0',
    projectSha256: await projectContentHash(project),
    takeId: doc.takes[0].takeId,
    fps: doc.production.output.fps,
    style: { kind: 'ring', radius, anchor: 'center' },
    tracks,
  };
  await verifyObservedPointer(project, pointer);
  return pointer;
}
export async function verifyObservedPointer(
  project: unknown,
  raw: unknown,
): Promise<VerifiedPointerOverlay> {
  const p = raw as any,
    d = project as any,
    cal = d?.direction?.style?.referenceCalibration;
  const keys = (v: any, allowed: string[]) =>
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).sort().join(',') === [...allowed].sort().join(',');
  if (
    !valid(p) ||
    !keys(p, ['contract', 'version', 'projectSha256', 'takeId', 'fps', 'style', 'tracks']) ||
    p.contract !== 'bcs.workbench.pointer-overlay' ||
    p.version !== '1.0.0' ||
    !keys(p.style, ['kind', 'radius', 'anchor']) ||
    p.style.kind !== 'ring' ||
    p.style.anchor !== 'center' ||
    !Number.isFinite(p.style.radius) ||
    p.style.radius < 4 ||
    p.style.radius > 100 ||
    !Array.isArray(p.tracks) ||
    !cal ||
    d?.takes?.length !== 1 ||
    p.takeId !== d.takes[0].takeId ||
    p.fps !== d.production?.output?.fps ||
    (await projectContentHash(project)) !== p.projectSha256
  )
    throw new Error('指针扩展、工程身份、Take 或帧率不匹配。');
  if (p.tracks.length !== cal.actions.length) throw new Error('每个动作需要独立指针轨道。');
  for (let i = 0; i < p.tracks.length; i++) {
    const track = p.tracks[i],
      a = cal.actions[i];
    if (
      !keys(track, ['actionId', 'points']) ||
      track.actionId !== a.actionId ||
      !Array.isArray(track.points) ||
      track.points.length < 2
    )
      throw new Error(`第 ${i + 1} 步指针动作 ID 或轨道不匹配。`);
    let last = -Infinity;
    for (const point of track.points) {
      if (
        !keys(point, ['time', 'x', 'y']) ||
        ![point.time, point.x, point.y].every(Number.isFinite) ||
        point.time <= last ||
        point.time < a.start - 1e-8 ||
        point.time > a.release + 1e-8 ||
        Math.abs(point.x) > 4320 ||
        Math.abs(point.y) > 7680
      )
        throw new Error(`第 ${i + 1} 步指针时间或坐标无效。`);
      last = point.time;
    }
    if (
      Math.abs(track.points[0].time - a.start) > 1e-8 ||
      Math.abs(track.points.at(-1).time - a.release) > 1e-8
    )
      throw new Error(`第 ${i + 1} 步指针轨迹未覆盖拾取和释放。`);
  }
  return structuredClone(p) as VerifiedPointerOverlay;
}
export function pointerAt(pointer: PointerOverlay, time: number) {
  for (const track of pointer.tracks) {
    const points = track.points;
    if (time < points[0]!.time || time > points.at(-1)!.time) continue;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      if (time <= b.time) {
        const t = (time - a.time) / (b.time - a.time);
        return { actionId: track.actionId, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
  }
  return null;
}
export function drawObservedPointer(
  canvas: HTMLCanvasElement,
  pointer: PointerOverlay,
  time: number,
) {
  const point = pointerAt(pointer, time);
  drawObservedPointerSample(
    canvas,
    point ? { ...point, radius: pointer.style.radius, kind: 'ring' } : null,
  );
}
/** Draw a sampled pointer supplied by the frame evaluator, in design coordinates. */
export function drawObservedPointerSample(
  canvas: HTMLCanvasElement,
  point: { x: number; y: number; radius: number; kind: 'ring' } | null,
  transform?: { sx: number; sy: number; left: number; top: number },
) {
  if (!point) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('指针画布不可用。');
  ctx.save();
  ctx.setTransform(
    transform?.sx ?? canvas.width / 1080,
    0,
    0,
    transform?.sy ?? canvas.height / 1920,
    transform?.left ?? 0,
    transform?.top ?? 0,
  );
  paintPointer(ctx, point, { kind: 'ring', radius: point.radius });
  ctx.restore();
}

/** Rebind only when one known image entry changes; all gameplay and timing bytes must match. */
export async function rebindPointerForImageVariant(
  source: unknown,
  target: unknown,
  pointer: unknown,
  role: 'background' | 'white' | 'coral' | 'cyan',
) {
  const { inlineBrowserStudioReferences } = await import('./browserAssetReferences');
  await inlineBrowserStudioReferences(target, {});
  const verified = await verifyObservedPointer(source, pointer),
    a = structuredClone(source) as any,
    b = structuredClone(target) as any,
    id = `observed-${role}`;
  if (
    !['background', 'white', 'coral', 'cyan'].includes(role) ||
    !a?.direction?.style?.agentAssets?.entries?.[id] ||
    !b?.direction?.style?.agentAssets?.entries?.[id]
  )
    throw new Error('无法确定变体更改的素材槽位。');
  delete a.direction.style.agentAssets.entries[id];
  delete b.direction.style.agentAssets.entries[id];
  if ((await projectContentHash(a)) !== (await projectContentHash(b)))
    throw new Error('变体更改了所选素材以外的工程内容，不能迁移指针。');
  const next = { ...verified, projectSha256: await projectContentHash(target) };
  return verifyObservedPointer(target, next);
}

/** A valid overlay is not proof of source association until it matches the verified observation. */
export async function verifyPointerAgainstObservation(
  project: unknown,
  pointer: PointerOverlay,
  observation: any,
) {
  const m = observation?.measurement,
    source = m?.source;
  if (!observation?.mapping?.confirmed || !source || typeof observation?.structured !== 'string')
    throw new Error('观察记录没有已确认的指针映射。');
  const expected = await buildObservedPointer(
    project,
    JSON.parse(observation.structured),
    m,
    observation.source?.sha256,
    source.width,
    source.height,
    observation.mapping,
    pointer.style.radius,
  );
  if ((await projectContentHash(expected)) !== (await projectContentHash(pointer)))
    throw new Error('指针旁车与观察记录的已确认路径不一致，不能作为来源对照。');
}
