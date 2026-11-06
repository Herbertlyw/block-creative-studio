import Ajv from 'ajv/dist/2020';
import schema from '../../contracts/bb/workbench-extensions/bb-work-v1.schema.json';
import {
  hasStudioAssetReferences,
  inlineBrowserStudioReferences,
  type BrowserAssetSources,
} from './browserAssetReferences';
import { inspectNativeRuntime } from './inspectNativeRuntime';
import {
  verifyObservedPointer,
  verifyPointerAgainstObservation,
  type PointerOverlay,
} from './observedPointer';
import { verifyObservedSourceLink } from './observedSourceLink';
import { isValidPlacementContract } from './validateContract';
import { decodeBase64Image, inspectImageBytes } from '../nativeReference/agent-assets/image';
import { compileBBTimeline } from './compileBBTimeline';
import { productionFromDocument } from '../nativeReference/agent-director/contracts';
import {
  BUILTIN_AUDIO_IDS,
  productionAudioCatalog,
  productionBgm,
  validateProductionAudioAsset,
  verifyProductionAudioAssets,
} from '../nativeReference/agent-director/audioMix';
import { readWorkbenchBackground } from './workbenchBackground';
import { readBBExportQuality } from './bbExportQuality';
import { readBBTestAudio } from './bbSyntheticAudio';

/** A portable container around the one BB project; source media is deliberately external. */
export type BBWorkPackage = {
  format: 'bcs-bb-work';
  version: '1.0.0';
  project: unknown;
  pointer: PointerOverlay | null;
  source: {
    link: unknown;
    observation: unknown;
    provenance?: { relation: 'derived'; parentProjectSha256: string };
  } | null;
};
const validate = new Ajv({ strict: false }).compile(schema);

