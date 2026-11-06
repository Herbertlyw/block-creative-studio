import {
  assertGameplayEditSupported,
  readJsonToken,
  replaceJsonToken,
  setJsonObjectProperty,
  type JsonPath,
} from './editNativeAction';
import { inspectNativeReplay } from './inspectNativeReplay';
import { inspectNativeRuntime } from './inspectNativeRuntime';
import { compileNativeTake } from './compileNativeTake';
import { compileBBTimeline } from './compileBBTimeline';
import { compileNativeProductionAudio } from './nativeProductionAudio';
import { resolveEmbeddedAssets } from './embeddedAssets';
import { isValidPlacementContract } from './validateContract';
import { blockPlacementDefinition } from '../nativeReference/games/block-placement/definition';
import { TILE_COLORS, getShape as blockPlacementShape } from '../nativeReference/domain/shapes';
import { hasReferenceCalibration } from './hasReferenceCalibration';
import { parseWorkbenchView } from './reference2dView';
import { resolveSavedWorkbenchVariant } from './workbenchVariant';
import { inlineBrowserStudioReferences, type BrowserAssetSources } from './browserAssetReferences';

const parse = (text: string): any => JSON.parse(text.startsWith('\ufeff') ? text.slice(1) : text);
function validate(text: string): void {
  const doc = parse(text);
  if (!isValidPlacementContract(doc))
    throw new Error('工程 Schema 未通过；为保留未知内容，拒绝编辑。');
  const links = doc.takes.length ? inspectNativeReplay(doc) : [];
  if (links.length) throw new Error(`回放关联未通过：${links[0]}`);
  const runtime = inspectNativeRuntime(doc);
  if (!runtime.validated) throw new Error(runtime.message);
  const bad = runtime.takes.find((take) => !take.legal);
  if (bad) throw new Error(`${bad.takeId}：${bad.detail} 原工程未修改。`);
  if (doc.direction?.style?.workbenchView2D !== undefined)
    for (const take of runtime.takes) {
      const compiled = compileNativeTake(doc, take.takeId).compiled;
      parseWorkbenchView(doc.direction.style.workbenchView2D, compiled.fps, compiled.totalFrames);
    }
  if (doc.direction?.style?.workbenchVariantV1 !== undefined)
    for (const take of runtime.takes) resolveSavedWorkbenchVariant(doc, take.takeId);
}
function update(text: string, path: JsonPath, value: unknown): string {
  const token = JSON.stringify(value);
  if (token === undefined) throw new Error('无效 JSON 值。');
  return replaceJsonToken(text, path, token);
}
function withUpdatedHash(text: string): string {
  const doc = parse(text);
  const parsed = blockPlacementDefinition.schemas.state.parse(doc.game.initialState.data);
  const hash = blockPlacementDefinition.runtime.hashState(parsed);
  let result = update(text, ['game', 'initialState', 'stateHash'], hash);
  for (let i = 0; i < doc.takes.length; i++)
    result = update(result, ['takes', i, 'initialStateHash'], hash);
  return result;
}
/** Edit only the existing board cell tokens and dependent hash references, then replay every take. */
export function editNativeBoardCell(
  text: string,
  row: number,
  col: number,
  color: string | null,
): string {
  assertGameplayEditSupported(parse(text));
  validate(text);
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0)
    throw new Error('棋盘坐标无效。');
  if (color !== null && !(TILE_COLORS as readonly string[]).includes(color))
    throw new Error('棋盘颜色无效。');
  const doc = parse(text),
    config = doc.game.config.data.board,
    initial = doc.game.initialState.data.board;
  if (!config || JSON.stringify(config) !== JSON.stringify(initial))
    throw new Error('配置棋盘与初始状态棋盘不一致；不能安全同步修改。');
  if (row >= initial.rows || col >= initial.cols) throw new Error('棋盘坐标越界。');
  let edited = update(text, ['game', 'config', 'data', 'board', 'cells', row, col], color);
  edited = update(edited, ['game', 'initialState', 'data', 'board', 'cells', row, col], color);
  edited = withUpdatedHash(edited);
  validate(edited);
  return edited;
}
/** Change a fixed-supply piece's shape and colors in every mirrored copy, preserving all other fields. */
export function editNativeSupplyPiece(
  text: string,
  round: number,
  slot: number,
  shapeId: string,
  color: string,
): string {
  assertGameplayEditSupported(parse(text));
  validate(text);
  if (!Number.isInteger(round) || round < 0 || !Number.isInteger(slot) || slot < 0 || slot > 2)
    throw new Error('供给轮次或候选槽无效。');
  if (!(TILE_COLORS as readonly string[]).includes(color)) throw new Error('候选颜色无效。');
  const doc = parse(text),
    config = doc.game.config.data,
    initial = doc.game.initialState.data;
  if (
    !Array.isArray(config.fixedPieceSupply) ||
    JSON.stringify(config.fixedPieceSupply) !== JSON.stringify(initial.fixedPieceSupply)
  )
    throw new Error('固定供给副本不一致或不存在，不能安全修改。');
  const piece = config.fixedPieceSupply[round]?.[slot];
  if (!piece) throw new Error(`供给第 ${round + 1} 轮第 ${slot + 1} 槽不存在。`);
  if (piece.cellColors !== undefined && !Array.isArray(piece.cellColors))
    throw new Error('此候选逐格颜色无效，不能安全改写。');
  const paths: JsonPath[] = [
    ['game', 'config', 'data', 'fixedPieceSupply', round, slot],
    ['game', 'initialState', 'data', 'fixedPieceSupply', round, slot],
  ];
  if (round === 0) {
    if (
      JSON.stringify(config.pieces?.[slot]) !== JSON.stringify(piece) ||
      JSON.stringify(initial.pieces?.[slot]) !== JSON.stringify(piece)
    )
      throw new Error('首轮候选与固定供给不一致，不能安全修改。');
    paths.push(
      ['game', 'config', 'data', 'pieces', slot],
      ['game', 'initialState', 'data', 'pieces', slot],
    );
  }
  // Validate shape and derive its required cell count through the received shape table.
  const getShape = blockPlacementShape(shapeId);
  let edited = text;
  for (const path of paths) {
    edited = update(edited, [...path, 'shapeId'], shapeId);
    edited = update(edited, [...path, 'color'], color);
    edited =
      piece.cellColors === undefined
        ? setJsonObjectProperty(
            edited,
            path,
            'cellColors',
            getShape.cells.map(() => color),
          )
        : update(
            edited,
            [...path, 'cellColors'],
            getShape.cells.map(() => color),
          );
  }
  edited = withUpdatedHash(edited);
  validate(edited);
  return edited;
}

