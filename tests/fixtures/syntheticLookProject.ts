import type { StudioProjectDocumentV2 } from '../../src/nativeReference/game-runtime/projectEnvelope';
import { ordinaryProject } from './ordinaryProject';
import { studioBundleFromBlockPlacementV2 } from '../../src/nativeReference/games/block-placement/migrations/blockPlacementV1';
import {
  compileTakeForMaster,
  createStudioVariantMatrix,
} from '../../src/nativeReference/games/block-placement/studio/studioVariantBridge';
import { listNativePreviewLooks } from '../../src/contracts/nativeVariants';

/** Add the registered layout/camera manifests to the ordinary generated project. */
export function syntheticLookProject(twoTakes = false, source = ordinaryProject()) {
  const doc = structuredClone(source);
  if (twoTakes) {
    const second = structuredClone(doc.takes[0]!);
    second.takeId = 'synthetic-alternate';
    doc.takes.push(second);
  }
  listNativePreviewLooks(doc, 'synthetic-take');
  const bundle = studioBundleFromBlockPlacementV2(doc as unknown as StudioProjectDocumentV2),
    take = bundle.takes[0]!;
  const matrix = createStudioVariantMatrix({
    project: bundle.project,
    selectedTake: take,
    compiledTake: compileTakeForMaster(take, bundle.project),
    requestedLockMode: 'frame-exact',
    selectedLookKey: 'project-current',
    importedAssets: [],
    importedRecipes: [],
  });
  return {
    ...doc,
    production: {
      ...doc.production,
      layoutProfileRef: matrix.catalog.layoutProfileRef,
      cameraProfileRef: matrix.catalog.cameraProfileRef,
    },
  };
}