/** Verify every declared relationship before exposing a package to consumers. */
export async function openBBWorkPackage(value: unknown): Promise<BBWorkPackage> {
  if (!validate(value)) throw new Error('作品包格式不支持或包含未知字段。');
  const work = value as BBWorkPackage;
  if (!isValidPlacementContract(work.project))
    throw new Error('作品中 BB 工程结构无效或格式不支持。');
  readWorkbenchBackground(work.project);
  readBBExportQuality(work.project);
  readBBTestAudio(work.project);
  const audit = inspectNativeRuntime(work.project);
  if (!audit.validated || audit.takes.some((t) => !t.legal))
    throw new Error(
      `作品玩法校验失败：${audit.message} ${audit.takes
        .filter((t) => !t.legal)
        .map((t) => t.detail)
        .join('；')}`,
    );
  // This initial format is portable only if all declared assets are embedded. Do not
  // silently save an external reference as a self-contained package.
  const resolved = await inlineBrowserStudioReferences(work.project, {});
  const doc = resolved.document as any;
  for (const [id, entry] of Object.entries(
    doc?.direction?.style?.agentAssets?.entries ?? {},
  ) as Array<[string, any]>) {
    if (entry?.kind !== 'image' || entry.encoding !== 'base64') continue;
    try {
      const metadata = inspectImageBytes(decodeBase64Image(entry.data));
      if (
        metadata.mimeType !== entry.mimeType ||
        metadata.width !== entry.width ||
        metadata.height !== entry.height
      )
        throw new Error('格式或尺寸与声明不一致');
    } catch (error) {
      throw new Error(
        `图片 ${id} 损坏或格式无效：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  // Opening/editing verifies bytes, references and timelines. Actual PCM mixing
  // belongs to preview/export, rather than every rename or image replacement.
  if (doc?.direction?.production?.audio) {
    const production = productionFromDocument(doc);
    if (!production?.audio) throw new Error('工程音频设置无效。');
    await verifyProductionAudioAssets(production.audio);
    for (const asset of Object.values(production.audio.assets ?? {}))
      validateProductionAudioAsset(asset);
    if (
      !productionAudioCatalog().some(
        (pack) => pack.id === (production.audio!.selectedPackId ?? 'arcade-clean-v1'),
      )
    )
      throw new Error('不支持的音频预设。');
    const referenced = [
      ...(production.audio.cues ?? []).map((cue) => cue.assetId),
      productionBgm(production.audio)?.assetId,
    ].filter((id): id is string => !!id);
    for (const id of referenced)
      if (!BUILTIN_AUDIO_IDS.has(id) && !production.audio.assets?.[id])
        throw new Error(`AUDIO_ASSET_UNKNOWN: ${id}`);
    for (const take of doc.takes) {
      if (!take.actions.length) continue;
      try {
        compileBBTimeline(doc, take.takeId);
      } catch (error) {
        throw new Error(
          `Take ${take.takeId} 音频核验失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  await verifyWorkLinks(work);
  return structuredClone(work);
}
async function verifyWorkLinks(work: BBWorkPackage) {
  if (work.pointer) await verifyObservedPointer(work.project, work.pointer);
  if (work.source) {
    const observation = work.source.observation as any,
      source = (work.source.link as any)?.source;
    if (!source || !observation?.measurement) throw new Error('作品缺少来源关联或测量。');
    await verifyObservedSourceLink(
      work.source.link,
      work.project,
      observation,
      observation.measurement,
      source.sha256,
      source.width,
      source.height,
    );
    if (work.pointer)
      await verifyPointerAgainstObservation(work.project, work.pointer, observation);
  }
}

/** Import a portable work, or resolve a raw project's selected directories once.
 * The returned copy is self-contained; the selected source file is never changed. */
export async function importBBWorkDocument(
  input: unknown,
  sources: BrowserAssetSources = {},
): Promise<BBWorkPackage> {
  const packaged = (input as { format?: unknown })?.format === 'bcs-bb-work';
  if (!packaged) {
    const { document } = await inlineBrowserStudioReferences(input, sources);
    return createBBWorkPackage(document, null, null);
  }
  if (!validate(input)) throw new Error('作品包格式不支持或包含未知字段。');
  const original = input as BBWorkPackage;
  if (!hasStudioAssetReferences(original.project)) return openBBWorkPackage(original);
  // Verify old links before changing storage representation, then bind the verified copy.
  await verifyWorkLinks(original);
  const { document } = await inlineBrowserStudioReferences(original.project, sources);
  const { projectContentHash, createObservedSourceLink } = await import('./observedSourceLink');
  const pointer = original.pointer
    ? { ...original.pointer, projectSha256: await projectContentHash(document) }
    : null;
  const source = original.source
    ? {
        ...original.source,
        link: await createObservedSourceLink(
          document,
          original.source.observation,
          (original.source.link as any).source.sha256,
          (original.source.link as any).source.width,
          (original.source.link as any).source.height,
        ),
      }
    : null;
  return createBBWorkPackage(document, pointer, source);
}

export async function createBBWorkPackage(
  project: unknown,
  pointer: PointerOverlay | null,
  source: BBWorkPackage['source'],
): Promise<BBWorkPackage> {
  return openBBWorkPackage({ format: 'bcs-bb-work', version: '1.0.0', project, pointer, source });
}

/** Preserve authored content; reject edits that invalidate the observed tracks. */
export async function updateBBWorkPackageProject(
  work: BBWorkPackage,
  project: unknown,
): Promise<BBWorkPackage> {
  const original = await openBBWorkPackage(work);
  const { projectContentHash, createObservedSourceLink } = await import('./observedSourceLink');
  const pointer = original.pointer
    ? { ...original.pointer, projectSha256: await projectContentHash(project) }
    : null;
  let source: BBWorkPackage['source'] = null;
  if (original.source) {
    const info = (original.source.link as any).source;
    source = {
      observation: original.source.observation,
      link: await createObservedSourceLink(
        project,
        original.source.observation,
        info.sha256,
        info.width,
        info.height,
      ),
      provenance: {
        relation: 'derived',
        parentProjectSha256: await projectContentHash(original.project),
      },
    };
  }
  try {
    return await createBBWorkPackage(project, pointer, source);
  } catch (error) {
    throw new Error(
      `修改不能保留已确认的来源或轨迹：${error instanceof Error ? error.message : String(error)}；请回到观察界面重新标注，原作品未改变。`,
    );
  }
}