function rebuildArray(text: string, path: JsonPath, indices: number[], append?: string): string {
  const parts = indices.map((i) => readJsonToken(text, [...path, i]));
  if (append !== undefined) {
    JSON.parse(append);
    parts.push(append);
  }
  return replaceJsonToken(text, path, `[${parts.join(',\n')}]`);
}
/** Reorder action envelopes without reserializing their contents; interactions remain bound by ID. */
export function reorderNativeAction(
  text: string,
  takeIndex: number,
  from: number,
  to: number,
): string {
  assertGameplayEditSupported(parse(text));
  validate(text);
  const doc = parse(text),
    actions = doc.takes[takeIndex]?.actions;
  if (!actions || ![from, to].every((i) => Number.isInteger(i) && i >= 0 && i < actions.length))
    throw new Error('动作索引无效。');
  const order = actions.map((_: unknown, i: number) => i);
  const [selected] = order.splice(from, 1);
  order.splice(to, 0, selected!);
  const edited = rebuildArray(text, ['takes', takeIndex, 'actions'], order);
  validate(edited);
  return edited;
}
/** Duration and path edit retain interaction IDs and preserve unrelated fields. */
export function editNativeInteraction(
  text: string,
  takeIndex: number,
  actionIndex: number,
  duration: number,
  samples: unknown,
): string {
  assertGameplayEditSupported(parse(text));
  validate(text);
  const doc = parse(text),
    take = doc.takes[takeIndex],
    action = take?.actions?.[actionIndex];
  if (
    !action ||
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > 18000 ||
    !Array.isArray(samples)
  )
    throw new Error('动作、帧长或路径无效。');
  const matches = take.interactions
    .map((x: any, i: number) => ({ x, i }))
    .filter((x: any) => x.x.committedActionId === action.id);
  if (matches.length !== 1) throw new Error('动作需要且只能有一个提交交互。');
  const path: JsonPath = ['takes', takeIndex, 'interactions', matches[0].i];
  let edited = update(text, [...path, 'endFrame'], matches[0].x.startFrame + duration);
  edited = update(edited, [...path, 'samples'], samples);
  validate(edited);
  return edited;
}
export function deleteNativeAction(text: string, takeIndex: number, actionIndex: number): string {
  assertGameplayEditSupported(parse(text));
  validate(text);
  const take = parse(text).takes[takeIndex],
    action = take?.actions?.[actionIndex];
  if (!action) throw new Error('动作索引无效。');
  const matches = take.interactions
    .map((x: any, i: number) => ({ x, i }))
    .filter((x: any) => x.x.committedActionId === action.id);
  if (matches.length !== 1) throw new Error('动作需要且只能有一个提交交互。');
  let edited = rebuildArray(
    text,
    ['takes', takeIndex, 'actions'],
    take.actions.map((_: unknown, i: number) => i).filter((i: number) => i !== actionIndex),
  );
  edited = rebuildArray(
    edited,
    ['takes', takeIndex, 'interactions'],
    take.interactions.map((_: unknown, i: number) => i).filter((i: number) => i !== matches[0].i),
  );
  validate(edited);
  return edited;
}
export function addNativeAction(
  text: string,
  takeIndex: number,
  actionJson: string,
  interactionJson: string,
): string {
  assertGameplayEditSupported(parse(text));
  validate(text);
  const take = parse(text).takes[takeIndex];
  if (!take) throw new Error('Take 索引无效。');
  const action = JSON.parse(actionJson),
    interaction = JSON.parse(interactionJson);
  if (!action?.id || interaction?.committedActionId !== action.id)
    throw new Error('新交互必须引用新动作 ID。');
  let edited = rebuildArray(
    text,
    ['takes', takeIndex, 'actions'],
    take.actions.map((_: unknown, i: number) => i),
    actionJson,
  );
  edited = rebuildArray(
    edited,
    ['takes', takeIndex, 'interactions'],
    take.interactions.map((_: unknown, i: number) => i),
    interactionJson,
  );
  validate(edited);
  return edited;
}

