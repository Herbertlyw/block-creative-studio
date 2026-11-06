import { parseCalibrationRackCenters } from './calibrationRack';
import { buildObservedTake } from './buildObservedTake';
import { measuredFrameSeconds, validateReferenceMeasurement } from './referenceMeasurement';
import { parseReferenceCalibration } from '../games/block-placement/calibrated/parseCalibration';
import { prepareCalibratedRenderer } from './calibratedRenderer';

/** Coordinates are authored 1080×1920 design pixels, piece bounding-box top-left,
 * with the fourth motion value the current per-cell size. No pointer-to-piece
 * anchor or source-video scaling is inferred. */
export async function bindObservedCalibration(
  annotation: unknown,
  measurement: unknown,
  hash: string,
  width: number,
  height: number,
  rawGeometry: unknown,
) {
  const input = annotation as any,
    g = rawGeometry as any;
  const keys = (v: any, allowed: string[]) =>
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).every((k) => allowed.includes(k));
  if (
    !keys(g, [
      'confirmed',
      'coordinateSystem',
      'board',
      'rackY',
      'rackCell',
      'rackCenters',
      'theme',
      'bestScore',
      'motions',
    ]) ||
    g.confirmed !== true ||
    g.coordinateSystem !== 'design-1080x1920-piece-top-left' ||
    !Array.isArray(g.board) ||
    g.board.length !== 3 ||
    !g.board.every(Number.isFinite) ||
    !Number.isFinite(g.rackY) ||
    !Number.isFinite(g.rackCell) ||
    !Array.isArray(g.rackCenters) ||
    g.rackCenters.length !== 3 ||
    !['grey', 'pink', 'purple'].includes(g.theme) ||
    !Number.isSafeInteger(g.bestScore) ||
    g.bestScore < 0 ||
    !Array.isArray(g.motions)
  )
    throw new Error('须确认 1080×1920 设计坐标、棋盘、候选和逐动作方块包围盒轨迹。');
  const rackCenters = parseCalibrationRackCenters(g.rackCenters)!;
  const m = validateReferenceMeasurement(measurement, hash, width, height),
    built = await buildObservedTake(annotation, m, hash, width, height);
  if (g.motions.length !== input.actions.length) throw new Error('每个动作必须单独提供方块轨迹。');
  const fpsParts = m.source.fps.split('/').map(Number),
    fps = fpsParts[0]! / (fpsParts[1] ?? 1),
    duration = m.source.frameCount / fps;
  let previousClear = -1;
  const calibrations = input.actions.map((a: any, index: number) => {
    const path = g.motions[index];
    if (
      !keys(path, ['actionId', 'confirmed', 'points']) ||
      path.confirmed !== true ||
      path.actionId !== a.id ||
      !Array.isArray(path.points) ||
      path.points.length < 2
    )
      throw new Error(`第 ${index + 1} 步缺少匹配动作 ID 的已确认方块轨迹。`);
    const start = measuredFrameSeconds(m, a.pickupFrame),
      release = measuredFrameSeconds(m, a.releaseFrame);
    if (!a.clearRows.length && !a.clearCols.length && a.clearFrame !== a.releaseFrame)
      throw new Error(`第 ${index + 1} 步没有消除，清除帧必须等于释放帧。`);
    const clear = measuredFrameSeconds(m, a.clearFrame);
    let previous = -1;
    if (start < previousClear)
      throw new Error(`第 ${index + 1} 步开始早于上一步消除完成，当前渲染器无法同时表达。`);
    if (
      Math.ceil(release * input.output.fps - 1e-7) >= Math.round(duration * input.output.fps) ||
      Math.ceil(clear * input.output.fps - 1e-7) >= Math.round(duration * input.output.fps)
    )
      throw new Error(`第 ${index + 1} 步事件在输出帧范围之外。`);
    previousClear = clear;
    const motion = path.points.map((p: any) => {
      if (
        !keys(p, ['frame', 'x', 'y', 'cellSize']) ||
        ![p.x, p.y, p.cellSize].every(Number.isFinite)
      )
        throw new Error(`第 ${index + 1} 步轨迹点缺少位置或尺寸。`);
      const t = measuredFrameSeconds(m, p.frame);
      if (t < start || t > release || t <= previous)
        throw new Error(`第 ${index + 1} 步方块轨迹时间无效。`);
      previous = t;
      return [t, p.x, p.y, p.cellSize];
    });
    if (path.points[0].frame !== a.pickupFrame || path.points.at(-1).frame !== a.releaseFrame)
      throw new Error(`第 ${index + 1} 步方块轨迹必须覆盖拾取和释放。`);
    const last = path.points.at(-1),
      [gx, gy, pitch] = g.board;
    if (
      Math.abs(last.x - (gx + a.col * pitch)) > 0.01 ||
      Math.abs(last.y - (gy + a.row * pitch)) > 0.01 ||
      Math.abs(last.cellSize - pitch) > 0.01
    )
      throw new Error(`第 ${index + 1} 步释放的方块左上角或单格尺寸与目标格不一致；不能自动吸附。`);
    return { actionId: a.id, start, release, clear, slot: a.slot, motion };
  });
  const result = structuredClone(built.document);
  const calibration = parseReferenceCalibration(
    {
      version: 1,
      theme: g.theme,
      duration,
      sourceOffset: 0,
      board: g.board,
      rackY: g.rackY,
      rackCell: g.rackCell,
      ...(JSON.stringify(rackCenters) !== '[236,540,844]' ? { rackCenters } : {}),
      bestScore: g.bestScore,
      scoreTrack: [],
      actions: calibrations,
    },
    result,
    'observed-take',
  );
  if (!result.direction?.style || typeof result.direction.style !== 'object')
    throw new Error('作品缺少校准外观。');
  result.direction.style = { ...result.direction.style, referenceCalibration: calibration };
  const prepared = prepareCalibratedRenderer(result, 'observed-take');
  const timing = calibrations.map((a: any) => {
    const event = (seconds: number) => {
      const frame = Math.ceil(seconds * prepared.frameSource.fps - 1e-7);
      return {
        seconds,
        frame,
        renderedSeconds: frame / prepared.frameSource.fps,
        quantizationSeconds: frame / prepared.frameSource.fps - seconds,
      };
    };
    return {
      actionId: a.actionId,
      pickup: event(a.start),
      release: event(a.release),
      clear: event(a.clear),
    };
  });
  return {
    document: result,
    frameSource: prepared.frameSource,
    timing,
    limitations: [
      '校准渲染器绘制的是作者提供的方块轨迹；不绘制输入指针轨迹。',
      '当前使用程序绘制素材；声音与作者素材尚未由此入口绑定。',
    ],
  };
}
