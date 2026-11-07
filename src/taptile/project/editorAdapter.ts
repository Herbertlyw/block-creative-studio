import { TAPTILE_EXPORT_SCALE, exportToAuthoringPoint } from '../pixelGeometry';
import {
  STACK_STAGE,
  type StackTile,
  type TapTileStackProject,
} from '../stackModel';
import type { TapTileInstanceSpec, TapTileProjectV2 } from './types';

function archetypeMatchKey(project: TapTileProjectV2, archetypeId: string): string {
  return project.visuals.archetypes[archetypeId]?.matchKey ?? archetypeId.replace(/^archetype-/u, '');
}

export function instanceToStackTile(project: TapTileProjectV2, instance: TapTileInstanceSpec): StackTile {
  const point = exportToAuthoringPoint({ x: instance.geometry.centerXPx, y: instance.geometry.centerYPx });
  return {
    id: instance.id,
    x: point.x,
    y: point.y,
    layer: instance.geometry.layer,
    rotation: instance.geometry.rotationDeg,
    scale: instance.geometry.widthPx / (STACK_STAGE.tileSize * TAPTILE_EXPORT_SCALE),
    faceId: archetypeMatchKey(project, instance.archetypeId),
    locked: instance.authoring.editorLocked,
  };
}

export function projectStackTiles(project: TapTileProjectV2): StackTile[] {
  return project.level.tileInstances.map((instance) => instanceToStackTile(project, instance));
}

function archetypeIdForMatchKey(project: TapTileProjectV2, matchKey: string): string {
  return Object.values(project.visuals.archetypes).find((archetype) => archetype.matchKey === matchKey)?.id
    ?? `archetype-${matchKey}`;
}

export function replaceProjectStackTiles(project: TapTileProjectV2, tiles: readonly StackTile[]): void {
  const previous = new Map(project.level.tileInstances.map((instance) => [instance.id, instance]));
  project.level.tileInstances = tiles.map((tile, order) => {
    const existing = previous.get(tile.id);
    return {
      id: tile.id,
      archetypeId: archetypeIdForMatchKey(project, tile.faceId),
      geometry: {
        centerXPx: Math.round(tile.x * TAPTILE_EXPORT_SCALE),
        centerYPx: Math.round(tile.y * TAPTILE_EXPORT_SCALE),
        widthPx: Math.round(STACK_STAGE.tileSize * tile.scale * TAPTILE_EXPORT_SCALE),
        heightPx: Math.round(STACK_STAGE.tileSize * tile.scale * TAPTILE_EXPORT_SCALE),
        rotationDeg: tile.rotation,
        layer: tile.layer,
        order: existing?.geometry.order ?? order,
      },
      authoring: { editorLocked: tile.locked },
    };
  });
}

export function projectAsLegacyView(project: TapTileProjectV2): TapTileStackProject {
  return {
    format: 'taptile-stack-studio',
    version: '0.1.0',
    name: project.name,
    templateId: project.authoring.templateId,
    material: project.authoring.material,
    theme: project.authoring.sceneTheme,
    snap: project.authoring.snap,
    snapGapPx: project.authoring.snapGapPx,
    showLayerBadges: project.authoring.showLayerBadges,
    tiles: projectStackTiles(project),
    updatedAt: project.updatedAt,
  };
}