/** Edit only declared binding options and verify the resulting images and reference slot contract. */
export async function editNativeImageBinding(
  text: string,
  slot: string,
  fit: string,
  opacity: number,
  blendMode: string,
  inset: number,
  decoder?: (blob: Blob) => Promise<{ width: number; height: number }>,
  sources: BrowserAssetSources = {},
): Promise<string> {
  validate(text);
  if (!['background.base', 'tile.face', 'board.atlas'].includes(slot))
    throw new Error('不支持的图片槽位。');
  if (
    !['cover', 'contain', 'stretch'].includes(fit) ||
    !['source-over', 'multiply', 'screen', 'overlay', 'soft-light'].includes(blendMode) ||
    !Number.isFinite(opacity) ||
    opacity < 0 ||
    opacity > 1 ||
    !Number.isFinite(inset) ||
    inset < 0 ||
    inset > 0.45 ||
    (slot === 'background.base' && inset !== 0)
  )
    throw new Error('素材绑定参数超出参考合同范围。');
  const path: JsonPath = ['direction', 'style', 'agentAssets', 'bindings', slot];
  let edited = update(text, [...path, 'fit'], fit);
  edited = update(edited, [...path, 'opacity'], opacity);
  edited = update(edited, [...path, 'blendMode'], blendMode);
  edited = update(edited, [...path, 'inset'], inset);
  validate(edited);
  const resolved = await inlineBrowserStudioReferences(parse(edited), sources);
  await resolveEmbeddedAssets(resolved.document, decoder);
  if (hasReferenceCalibration(resolved.document)) {
    const doc = resolved.document as any;
    for (const take of doc.takes)
      if (take.actions.length)
        (await import('./calibratedRenderer')).prepareCalibratedRenderer(doc, take.takeId);
  }
  return edited;
}

