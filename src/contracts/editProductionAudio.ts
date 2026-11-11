import {
  compileProductionAudio,
  verifyProductionAudioAssets,
  validateProductionAudioAsset,
} from '../nativeReference/agent-director/audioMix';
import type { ProductionAudio } from '../nativeReference/agent-director/contracts';
import type { BBWorkPackage } from './bbWorkPackage';
import type { BCProject } from '../games/block-crush/document';

async function verifyAudio(audio: ProductionAudio) {
  await verifyProductionAudioAssets(audio);
  for (const asset of Object.values(audio.assets ?? {})) validateProductionAudioAsset(asset);
}

/** Validate the entire candidate before publishing it; failed edits retain the caller's draft. */
export async function editBBProductionAudio(work: BBWorkPackage, audio: ProductionAudio) {
  const { updateBBWorkPackageProject } = await import('./bbWorkPackage');
  const { compileBBTimeline } = await import('./compileBBTimeline');
  await verifyAudio(audio);
  const doc = structuredClone(work.project) as any;
  doc.direction.production ??= { version: '1.0.0' };
  doc.direction.production.audio = structuredClone(audio);
  const result = await updateBBWorkPackageProject(work, doc);
  for (const take of doc.takes) {
    if (!take.actions.length) continue;
    try {
      compileProductionAudio(
        compileBBTimeline(doc, take.takeId, { allowClipMetadata: true }).source,
        audio,
      );
    } catch (reason) {
      throw new Error(
        `Take「${take.takeId}」混音失败：${reason instanceof Error ? reason.message : String(reason)}`,
      );
    }
  }
  return result;
}

export async function editBCProductionAudio(project: BCProject, audio: ProductionAudio) {
  const { bcProduction, editBCProject, setBCProduction } = await import(
    '../games/block-crush/document'
  );
  const { compileBCPlayback } = await import('../games/block-crush/timeline');
  await verifyAudio(audio);
  const result = editBCProject(project, (draft) => {
    const production = bcProduction(draft);
    production.audio = structuredClone(audio);
    setBCProduction(draft, production);
  });
  for (const take of result.takes) {
    if (!take.actions.length) continue;
    try {
      compileProductionAudio(compileBCPlayback(result, take.takeId, true).source, audio);
    } catch (reason) {
      throw new Error(
        `Take「${take.takeId}」混音失败：${reason instanceof Error ? reason.message : String(reason)}`,
      );
    }
  }
  return result;
}
