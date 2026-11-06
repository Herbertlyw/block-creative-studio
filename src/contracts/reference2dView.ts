import Ajv from 'ajv/dist/2020';
import schema from '../../contracts/bb/workbench-extensions/reference2d-view-v1.schema.json';
import type { BBTimelineFrame } from '../games/block-placement/planning/bbTimelinePlan';
import { isValidPlacementContract } from './validateContract';
import { inspectNativeRuntime } from './inspectNativeRuntime';
import { hasReferenceCalibration } from './hasReferenceCalibration';
import { setJsonObjectProperty } from './editNativeAction';
import { compileNativeTake } from './compileNativeTake';
import type { BrowserAssetSources } from './browserAssetReferences';
type Transform = { scale: number; x: number; y: number };
export type WorkbenchView = {
  contract: 'bcs.workbench.reference2d-view';
  version: '1.0.0';
  design: { width: 1064; height: 1788 };
  fps: number;
  layout: Transform;
  camera: { mode: 'fixed' | 'keyframed'; keyframes: Array<Transform & { frame: number }> };
};
const check = new Ajv({ strict: false, allErrors: true }).compile(schema);
export function parseWorkbenchView(
  raw: unknown,
  fps: number,
  totalFrames?: number,
): WorkbenchView | null {
  if (raw === undefined) return null;
  if (!check(raw))
    throw new Error(
      `工作台 2D 视图合同无效：${check.errors?.map((e) => `${e.instancePath || '/'} ${e.message}`).join('；')}`,
    );
  const view = raw as WorkbenchView,
    points = view.camera.keyframes;
  if (view.fps !== fps) throw new Error('工作台 2D 镜头帧率与工程不一致；不能忽略镜头时钟。');
  if (
    points[0]!.frame !== 0 ||
    points.some((p, i) => i > 0 && p.frame <= points[i - 1]!.frame) ||
    (view.camera.mode === 'fixed' && points.length !== 1) ||
    (view.camera.mode === 'keyframed' && points.length < 2)
  )
    throw new Error('工作台 2D 镜头关键帧无效；必须从 0 开始严格递增。');
  if (totalFrames !== undefined && points.some((p) => p.frame >= totalFrames))
    throw new Error('工作台 2D 镜头关键帧超出 Take 时长。');
  return view;
}
export function cameraAt(view: WorkbenchView, frame: number): Transform {
  const points = view.camera.keyframes;
  let i = 0;
  while (i + 1 < points.length && points[i + 1]!.frame <= frame) i++;
  const a = points[i]!,
    b = points[i + 1];
  if (!b) return { scale: a.scale, x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, (frame - a.frame) / (b.frame - a.frame)));
  return {
    scale: a.scale + (b.scale - a.scale) * t,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}