/** Edit existing BGM controls only, then validate and actually compile the production mix. */
export async function editNativeBgm(
  text: string,
  takeId: string,
  start: number,
  offset: number,
  loop: boolean,
  gain: number,
  sources: BrowserAssetSources = {},
): Promise<string> {
  validate(text);
  if (
    ![start, offset, gain].every(Number.isFinite) ||
    start < 0 ||
    offset < 0 ||
    gain < 0 ||
    gain > 1
  )
    throw new Error('音乐起点、源偏移或增益无效。');
  const path: JsonPath = ['direction', 'production', 'audio', 'bgm'];
  let edited = update(text, [...path, 'startSeconds'], start);
  edited = update(edited, [...path, 'sourceOffsetSeconds'], offset);
  edited = update(edited, [...path, 'loop'], loop);
  edited = update(edited, [...path, 'gain'], gain);
  validate(edited);
  const parsed = (await inlineBrowserStudioReferences(parse(edited), sources)).document;
  await compileNativeProductionAudio(parsed, compileBBTimeline(parsed, takeId).source);
  return edited;
}

/** Change only output dimensions; reject unconsumed production transforms. */
export function editNativeOutputSize(text: string, width: number, height: number): string {
  validate(text);
  if (
    ![width, height].every(
      (value) => Number.isInteger(value) && value >= 64 && value <= 1920 && value % 2 === 0,
    )
  )
    throw new Error('输出宽高须为 64–1920 内的偶数。');
  const doc = parse(text),
    production = doc.direction?.production;
  if (production && Object.keys(production).some((key) => !['version', 'audio'].includes(key)))
    throw new Error('存在尚未接入的 production 时序或画面控制，不能安全修改输出尺寸。');
  let edited = update(text, ['production', 'output', 'width'], width);
  edited = update(edited, ['production', 'output', 'height'], height);
  validate(edited);
  return edited;
}

/** Convert known frame clocks to the new fps; seconds-based audio stays unchanged. */
function retimeNativeFpsImpl(text: string, fps: number, enforceApproximate: boolean): string {
  validate(text);
  const doc = parse(text),
    old = doc.production?.output?.fps,
    rhythm = doc.direction?.rhythm;
  if (
    !Number.isInteger(fps) ||
    fps < 15 ||
    fps > 60 ||
    !Number.isInteger(old) ||
    old < 1 ||
    !rhythm
  )
    throw new Error('输出帧率或节奏配置无效。');
  const production = doc.direction?.production;
  if (production && Object.keys(production).some((key) => !['version', 'audio'].includes(key)))
    throw new Error('工程包含未接入的 production 时序／镜头／特效；不能安全转换帧率。');
  if (hasReferenceCalibration(doc))
    throw new Error(
      'referenceCalibration 使用独立的秒时钟与事件规则；当前帧率转换尚未验证该渲染器，原工程保留。',
    );
  if (doc.direction?.style?.workbenchView2D !== undefined)
    throw new Error('工作台 2D 镜头包含帧时钟，当前帧率转换尚未接入；原工程保留。');
  const entries = doc.direction?.style?.agentAssets?.entries ?? {};
  if (Object.values(entries).some((entry: any) => entry?.kind === 'sequence'))
    throw new Error('素材序列的时钟尚未接入，不能安全转换帧率。');
  const keys = [
    'dragFrames',
    'pickupDelayFrames',
    'placementSettleFrames',
    'betweenActionFrames',
    'clearDelayFrames',
    'clearDurationFrames',
    'cameraRecoveryFrames',
  ];
  for (const key of keys)
    if (!Number.isInteger(rhythm[key]) || rhythm[key] < 0)
      throw new Error(`节奏字段 ${key} 无法安全转换。`);
  const convert = (value: number) => Math.round((value * fps) / old);
  let edited = update(text, ['production', 'output', 'fps'], fps);
  for (const key of keys)
    edited = update(edited, ['direction', 'rhythm', key], convert(rhythm[key]));
  for (const [ti, take] of doc.takes.entries())
    for (const [ii, interaction] of take.interactions.entries()) {
      const path: JsonPath = ['takes', ti, 'interactions', ii];
      const start = convert(interaction.startFrame),
        end = convert(interaction.endFrame);
      if (end - start < 1 && interaction.committedActionId)
        throw new Error(`${take.takeId} 交互 ${ii + 1} 转换后不足一帧。`);
      edited = update(edited, [...path, 'startFrame'], start);
      edited = update(edited, [...path, 'endFrame'], end);
      if (Array.isArray(interaction.samples))
        for (const [si, sample] of interaction.samples.entries()) {
          const frame = convert(sample.frameOffset);
          if (frame > end - start)
            throw new Error(`${take.takeId} 交互 ${ii + 1} 的路径在取整后越界。`);
          edited = update(edited, [...path, 'samples', si, 'frameOffset'], frame);
        }
    }
  validate(edited);
  const converted = parse(edited),
    tolerance = 2 * Math.max(1 / old, 1 / fps) + 1e-9;
  if (enforceApproximate)
    for (const take of doc.takes) {
      const before = compileNativeTake(doc, take.takeId).compiled,
        after = compileNativeTake(converted, take.takeId).compiled;
      for (let i = 0; i < before.actions.length; i++) {
        const a = before.actions[i]!,
          b = after.actions[i]!;
        for (const key of [
          'startFrame',
          'releaseFrame',
          'clearStartFrame',
          'clearEndFrame',
          'endFrame',
        ] as const) {
          if (Math.abs(a[key] / old - b[key] / fps) > tolerance)
            throw new Error(
              `${take.takeId} 第 ${i + 1} 步 ${key} 在转换后偏差超过较低帧率的两帧；未另存。`,
            );
        }
        if (Math.abs((a.releaseFrame + 1) / old - (b.releaseFrame + 1) / fps) > tolerance)
          throw new Error(
            `${take.takeId} 第 ${i + 1} 步落位事件在转换后偏差超过较低帧率的两帧；未另存。`,
          );
      }
    }
  return edited;
}

