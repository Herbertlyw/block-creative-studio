import Ajv from 'ajv/dist/2020';
import schema from '../../contracts/bb/workbench-extensions/calibration-tracks-v2.schema.json';
import { stableHash } from '../nativeReference/headless/stableHash';
import { isValidPlacementContract } from './validateContract';
import { inspectNativeRuntime } from './inspectNativeRuntime';
import { readJsonToken, replaceJsonToken } from './editNativeAction';
import type { BrowserAssetSources } from './browserAssetReferences';

export const MULTI_CALIBRATION_DRIVER = {
  id: 'bcs.workbench.block-placement.calibrated-multi',
  version: '2.0.0',
  referenceSourceSha256: '39e3e1346055eab21877bb8b8f5270a83ad55dcd8f42322e60091f4012f061f6',
} as const;
type Json = Record<string, any>;
type Track = {
  takeId: string;
  initialStateHash: string;
  takeHash: string;
  fps: number;
  calibration: Json;
};
const check = new Ajv({ allErrors: true, strict: false }).compile(schema);
const object = (value: unknown): value is Json =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Select and validate a track without rewriting or reordering the source project. */
export function selectWorkbenchCalibration(document: unknown, takeId: string): Json {
  const doc = document as Json,
    style = doc?.direction?.style,
    multi = style?.workbenchCalibrationV2;
  if (!check(multi))
    throw new Error(
      `多 Take 校准合同无效：${check.errors?.map((e) => `${e.instancePath || '/'} ${e.message}`).join('；')}`,
    );
  const ids = new Set<string>();
  for (const track of multi.tracks as Track[]) {
    if (ids.has(track.takeId)) throw new Error(`校准轨道重复：${track.takeId}`);
    ids.add(track.takeId);
  }
  const take = doc.takes?.find((t: Json) => t.takeId === takeId),
    track = (multi.tracks as Track[]).find((t) => t.takeId === takeId);
  if (!take) throw new Error(`找不到 Take ${takeId}。`);
  if (!track) throw new Error(`Take ${takeId} 缺少独立校准轨道；请提供该 Take 的动作与时间。`);
  if (
    track.initialStateHash !== doc.game?.initialState?.stateHash ||
    track.initialStateHash !== take.initialStateHash
  )
    throw new Error(`Take ${takeId} 的初始状态哈希与轨道不一致。`);
  if (track.takeHash !== stableHash({ initial: doc.game.initialState, take }))
    throw new Error(`Take ${takeId} 动作或状态已改变，校准轨道过期。`);
  if (track.fps !== doc.production?.output?.fps)
    throw new Error(`Take ${takeId} 的轨道帧率与输出不一致。`);
  if (track.calibration.legacySpriteAssetIds !== undefined) {
    if (!object(track.calibration.legacySpriteAssetIds))
      throw new Error(`Take ${takeId} 的旧素材别名无效。`);
    for (const [name, id] of Object.entries(track.calibration.legacySpriteAssetIds))
      if (typeof id !== 'string' || track.calibration.sprites?.[name] !== `asset:${id}`)
        throw new Error(`Take ${takeId} 的旧素材别名 ${name} 缺少相同的素材引用。`);
  }
  for (const [name, uri] of Object.entries(track.calibration.sprites ?? {}))
    if (typeof uri !== 'string' || !uri.startsWith('asset:'))
      throw new Error(`Take ${takeId} 的 ${name} 必须引用已核验素材 ID。`);
  return structuredClone(track.calibration);
}

/** Explicit authoring operation: each input track is supplied, never inferred from another take. */
export async function saveWorkbenchCalibrationTracks(
  text: string,
  calibrations: unknown,
  sources: BrowserAssetSources = {},
): Promise<string> {
  const doc = JSON.parse(text.startsWith('\ufeff') ? text.slice(1) : text),
    style = doc.direction?.style;
  if (!isValidPlacementContract(doc) || !object(style) || !object(calibrations))
    throw new Error('工程或轨道 JSON 无效，原工程保留。');
  if (style.workbenchCalibrationV2 !== undefined && !check(style.workbenchCalibrationV2))
    throw new Error('已有多 Take 校准合同包含未知或无效字段；为保留原文拒绝编辑。');
  // Never silently rebind an existing track after its source Take or clock changed.
  // Missing tracks may still be authored explicitly below.
  if (style.workbenchCalibrationV2 !== undefined)
    for (const track of style.workbenchCalibrationV2.tracks as Track[])
      selectWorkbenchCalibration(doc, track.takeId);
  const audit = inspectNativeRuntime(doc);
  if (!audit.validated) throw new Error(audit.message);
  const invalid = audit.takes.find((t) => !t.legal);
  if (invalid) throw new Error(`${invalid.takeId}：${invalid.detail}`);
  const ids = new Set(doc.takes.map((t: Json) => t.takeId));
  for (const id of Object.keys(calibrations))
    if (!ids.has(id)) throw new Error(`轨道引用了不存在的 Take ${id}。`);
  const tracks: Track[] = doc.takes.map((take: Json) => {
    const calibration = calibrations[take.takeId];
    if (!object(calibration)) throw new Error(`Take ${take.takeId} 缺少用户提供的独立校准轨道。`);
    return {
      takeId: take.takeId,
      initialStateHash: doc.game.initialState.stateHash,
      takeHash: stableHash({ initial: doc.game.initialState, take }),
      fps: doc.production.output.fps,
      calibration,
    };
  });
  const multi = {
    contract: 'bcs.workbench.calibration-tracks',
    version: '2.0.0',
    driver: MULTI_CALIBRATION_DRIVER,
    tracks,
  };
  let edited: string;
  if (style.workbenchCalibrationV2 !== undefined)
    edited = replaceJsonToken(
      text,
      ['direction', 'style', 'workbenchCalibrationV2'],
      JSON.stringify(multi),
    );
  else {
    const raw = readJsonToken(text, ['direction', 'style']);
    const last = raw.lastIndexOf('}');
    if (last < 0) throw new Error('无法定位原始样式；原工程保留。');
    const body = raw.slice(0, last),
      join = Object.keys(style).length ? ',' : '';
    edited = replaceJsonToken(
      text,
      ['direction', 'style'],
      `${body}${join}\n"workbenchCalibrationV2":${JSON.stringify(multi)}${raw.slice(last)}`,
    );
  }
  const output = JSON.parse(edited),
    { prepareCalibratedRenderer } = await import('./calibratedRenderer');
  const { inlineBrowserStudioReferences } = await import('./browserAssetReferences');
  // Resolve against explicitly selected roots only; never write the hydrated copy.
  const resolved = await inlineBrowserStudioReferences(output, sources);
  for (const take of doc.takes) prepareCalibratedRenderer(resolved.document, take.takeId);
  return edited;
}
