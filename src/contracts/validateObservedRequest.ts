import rackSchema from '../../contracts/bb/workbench-extensions/calibration-rack-v1.schema.json';
import { parseCalibrationRackCenters } from './calibrationRack';
import { isValidPlacementContract } from './validateContract';
import { inspectNativeRuntime } from './inspectNativeRuntime';
import placementSchema from '../../contracts/bb/schemas/block-placement-project.schema.json';
import { selectWorkbenchCalibration } from './workbenchCalibration';
import type { VerifiedPointerOverlay } from './observedPointer';
import { readBBExportQuality } from './bbExportQuality';
import { readBBTestAudio } from './bbSyntheticAudio';
import { parseProductionDirection } from '../nativeReference/agent-director/contracts';

/** Calibration allows extension keys in the source schema. Refuse unknown keys
 * instead of claiming that the current renderer consumed future extensions. */
function assertKnownCalibrationFields(
  value: unknown,
  schema: Record<string, any>,
  path: string,
): void {
  if (schema.$ref) {
    const key = String(schema.$ref).split('/').pop()!;
    const def = (placementSchema.$defs as Record<string, any>)[key];
    if (!def) throw new Error(`校准合同引用未识别：${schema.$ref}`);
    return assertKnownCalibrationFields(value, def, path);
  }
  const alternatives = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(alternatives)) {
    for (const option of alternatives) {
      try {
        assertKnownCalibrationFields(value, option, path);
        return;
      } catch {
        /* try another declared shape */
      }
    }
    throw new Error(`校准字段 ${path} 不符合已识别的结构。`);
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const child = schema.prefixItems?.[index] ?? schema.items;
      if (child && typeof child === 'object')
        assertKnownCalibrationFields(item, child, `${path}[${index}]`);
    }
  } else if (value && typeof value === 'object') {
    const properties = schema.properties as Record<string, Record<string, any>> | undefined;
    for (const [key, item] of Object.entries(value)) {
      const child =
        properties?.[key] ??
        (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined);
      if (!child) throw new Error(`校准字段 ${path}.${key} 未被当前渲染器识别；原工程保留。`);
      assertKnownCalibrationFields(item, child, `${path}.${key}`);
    }
  }
}