/** Legacy conversion retains the earlier per-field rounding behavior. */
export function retimeNativeFps(text: string, fps: number): string {
  return retimeNativeFpsImpl(text, fps, true);
}

/** Fit real event and pointer times without changing the legacy conversion path. */
export function retimeNativeFpsAbsolute(text: string, fps: number): string {
  const original = parse(text),
    old = original.production.output.fps;
  const count = original.takes.reduce((sum: number, take: any) => sum + take.actions.length, 0);
  if (count > 512) throw new Error('绝对边界转换目前最多支持 512 个动作；原工程保留。');
  const base = retimeNativeFpsImpl(text, fps, false),
    converted = parse(base);
  const originals = original.takes.map(
      (take: any) => compileNativeTake(original, take.takeId).compiled,
    ),
    ratio = fps / old;
  const keys = [
    'pickupDelayFrames',
    'betweenActionFrames',
    'clearDelayFrames',
    'placementSettleFrames',
  ] as const;
  const score = (doc: any, prefix = count) => {
    let max = 0,
      sum = 0,
      seen = 0;
    const add = (value: number) => {
      max = Math.max(max, value);
      sum += value;
    };
    for (const [ti, take] of doc.takes.entries()) {
      const source = originals[ti]!,
        target = compileNativeTake(doc, take.takeId).compiled;
      if (prefix === count) add(Math.abs(target.totalFrames - source.totalFrames * ratio));
      for (const [i, from] of source.actions.entries()) {
        if (seen++ >= prefix) continue;
        const to = target.actions[i]!;
        const before = [
          from.startFrame,
          from.releaseFrame,
          from.releaseFrame + 1,
          from.clearStartFrame,
          from.clearEndFrame,
          from.endFrame,
        ];
        const after = [
          to.startFrame,
          to.releaseFrame,
          to.releaseFrame + 1,
          to.clearStartFrame,
          to.clearEndFrame,
          to.endFrame,
        ];
        for (let j = 0; j < before.length; j++) add(Math.abs(after[j]! - before[j]! * ratio));
        if (from.action.pointerPath.length !== to.action.pointerPath.length)
          throw new Error('指针路径样本数量改变');
        for (const [j, point] of from.action.pointerPath.entries()) {
          const next = to.action.pointerPath[j]!;
          if (Math.abs(point.x - next.x) > 1e-9 || Math.abs(point.y - next.y) > 1e-9)
            throw new Error('指针路径坐标改变');
          add(
            Math.abs(
              to.startFrame + next.frameOffset - (from.startFrame + point.frameOffset) * ratio,
            ),
          );
        }
      }
    }
    return { max, sum };
  };
  const verifyEvents = (doc: any) => {
    const collect = (source: ReturnType<typeof compileNativeTake>['frameSource']) => {
      const events = new Map<string, number>();
      for (let frame = 0; frame < source.totalFrames; frame++)
        for (const event of source.evaluate(frame).semanticEvents) {
          const id = `${event.type}:${event.id}`;
          if (!events.has(id)) events.set(id, frame);
        }
      return events;
    };
    for (const take of original.takes) {
      const before = compileNativeTake(original, take.takeId).frameSource,
        after = compileNativeTake(doc, take.takeId).frameSource;
      const first = collect(before),
        second = collect(after);
      if (first.size !== second.size)
        throw new Error(`${take.takeId} 的语义事件集合改变，原工程保留。`);
      for (const [id, frame] of first) {
        const next = second.get(id);
        if (next === undefined || Math.abs(next - frame * ratio) > 1 + 1e-9)
          throw new Error(`${take.takeId} 事件 ${id} 超过一个目标帧，原工程保留。`);
      }
    }
  };
  type Candidate = { text: string; max: number; sum: number; change: number };
  // Long projects can use the exact rounded result when it already meets the
  // same strict bound; avoid hundreds of full recompilations on the UI thread.
  const initial = score(converted);
  if (initial.max <= 1 + 1e-9) {
    verifyEvents(converted);
    return base;
  }
  if (count > 128)
    throw new Error(
      `绝对边界转换超过 128 个动作时仅支持直接满足一帧精度的工程（当前 ${initial.max} 帧）；原工程保留。`,
    );
  const candidates: Candidate[] = [];
  for (let a = -2; a <= 2; a++)
    for (let b = -2; b <= 2; b++)
      for (let c = -1; c <= 1; c++)
        for (let d = -1; d <= 1; d++) {
          const deltas = [a, b, c, d];
          if (keys.some((key, i) => converted.direction.rhythm[key] + deltas[i]! < 0)) continue;
          let candidate = base;
          for (const [i, key] of keys.entries())
            candidate = update(
              candidate,
              ['direction', 'rhythm', key],
              converted.direction.rhythm[key] + deltas[i]!,
            );
          try {
            candidates.push({
              text: candidate,
              ...score(parse(candidate)),
              change: deltas.reduce((x, y) => x + Math.abs(y), 0),
            });
          } catch {
            /* invalid rhythm candidate */
          }
        }
  const order = (a: Candidate, b: Candidate) =>
    a.max - b.max || a.sum - b.sum || a.change - b.change;
  candidates.sort(order);
  let best = candidates[0];
  // When global integer clocks alone drift, allow each raw interaction endpoint
  // to move by at most one target frame. Limit the beam search separately from
  // the larger global-only limit to bound synchronous UI work.
  if (best && best.max > 1 + 1e-9 && count <= 12) {
    for (const candidate of candidates.slice(0, 12)) {
      const doc = parse(candidate.text);
      const actions: Array<{
        ti: number;
        ii: number;
        start: number;
        end: number;
        offsets: number[];
        original: any;
      }> = [];
      for (const [ti, take] of doc.takes.entries())
        for (const action of take.actions) {
          const ii = take.interactions.findIndex(
            (item: any) => item.committedActionId === action.id,
          );
          const interaction = take.interactions[ii],
            source = original.takes[ti].interactions.find(
              (item: any) => item.committedActionId === action.id,
            );
          if (ii < 0 || !source)
            throw new Error(`Take ${take.takeId} 动作 ${action.id} 缺少交互。`);
          actions.push({
            ti,
            ii,
            start: interaction.startFrame,
            end: interaction.endFrame,
            offsets: (interaction.samples ?? []).map((x: any) => x.frameOffset),
            original: source,
          });
        }
      const apply = (values: number[]) => {
        for (const [i, item] of actions.entries()) {
          const interaction = doc.takes[item.ti].interactions[item.ii],
            duration = item.end - item.start + (values[i] ?? 0);
          if (
            duration < 1 ||
            Math.abs(item.end + (values[i] ?? 0) - item.original.endFrame * ratio) > 1 + 1e-9
          )
            throw new Error('交互终点超出一帧');
          interaction.endFrame = item.start + duration;
          for (const [j, sample] of (interaction.samples ?? []).entries()) {
            sample.frameOffset = Math.min(item.offsets[j]!, duration);
            if (
              Math.abs(sample.frameOffset - item.original.samples[j].frameOffset * ratio) >
              1 + 1e-9
            )
              throw new Error('交互路径超出一帧');
          }
        }
      };
      let beam: Array<{ values: number[]; max: number; sum: number }> = [
        { values: [], max: 0, sum: 0 },
      ];
      for (let i = 0; i < actions.length && beam.length; i++) {
        const next: typeof beam = [];
        for (const entry of beam)
          for (const delta of [-1, 0, 1]) {
            const values = [...entry.values, delta];
            try {
              apply(values);
              next.push({ values, ...score(doc, i + 1) });
            } catch {
              /* invalid candidate */
            }
          }
        next.sort(
          (x, y) =>
            x.max - y.max ||
            x.sum - y.sum ||
            x.values.reduce((a, b) => a + Math.abs(b), 0) -
              y.values.reduce((a, b) => a + Math.abs(b), 0),
        );
        beam = next.slice(0, 32);
      }
      for (const fit of beam) {
        if (fit.max > 1 + 1e-9) continue;
        apply(fit.values);
        let result = candidate.text;
        for (const [i, item] of actions.entries()) {
          if (!fit.values[i]) continue;
          const path: JsonPath = ['takes', item.ti, 'interactions', item.ii];
          result = update(
            result,
            [...path, 'endFrame'],
            doc.takes[item.ti].interactions[item.ii].endFrame,
          );
          for (const [j, sample] of (
            doc.takes[item.ti].interactions[item.ii].samples ?? []
          ).entries())
            if (sample.frameOffset !== item.offsets[j])
              result = update(result, [...path, 'samples', j, 'frameOffset'], sample.frameOffset);
        }
        validate(result);
        const verified = score(parse(result));
        if (verified.max <= 1 + 1e-9) {
          verifyEvents(parse(result));
          return result;
        }
      }
    }
  }
  if (!best || best.max > 1 + 1e-9)
    throw new Error(
      `绝对边界转换无法将所有动作与事件控制在一个目标帧内（最佳 ${best?.max ?? '不可用'} 帧）；原工程保留。`,
    );
  validate(best.text);
  verifyEvents(parse(best.text));
  return best.text;
}

