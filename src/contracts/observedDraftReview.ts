import { measuredFrameSeconds, type ReferenceMeasurement } from './referenceMeasurement';

const parse = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const semanticAction = (action: any) => {
  if (!action || typeof action !== 'object') return action;
  const { confirmed: _confirmed, ...rest } = action;
  return rest;
};

/** Editing an earlier action invalidates downstream observations, including edits in raw JSON.
 * Confirmation-only changes do not invalidate an otherwise unchanged later step.
 */
export function invalidateObservedAnnotation(previous: string, value: string): string {
  const before = parse(previous),
    next = parse(value);
  if (!before || !next || !Array.isArray(before.actions) || !Array.isArray(next.actions))
    return value;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const boardChanged = !same(before.board?.cells, next.board?.cells);
  const supplyChanged = !same(
    [before.supply?.rounds, before.supply?.initialUsedSlots],
    [next.supply?.rounds, next.supply?.initialUsedSlots],
  );
  let first =
    boardChanged ||
    supplyChanged ||
    !same(
      [before.sourceSha256, before.seed, before.output],
      [next.sourceSha256, next.seed, next.output],
    )
      ? 0
      : -1;
  if (first < 0)
    first = next.actions.findIndex(
      (action: any, index: number) =>
        !same(semanticAction(action), semanticAction(before.actions[index])),
    );
  if (boardChanged && next.board) next.board.confirmed = false;
  if (supplyChanged && next.supply) next.supply.confirmed = false;
  if (first < 0) return value;
  for (const action of next.actions.slice(first))
    if (action && typeof action === 'object') action.confirmed = false;
  return JSON.stringify(next, null, 2);
}

/** Output event quantization matches bindObservedCalibration, not the browser seek clock. */
export function observedFramePosition(
  measurement: ReferenceMeasurement,
  sourceFrame: number,
  outputFps: number,
) {
  if (!Number.isInteger(outputFps) || outputFps < 15 || outputFps > 60)
    throw new Error('输出帧率必须为 15–60 的整数。');
  const seconds = measuredFrameSeconds(measurement, sourceFrame);
  const outputFrame = Math.ceil(seconds * outputFps - 1e-7);
  return { seconds, outputFrame, outputSeconds: outputFrame / outputFps };
}

export interface ObservationBlocker {
  scope: 'gameplay' | 'calibration';
  message: string;
}

/** Read-only preflight. Full schema, gameplay and source validation still runs on generation. */
export function observedDraftBlockers(
  annotation: string,
  geometry: string,
  measurement: ReferenceMeasurement | null,
  hash: string,
): ObservationBlocker[] {
  const result: ObservationBlocker[] = [];
  const add = (message: string, scope: ObservationBlocker['scope'] = 'gameplay') =>
    result.push({ scope, message });
  if (!measurement) add('导入同源恒帧率测量；播放器时间不能当作精确源帧。');
  const draft = parse(annotation),
    g = parse(geometry);
  if (!draft) {
    add('结构化标注 JSON 缺失或无法解析。');
    return result;
  }
  if (draft.sourceSha256 !== hash) add('结构化标注的源视频 SHA-256 不匹配。');
  if (draft.board?.confirmed !== true) add('初始棋盘待确认。');
  if (Array.isArray(draft.board?.cells))
    for (const [row, cells] of draft.board.cells.entries()) {
      if (!Array.isArray(cells)) continue;
      const unknown = cells.flatMap((cell: unknown, col: number) =>
        cell === 'unknown' ? [col] : [],
      );
      if (unknown.length) add(`棋盘第 ${row} 行的列 ${unknown.join('、')} 未确认。`);
    }
  if (draft.supply?.confirmed !== true) add('固定供给待确认。');
  if (Array.isArray(draft.supply?.rounds))
    draft.supply.rounds.forEach((round: any, index: number) => {
      if (
        !Array.isArray(round) ||
        round.length !== 3 ||
        round.some((piece: any) => !piece?.shapeId || !piece?.color)
      )
        add(`供给第 ${index + 1} 轮的形状或颜色未确认。`);
    });
  if (!Number.isInteger(draft.output?.fps) || draft.output.fps < 15 || draft.output.fps > 60)
    add('输出帧率须为 15–60 的整数，不能安全换算时间。');
  if (!Array.isArray(draft.actions) || !draft.actions.length) add('至少标注一个动作。');
  const ids = new Set<string>();
  for (const [index, action] of (Array.isArray(draft.actions) ? draft.actions : []).entries()) {
    const label = `Take「observed-take」第 ${index + 1} 步 · ${action?.id ?? '无 ID'}`;
    if (!action || typeof action !== 'object') {
      add(`${label} 无效。`);
      continue;
    }
    if (!action.id || ids.has(action.id)) add(`${label} 动作 ID 缺失或重复。`);
    ids.add(action.id);
    if (action.confirmed !== true) add(`${label}：目标、时间、指针路径或消除范围待确认。`);
    if (![action.slot, action.row, action.col].every(Number.isInteger))
      add(`${label}：候选槽位或目标格未知。`);
    if (
      [action.pickupFrame, action.releaseFrame, action.clearFrame].some(
        (frame) =>
          !Number.isInteger(frame) ||
          frame < 0 ||
          (measurement && frame >= measurement.source.frameCount),
      )
    )
      add(`${label}：拾取、释放或消除源帧缺失或越界。`);
    if (action.releaseFrame <= action.pickupFrame || action.clearFrame < action.releaseFrame)
      add(`${label}：拾取、释放、消除时间顺序错误。`);
    if (
      !Array.isArray(action.path) ||
      action.path.length < 2 ||
      action.path.some(
        (point: any) =>
          !point ||
          !Number.isInteger(point.frame) ||
          ![point.x, point.y].every(
            (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1,
          ),
      )
    )
      add(`${label}：至少需要两个已知时间和坐标的指针点。`);
    if (!g || !Array.isArray(g.motions) || g.motions[index]?.actionId !== action.id)
      add(`${label}：方块轨迹缺失或动作 ID/顺序不匹配，请重绑轨迹。`, 'calibration');
    else if (g.motions[index].confirmed !== true) add(`${label}：方块轨迹待确认。`, 'calibration');
  }
  if (!g || g.confirmed !== true) add('棋盘范围及候选区几何待确认。', 'calibration');
  if (g && Array.isArray(g.motions) && g.motions.length !== draft.actions?.length)
    add('方块轨迹数量与动作数量不一致，不能沿用旧绑定。', 'calibration');
  return result;
}