/** Transform around the design center; output contains the design before cropping at the viewport. */
export function viewTransform(view: WorkbenchView, frame: number, width: number, height: number) {
  const base = Math.min(width / view.design.width, height / view.design.height),
    camera = cameraAt(view, frame),
    scale = view.layout.scale * camera.scale;
  return {
    scale,
    cx: width / 2,
    cy: height / 2,
    dx: base * (camera.scale * view.layout.x + camera.x),
    dy: base * (camera.scale * view.layout.y + camera.y),
    base,
  };
}
export function designToOutput(
  view: WorkbenchView,
  frame: number,
  width: number,
  height: number,
  p: { x: number; y: number },
) {
  const m = viewTransform(view, frame, width, height);
  return {
    x: m.cx + (p.x - view.design.width / 2) * m.base * m.scale + m.dx,
    y: m.cy + (p.y - view.design.height / 2) * m.base * m.scale + m.dy,
  };
}
export function outputToDesign(
  view: WorkbenchView,
  frame: number,
  width: number,
  height: number,
  p: { x: number; y: number },
) {
  if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return null;
  const m = viewTransform(view, frame, width, height);
  const x = (p.x - m.cx - m.dx) / (m.base * m.scale) + view.design.width / 2,
    y = (p.y - m.cy - m.dy) / (m.base * m.scale) + view.design.height / 2;
  return x < 0 || y < 0 || x >= view.design.width || y >= view.design.height ? null : { x, y };
}
/** The scene remains the verified reference implementation; this compositor moves the whole scene. */
export function paintWorkbenchView(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
  view: WorkbenchView,
  frame: number,
): void {
  const context = target.getContext('2d');
  if (!context) throw new Error('无法创建 2D 视图画布。');
  const m = viewTransform(view, frame, target.width, target.height);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#000';
  context.fillRect(0, 0, target.width, target.height);
  context.translate(m.cx + m.dx, m.cy + m.dy);
  context.scale(m.scale, m.scale);
  context.translate(-m.cx, -m.cy);
  context.drawImage(source, 0, 0, target.width, target.height);
  context.restore();
}
export function hitWorkbenchView(
  view: WorkbenchView,
  frame: number,
  width: number,
  height: number,
  point: { x: number; y: number },
  state: BBTimelineFrame,
) {
  if (state.frameIndex !== frame || state.fps !== view.fps)
    throw new Error('BB_VIEW_FRAME_MISMATCH');
  const p = outputToDesign(view, frame, width, height, point);
  if (!p) return null;
  const grid = state.geometry.board,
    spanX = grid.pitch * (grid.cols - 1) + grid.cell,
    spanY = grid.pitch * (grid.rows - 1) + grid.cell;
  if (p.x >= grid.x && p.x <= grid.x + spanX && p.y >= grid.y && p.y <= grid.y + spanY) {
    const col = Math.floor((p.x - grid.x) / grid.pitch),
      row = Math.floor((p.y - grid.y) / grid.pitch),
      x = (p.x - grid.x) % grid.pitch,
      y = (p.y - grid.y) % grid.pitch;
    if (
      row >= 0 &&
      row < grid.rows &&
      col >= 0 &&
      col < grid.cols &&
      x <= grid.cell &&
      y <= grid.cell
    )
      return { kind: 'cell' as const, row, col };
  }
  for (const item of state.rackDrawables) {
    const pad = 28,
      w = item.cols * item.pitch,
      h = item.rows * item.pitch;
    if (
      p.x >= item.x - pad &&
      p.x <= item.x + w + pad &&
      p.y >= item.y - pad &&
      p.y <= item.y + h + pad
    )
      return { kind: 'piece' as const, pieceId: item.piece.id };
  }
  return null;
}
export async function saveWorkbenchView(
  text: string,
  raw: unknown,
  sources: BrowserAssetSources = {},
): Promise<string> {
  const doc = JSON.parse(text.startsWith('\ufeff') ? text.slice(1) : text);
  if (!isValidPlacementContract(doc) || hasReferenceCalibration(doc))
    throw new Error('此工程不能保存普通 2D 视图。');
  if (doc.direction?.style?.workbenchView2D !== undefined)
    parseWorkbenchView(doc.direction.style.workbenchView2D, doc.production.output.fps);
  if (
    doc.direction?.production &&
    Object.keys(doc.direction.production).some((key) => !['version', 'audio'].includes(key))
  )
    throw new Error('工程包含未接入的 production 控制，不能保存 2D 视图。');
  const audit = inspectNativeRuntime(doc);
  if (!audit.validated) throw new Error(audit.message);
  const bad = audit.takes.find((t) => !t.legal);
  if (bad) throw new Error(`${bad.takeId}：${bad.detail}`);
  for (const take of audit.takes)
    parseWorkbenchView(
      raw,
      doc.production.output.fps,
      compileNativeTake(doc, take.takeId).compiled.totalFrames,
    );
  const edited = setJsonObjectProperty(text, ['direction', 'style'], 'workbenchView2D', raw),
    output = JSON.parse(edited);
  const { inlineBrowserStudioReferences } = await import('./browserAssetReferences');
  const resolved = await inlineBrowserStudioReferences(output, sources);
  if (output.direction.style.workbenchVariantV1 !== undefined) {
    const { resolveSavedWorkbenchVariant } = await import('./workbenchVariant');
    for (const take of audit.takes) resolveSavedWorkbenchVariant(resolved.document, take.takeId);
  }
  return edited;
}