/** Change an existing semantic cue gain and verify that its asset can really be mixed. */
export async function editNativeCueGain(
  text: string,
  takeId: string,
  index: number,
  gain: number,
  sources: BrowserAssetSources = {},
): Promise<string> {
  validate(text);
  const doc = parse(text),
    cues = doc.direction?.production?.audio?.cues;
  if (
    !Array.isArray(cues) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= cues.length ||
    !Number.isFinite(gain) ||
    gain < 0 ||
    gain > 1
  )
    throw new Error('音效事件或增益无效。');
  const edited = setJsonObjectProperty(
    text,
    ['direction', 'production', 'audio', 'cues', index],
    'gain',
    gain,
  );
  validate(edited);
  const parsed = (await inlineBrowserStudioReferences(parse(edited), sources)).document;
  await compileNativeProductionAudio(parsed, compileBBTimeline(parsed, takeId).source);
  return edited;
}

/** Change an existing cue offset, then mix the selected Take on its actual event clock. */
export async function editNativeCueOffset(
  text: string,
  takeId: string,
  index: number,
  offsetSeconds: number,
  sources: BrowserAssetSources = {},
): Promise<string> {
  validate(text);
  const doc = parse(text),
    cues = doc.direction?.production?.audio?.cues;
  if (
    !Array.isArray(cues) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= cues.length ||
    !Number.isFinite(offsetSeconds) ||
    offsetSeconds < -2 ||
    offsetSeconds > 10
  )
    throw new Error('音效事件或偏移无效。');
  const edited = setJsonObjectProperty(
    text,
    ['direction', 'production', 'audio', 'cues', index],
    'offsetSeconds',
    offsetSeconds,
  );
  validate(edited);
  const parsed = (await inlineBrowserStudioReferences(parse(edited), sources)).document;
  await compileNativeProductionAudio(parsed, compileBBTimeline(parsed, takeId).source);
  return edited;
}