/** Shared fail-closed validation for observation planning and rendering. */
export function validateCalibratedRequest(
  document: unknown,
  takeId: string,
  pointer?: VerifiedPointerOverlay | null,
  options?: { allowClipMetadata?: boolean },
) {
  const original = document as {
    direction?: { style?: { workbenchCalibrationV2?: unknown } };
  } | null;
  let selectedCalibration: unknown;
  if (original?.direction?.style?.workbenchCalibrationV2 !== undefined) {
    if (!isValidPlacementContract(document))
      throw new Error('V2 工程 Schema 未通过，不能使用多 Take 校准渲染。');
    const audit = inspectNativeRuntime(document),
      take = audit.takes.find((item) => item.takeId === takeId);
    if (!audit.validated || !take?.legal) throw new Error(take?.detail ?? audit.message);
    selectedCalibration = selectWorkbenchCalibration(document, takeId);
  }
  const doc = document as {
    direction?: {
      style?: {
        referenceCalibration?: unknown;
        materialBridge4?: unknown;
        transitionMaterial?: unknown;
        materialVariant?: unknown;
      };
      production?: Record<string, unknown>;
    };
  } | null;
  const bindingKeys = Object.keys((doc?.direction?.style as any)?.agentAssets?.bindings ?? {});
  const unsupportedBindings = bindingKeys.filter(
    (key) => !['background.base', 'tile.face', 'board.atlas'].includes(key),
  );
  if (unsupportedBindings.length)
    throw new Error(
      `观察画面尚未消费素材槽：${unsupportedBindings.join('、')}；不能忽略这些绑定。`,
    );
  const allowedProduction = options?.allowClipMetadata
    ? ['version', 'audio', 'clips', 'selectedClipId']
    : ['version', 'audio'];
  const productionUnknown = Object.keys(doc?.direction?.production ?? {}).filter(
    (key) => !allowedProduction.includes(key),
  );
  if (productionUnknown.length)
    throw new Error(`校准渲染尚未接入 production 字段：${productionUnknown.join('、')}。`);
  if (options?.allowClipMetadata && doc?.direction?.production)
    parseProductionDirection(doc.direction.production);
  if (!isValidPlacementContract(document))
    throw new Error('V2 工程 Schema 未通过，不能使用校准渲染器。');
  const audit = inspectNativeRuntime(document);
  if (!audit.validated) throw new Error(audit.message);
  const take = audit.takes.find((item) => item.takeId === takeId);
  if (!take?.legal) throw new Error(take?.detail ?? `找不到 Take ${takeId}。`);
  if (!doc?.direction?.style) throw new Error('工程没有校准样式。');
  const c = (selectedCalibration ?? doc.direction.style.referenceCalibration) as any;
  if (!c) throw new Error('工程没有 referenceCalibration。');
  const entries = (doc.direction.style as any).agentAssets?.entries;
  const group =
    entries?.['observed-white'] &&
    entries?.['observed-coral'] &&
    entries?.['observed-cyan'] &&
    [c.sprites?.tileWhite, c.sprites?.tileCoral, c.sprites?.tileCyan].some(
      (v: unknown) => typeof v === 'string' && v.startsWith('asset:observed-'),
    );
  if (
    group &&
    (c.theme !== 'grey' ||
      c.sprites?.tileWhite !== 'asset:observed-white' ||
      c.sprites?.tileCoral !== 'asset:observed-coral' ||
      c.sprites?.tileCyan !== 'asset:observed-cyan')
  )
    throw new Error('分槽图片仅支持已核验的灰色主题及 white、coral、cyan 全部槽位。');
  if (
    pointer &&
    (pointer.takeId !== takeId ||
      pointer.fps !== (document as any).production?.output?.fps ||
      pointer.tracks.length !== c.actions?.length ||
      pointer.tracks.some((track, index) => track.actionId !== c.actions[index]?.actionId))
  )
    throw new Error('指针 Take、帧率或动作轨道不匹配，不能使用过期指针。');
  const directionUnknown = Object.keys(doc.direction).filter(
    (key) => !['rhythm', 'style', 'production'].includes(key),
  );
  if (directionUnknown.length)
    throw new Error(`校准渲染尚未识别 direction 字段：${directionUnknown.join('、')}。`);
  parseCalibrationRackCenters(c.rackCenters);
  const nativeCalibration = (placementSchema.$defs as Record<string, any>).ReferenceCalibration;
  assertKnownCalibrationFields(
    c,
    {
      ...nativeCalibration,
      properties: { ...nativeCalibration.properties, ...rackSchema.properties },
    },
    'referenceCalibration',
  );
  const style = doc.direction.style;
  const knownStyle = (placementSchema.$defs as Record<string, any>).BlockPlacementStyle.properties;
  const unknownStyle = Object.keys(style).filter(
    (key) =>
      !(key in knownStyle) &&
      !['workbenchCalibrationV2', 'workbenchExportQualityV1', 'workbenchSyntheticAudioV1'].includes(
        key,
      ),
  );
  if (unknownStyle.length)
    throw new Error(`校准渲染尚未识别样式扩展：${unknownStyle.join('、')}。`);
  readBBExportQuality(document);
  readBBTestAudio(document);
  if (
    style.materialBridge4 !== undefined ||
    style.transitionMaterial !== undefined ||
    style.materialVariant !== undefined
  )
    throw new Error('校准渲染器尚未接入此工程的材质扩展，不能忽略这些字段。');
  return {
    takeId,
    pointer: pointer ?? null,
    ...(selectedCalibration ? { calibration: selectedCalibration } : {}),
  };
}
