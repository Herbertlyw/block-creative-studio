import { createBBProject, appendBBReplay } from '../games/block-placement/authoring/createProject';
import { applyPlacement } from '../nativeReference/games/block-placement/runtime/gameEngine';
import type { GameSnapshot, PlacementAction } from '../nativeReference/domain/types';
import { measuredFrameSeconds, validateReferenceMeasurement } from './referenceMeasurement';
import Ajv from 'ajv/dist/2020';
import schema from '../../contracts/bb/workbench-extensions/video-gameplay-annotation-v1.schema.json';
const checkAnnotation = new Ajv({ allErrors: true, strict: false }).compile(schema);

/** Explicit author input; no recognition, fallback action, or implicit confirmation. */
export async function buildObservedTake(
  raw: unknown,
  measurement: unknown,
  sourceHash: string,
  width: number,
  height: number,
) {
  if (!checkAnnotation(raw))
    throw new Error(
      `标注不完整或无效：${checkAnnotation.errors?.map((e) => `${e.instancePath || '/'} ${e.message}`).join('；')}`,
    );
  const input = raw as any;
  const keys = (value: any, allowed: string[], label: string) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((k) => !allowed.includes(k))
    )
      throw new Error(`${label} 包含未知或无效字段。`);
  };
  const measured = validateReferenceMeasurement(measurement, sourceHash, width, height);
  if (
    input?.version !== '1.0.0' ||
    input.sourceSha256 !== sourceHash ||
    input.board?.confirmed !== true ||
    input.supply?.confirmed !== true ||
    !Array.isArray(input.actions) ||
    !input.actions.length
  )
    throw new Error('标注的来源、初盘、供给或动作缺失或未确认。');
  if (
    Object.keys(input).some(
      (k) =>
        !['version', 'sourceSha256', 'board', 'supply', 'actions', 'output', 'seed'].includes(k),
    )
  )
    throw new Error('标注包含未支持字段，不能静默丢弃。');
  keys(input.board, ['confirmed', 'cells'], '初盘');
  keys(input.supply, ['confirmed', 'rounds', 'initialUsedSlots'], '供给');
  keys(input.output, ['width', 'height', 'fps'], '输出');
  if (
    !Array.isArray(input.board.cells) ||
    input.board.cells.length !== 8 ||
    input.board.cells.some(
      (r: unknown) =>
        !Array.isArray(r) ||
        r.length !== 8 ||
        r.some(
          (c: unknown) =>
            c !== null &&
            !['coral', 'amber', 'lime', 'cyan', 'blue', 'violet', 'rose'].includes(c as string),
        ),
    )
  )
    throw new Error('初盘必须是完整的 8×8 已知颜色或空格。');
  const rounds = input.supply.rounds;
  if (
    !Array.isArray(rounds) ||
    !rounds.length ||
    rounds.some(
      (r: unknown) =>
        !Array.isArray(r) ||
        r.length !== 3 ||
        r.some((p: any) => !p || typeof p.shapeId !== 'string' || typeof p.color !== 'string'),
    )
  )
    throw new Error('固定供给每轮必须明确三个候选。');
  if (
    !Number.isInteger(input.seed) ||
    input.seed < 0 ||
    !Array.isArray(input.supply.initialUsedSlots) ||
    new Set(input.supply.initialUsedSlots).size !== input.supply.initialUsedSlots.length ||
    input.supply.initialUsedSlots.some(
      (s: unknown) => !Number.isInteger(s) || (s as number) < 0 || (s as number) > 2,
    )
  )
    throw new Error('必须明确种子和初始已使用槽位。');
  for (const round of rounds) for (const piece of round) keys(piece, ['shapeId', 'color'], '候选');
  const output = input.output;
  if (
    !output ||
    !Number.isInteger(output.fps) ||
    output.fps < 15 ||
    output.fps > 60 ||
    !Number.isInteger(output.width) ||
    !Number.isInteger(output.height)
  )
    throw new Error('输出尺寸或帧率缺失。');
  const project = createBBProject({
    projectId: 'observed-video',
    name: '作者标注工程',
    seed: input.seed,
    initialUsedSlots: input.supply.initialUsedSlots,
    board: { rows: 8, cols: 8, cells: input.board.cells },
    fixedSupply: rounds,
    width: output.width,
    height: output.height,
    fps: output.fps,
  });
  if (new Set(input.actions.map((a: any) => a.id)).size !== input.actions.length)
    throw new Error('动作 ID 必须唯一。');
  let state = structuredClone(project.game.initialState.data) as GameSnapshot;
  const actions: PlacementAction[] = [],
    timing: Array<Record<string, unknown>> = [];
  let lastRelease = -1;
  for (const [index, entry] of input.actions.entries()) {
    const prefix = `第 ${index + 1} 步`;
    keys(
      entry,
      [
        'id',
        'confirmed',
        'slot',
        'row',
        'col',
        'pickupFrame',
        'releaseFrame',
        'clearFrame',
        'clearRows',
        'clearCols',
        'path',
      ],
      prefix,
    );
    if (
      !entry ||
      entry.confirmed !== true ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      !Number.isInteger(entry.slot) ||
      entry.slot < 0 ||
      entry.slot > 2 ||
      !Number.isInteger(entry.row) ||
      !Number.isInteger(entry.col) ||
      !Array.isArray(entry.clearRows) ||
      !Array.isArray(entry.clearCols) ||
      !Array.isArray(entry.path) ||
      entry.path.length < 2
    )
      throw new Error(`${prefix} 的槽位、落点、消除或轨迹缺失或未确认。`);
    const start = measuredFrameSeconds(measured, entry.pickupFrame),
      release = measuredFrameSeconds(measured, entry.releaseFrame),
      clear = measuredFrameSeconds(measured, entry.clearFrame);
    if (start < lastRelease || release <= start || clear < release)
      throw new Error(`${prefix} 的拾取、释放或消除时间顺序无效。`);
    const piece = state.pieces.find((p) => p.slotIndex === entry.slot && !p.used);
    if (!piece) throw new Error(`${prefix} 的槽位 ${entry.slot} 没有可用候选。`);
    const durationFrames = Math.round((release - start) * output.fps);
    if (durationFrames < 1) throw new Error(`${prefix} 的时长小于一个输出帧。`);
    let previous = -1;
    const pointerPath = entry.path.map((p: any) => {
      keys(p, ['frame', 'x', 'y'], `${prefix} 轨迹`);
      const t = measuredFrameSeconds(measured, p.frame);
      if (
        t < start ||
        t > release ||
        t <= previous ||
        !Number.isFinite(p.x) ||
        p.x < 0 ||
        p.x > 1 ||
        !Number.isFinite(p.y) ||
        p.y < 0 ||
        p.y > 1
      )
        throw new Error(`${prefix} 的轨迹时间或坐标无效。`);
      previous = t;
      return { frameOffset: Math.round((t - start) * output.fps), x: p.x, y: p.y };
    });
    if (entry.path[0].frame !== entry.pickupFrame || entry.path.at(-1).frame !== entry.releaseFrame)
      throw new Error(`${prefix} 的轨迹必须覆盖拾取与释放。`);
    const action: PlacementAction = {
      id: entry.id,
      actor: 'human',
      pieceId: piece.id,
      anchor: { row: entry.row, col: entry.col },
      durationFrames,
      pointerPath,
    };
    const transition = applyPlacement(state, action);
    if (!transition)
      throw new Error(
        `${prefix} 的槽位 ${entry.slot} 在 (${entry.row}, ${entry.col}) 不合法：重叠、越界、候选已使用或供给耗尽。`,
      );
    const equal = (a: number[], b: number[]) =>
      JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));
    if (
      !equal(transition.clear.rows, entry.clearRows) ||
      !equal(transition.clear.cols, entry.clearCols)
    )
      throw new Error(`${prefix} 的消除行列与参考规则不一致。`);
    actions.push(action);
    state = transition.after;
    lastRelease = release;
    timing.push({
      id: entry.id,
      pieceId: piece.id,
      start,
      release,
      clear,
      outputDurationFrames: durationFrames,
      durationRoundingSeconds: durationFrames / output.fps - (release - start),
    });
  }
  const result = appendBBReplay(project, 'observed-take', actions);
  return {
    document: result,
    timing,
    limitations: [
      '普通预览尚未绑定各动作绝对事件时间；请勿将生成视频视为已对齐参考。',
      '素材、音乐和参考校准尚未由此入口绑定。',
    ],
  };
}
