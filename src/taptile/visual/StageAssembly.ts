import type { TapTileProjectV2 } from '../project';
import { TapTileAssetRegistry } from './AssetRegistry';
import type { ResolvedStageAssembly } from './types';

export function resolveStageAssembly(
  project: TapTileProjectV2,
  assemblyId = project.visuals.selectedStageAssemblyId,
): ResolvedStageAssembly {
  const layers = project.visuals.stageAssemblies[assemblyId];
  if (!layers) throw new Error(`STAGE_ASSEMBLY_NOT_FOUND: ${assemblyId}`);
  const registry = new TapTileAssetRegistry(project.assets);
  return {
    id: assemblyId,
    layers: layers.map((layer) => ({
      ...layer,
      ...(layer.assetId ? { asset: registry.resolve(layer.assetId) } : {}),
    })),
  };
}
