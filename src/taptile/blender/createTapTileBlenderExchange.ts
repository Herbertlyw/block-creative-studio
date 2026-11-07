import type {
  BlenderExchangeEntity,
  BlenderExchangeFaceLayer,
  BlenderExchangeImageAsset,
  BlenderExchangeMatchVfx,
  BlenderExchangeTransformKeyframe,
  BlenderExchangeTransformTrack,
  BlenderSceneExchange,
  BlenderVector3,
} from '../../headless/blenderContracts';
import { evaluateTapTileFrame, type CompiledTapTileTake, type TapTilePresentationFrame } from '../director';
import { stableHash, type CompiledTapTile, type CompiledTapTileLevel, type TapTileProjectV2 } from '../project';
import { normalizeTapTileTrayBounds, tapTileTraySlotCenter, tapTileTraySlotRect } from '../trayLayout';
import { resolveTileVisual } from '../visual';

export interface CreateTapTileBlenderExchangeOptions {
  packageId?: string;
  pixelsPerMeter?: number;
  alphaMode?: 'straight' | 'opaque';
  includeTransformTracks?: boolean;
}

interface TileWorldTransform {
  position: BlenderVector3;
  rotationEulerDegrees: BlenderVector3;
  scale: BlenderVector3;
  visible: boolean;
}

const FACE_COLORS = [
  '#75D94C',
  '#57B7FF',
  '#FF7C72',
  '#FFD45A',
  '#B68CFF',
  '#FF9ED0',
  '#66D9C2',
  '#FF9B52',
];

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-z0-9._-]+/giu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .toLowerCase() || 'taptile-blender-scene';
}

function paletteColor(matchKey: string): string {
  const digest = Number.parseInt(stableHash(matchKey).slice(-8), 16);
  return FACE_COLORS[digest % FACE_COLORS.length] ?? FACE_COLORS[0]!;
}

function tileMaterial(project: TapTileProjectV2): BlenderExchangeEntity['material'] {
  switch (project.authoring.material) {
    case 'ice':
      return { baseColor: '#EAF8FF', roughness: 0.14, metallic: 0.02 };
    case 'jelly':
      return { baseColor: '#FFF0F7', roughness: 0.18, metallic: 0 };
    case 'paper':
      return { baseColor: '#FFF8E8', roughness: 0.62, metallic: 0 };
    case 'porcelain':
    default:
      return { baseColor: '#F7F2E7', roughness: 0.22, metallic: 0.02 };
  }
}

function sceneColors(project: TapTileProjectV2): { background: string; board: string } {
  switch (project.authoring.sceneTheme) {
    case 'sunset': return { background: '#35182F', board: '#8B415E' };
    case 'candy': return { background: '#392756', board: '#805EAF' };
    case 'forest': return { background: '#102E2D', board: '#2C6657' };
    case 'deep-ocean':
    default: return { background: '#102A55', board: '#245E9C' };
  }
}

function pixelToWorld(
  xPx: number,
  yPx: number,
  depth: number,
  project: TapTileProjectV2,
  pixelsPerMeter: number,
): BlenderVector3 {
  return [
    round((xPx - project.stage.exportWidth / 2) / pixelsPerMeter),
    round(depth),
    round((project.stage.exportHeight / 2 - yPx) / pixelsPerMeter),
  ];
}

function worldDimensions(widthPx: number, depth: number, heightPx: number, pixelsPerMeter: number): BlenderVector3 {
  return [round(widthPx / pixelsPerMeter), round(depth), round(heightPx / pixelsPerMeter)];
}

function tileLabel(project: TapTileProjectV2, tile: CompiledTapTile): string {
  const archetype = project.visuals.archetypes[tile.archetypeId];
  const source = archetype?.matchKey || archetype?.displayName || tile.archetypeId;
  return source.replace(/[^a-z0-9]+/giu, ' ').trim().slice(0, 8).toUpperCase() || 'TILE';
}

function packagedAssetPath(assetId: string): string {
  return `assets/${slug(assetId)}.bin`;
}

function blenderAsset(project: TapTileProjectV2, assetId: string): BlenderExchangeImageAsset {
  const entry = project.assets.entries[assetId];
  if (!entry || entry.kind !== 'image') throw new Error(`BLENDER_EXCHANGE_IMAGE_ASSET_INVALID: ${assetId}`);
  return {
    id: entry.id,
    kind: 'image',
    source: entry.source.type === 'builtin'
      ? { type: 'builtin-uri', uri: entry.source.uri }
      : { type: 'package-path', path: packagedAssetPath(entry.id) },
    ...(entry.width !== undefined ? { width: entry.width } : {}),
    ...(entry.height !== undefined ? { height: entry.height } : {}),
    ...(entry.hasAlpha !== undefined ? { hasAlpha: entry.hasAlpha } : {}),
    ...(entry.contentHash !== undefined ? { contentHash: entry.contentHash } : {}),
  };
}

function tileFace(
  project: TapTileProjectV2,
  tile: CompiledTapTile,
  assetIds: Set<string>,
): NonNullable<BlenderExchangeEntity['face']> {
  const visual = resolveTileVisual(project, tile.archetypeId, project.visuals.selectedThemeId, 'board');
  const layers: BlenderExchangeFaceLayer[] = visual.renderedFace.parts.map((part) => {
    if (part.source.kind === 'image') assetIds.add(part.source.assetId);
    return {
      id: part.id,
      source: part.source.kind === 'image'
        ? { kind: 'image' as const, assetId: part.source.assetId }
        : { kind: 'glyph' as const, value: part.source.value },
      transform: { ...part.transform },
    };
  });
  return {
    label: tileLabel(project, tile),
    color: paletteColor(tile.matchKey),
    layers,
  };
}

function depthForBoardLayer(layer: number): number {
  return round(0.05 - Math.max(0, layer) * 0.12);
}

function matchVfxForAction(
  compiled: CompiledTapTileTake,
  durationFrames: number,
  matchColor: string,
): BlenderExchangeMatchVfx {
  const preset = compiled.profile.matchPresentation.shatter?.presetId ?? 'burst';
  const style: BlenderExchangeMatchVfx['style'] = preset === 'shatter' || preset === 'pulse' ? preset : 'burst';
  const shared: Pick<BlenderExchangeMatchVfx, 'style' | 'durationFrames' | 'shockwave' | 'palette'> = {
    style,
    durationFrames: Math.max(1, Math.min(120, Math.round(durationFrames))),
    shockwave: true,
    palette: [matchColor, '#F7F2E7', '#A7DDE4', '#DFFF9F'],
  };
  if (style === 'pulse') {
    return { ...shared, fragmentCount: 0, fragmentScale: 0.7, radialSpread: 1.1, gravity: 0, glowStrength: 7.5 };
  }
  if (style === 'shatter') {
    // Reference footage breaks the three tray tiles into a dense white shard
    // cloud that travels downward; it does not use a large circular shockwave.
    return {
      ...shared,
      shockwave: false,
      palette: ['#F7F2E7', '#FFFFFF', '#DCEBFA', matchColor],
      fragmentCount: 96,
      fragmentScale: 1,
      radialSpread: 2.4,
      gravity: 5.2,
      glowStrength: 2.8,
    };
  }
  return { ...shared, fragmentCount: 15, fragmentScale: 0.72, radialSpread: 2.05, gravity: 0.48, glowStrength: 6 };
}

function scaleVector(x: number, z = x): BlenderVector3 {
  const y = (x + z) / 2;
  return [round(x), round(y), round(z)];
}

function transformForFrame(
  project: TapTileProjectV2,
  tile: CompiledTapTile,
  frame: TapTilePresentationFrame,
  pixelsPerMeter: number,
): TileWorldTransform {
  const moving = frame.movingTiles.find((candidate) => candidate.tileId === tile.id);
  if (moving) {
    return {
      position: pixelToWorld(moving.xPx, moving.yPx, -0.58, project, pixelsPerMeter),
      rotationEulerDegrees: [0, round(moving.rotationDeg), 0],
      scale: scaleVector(moving.scale),
      visible: true,
    };
  }

  const match = frame.effects.find((effect) => effect.kind === 'match' && effect.tileIds.includes(tile.id));
  if (match) {
    const matchIndex = match.tileIds.indexOf(tile.id);
    const slotIndex = match.slotIndexes?.[matchIndex] ?? matchIndex;
    const center = tapTileTraySlotCenter(slotIndex);
    const slot = tapTileTraySlotRect(slotIndex);
    const pulse = Math.sin(Math.min(1, match.progress / 0.34) * Math.PI) * 0.12;
    const dissolve = Math.max(0, Math.min(1, (match.progress - 0.24) / 0.5));
    const effectScale = 1 + pulse + dissolve * 0.2;
    const xScale = slot.width / tile.geometry.widthPx * 1.08 * effectScale;
    const zScale = slot.height / tile.geometry.heightPx * 1.08 * effectScale;
    return {
      position: pixelToWorld(center.xPx, center.yPx, -0.5, project, pixelsPerMeter),
      rotationEulerDegrees: [0, 0, 0],
      scale: scaleVector(xScale, zScale),
      visible: dissolve < 0.985,
    };
  }

  const trayIndex = frame.gameState.trayIds.indexOf(tile.id);
  if (trayIndex >= 0) {
    const center = tapTileTraySlotCenter(trayIndex);
    const slot = tapTileTraySlotRect(trayIndex);
    return {
      position: pixelToWorld(center.xPx, center.yPx, -0.32, project, pixelsPerMeter),
      rotationEulerDegrees: [0, 0, 0],
      scale: scaleVector(
        slot.width / tile.geometry.widthPx * 0.92,
        slot.height / tile.geometry.heightPx * 0.92,
      ),
      visible: true,
    };
  }

  if (frame.gameState.boardIds.includes(tile.id)) {
    return {
      position: pixelToWorld(
        tile.geometry.centerXPx,
        tile.geometry.centerYPx,
        depthForBoardLayer(tile.geometry.layer),
        project,
        pixelsPerMeter,
      ),
      rotationEulerDegrees: [0, round(tile.geometry.rotationDeg), 0],
      scale: [1, 1, 1],
      visible: true,
    };
  }

  return {
    position: pixelToWorld(
      tile.geometry.centerXPx,
      tile.geometry.centerYPx,
      depthForBoardLayer(tile.geometry.layer),
      project,
      pixelsPerMeter,
    ),
    rotationEulerDegrees: [0, round(tile.geometry.rotationDeg), 0],
    scale: [1, 1, 1],
    visible: false,
  };
}

function sameVector(left: BlenderVector3, right: BlenderVector3): boolean {
  return left.every((value, index) => value === right[index]);
}

function sameTransform(left: TileWorldTransform, right: TileWorldTransform): boolean {
  return left.visible === right.visible
    && sameVector(left.position, right.position)
    && sameVector(left.rotationEulerDegrees, right.rotationEulerDegrees)
    && sameVector(left.scale, right.scale);
}

function keyframe(frame: number, transform: TileWorldTransform): BlenderExchangeTransformKeyframe {
  return {
    frame,
    position: transform.position,
    rotationEulerDegrees: transform.rotationEulerDegrees,
    scale: transform.scale,
    visible: transform.visible,
  };
}

function compressTransformSamples(samples: TileWorldTransform[]): BlenderExchangeTransformKeyframe[] {
  if (samples.length === 0) return [];
  const result: BlenderExchangeTransformKeyframe[] = [keyframe(1, samples[0]!)];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    if (sameTransform(previous, current)) continue;
    const previousFrame = index;
    if (result.at(-1)?.frame !== previousFrame) result.push(keyframe(previousFrame, previous));
    result.push(keyframe(index + 1, current));
  }
  const finalFrame = samples.length;
  if (result.at(-1)?.frame !== finalFrame) result.push(keyframe(finalFrame, samples.at(-1)!));
  return result;
}

function createTileTrack(
  project: TapTileProjectV2,
  compiled: CompiledTapTileTake,
  tile: CompiledTapTile,
  frames: TapTilePresentationFrame[],
  pixelsPerMeter: number,
): BlenderExchangeTransformTrack {
  return {
    entityId: tile.id,
    interpolation: 'linear',
    keyframes: compressTransformSamples(
      frames.map((frame) => transformForFrame(project, tile, frame, pixelsPerMeter)),
    ),
  };
}

export function createTapTileBlenderSceneExchange(
  project: TapTileProjectV2,
  level: CompiledTapTileLevel,
  compiled: CompiledTapTileTake,
  options: CreateTapTileBlenderExchangeOptions = {},
): BlenderSceneExchange {
  if (compiled.levelHash !== level.levelHash) throw new Error('BLENDER_EXCHANGE_LEVEL_HASH_MISMATCH');
  if (compiled.fps !== project.stage.fps) throw new Error('BLENDER_EXCHANGE_FPS_MISMATCH');
  const pixelsPerMeter = options.pixelsPerMeter ?? 180;
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) throw new Error('BLENDER_EXCHANGE_PIXELS_PER_METER_INVALID');
  const colors = sceneColors(project);
  const tiles = Object.values(level.tiles).sort((left, right) => left.id.localeCompare(right.id));
  const boardEntity: BlenderExchangeEntity = {
    id: 'bcs-stage-board',
    role: 'board-part',
    primitive: 'rounded-box',
    position: pixelToWorld(project.stage.exportWidth / 2, project.stage.exportHeight / 2, 0.72, project, pixelsPerMeter),
    rotationEulerDegrees: [0, 0, 0],
    scale: [1, 1, 1],
    dimensions: worldDimensions(project.stage.exportWidth * 0.94, 0.24, project.stage.exportHeight * 0.94, pixelsPerMeter),
    bevelRadius: round(28 / pixelsPerMeter),
    material: { baseColor: colors.board, roughness: 0.38, metallic: 0.03 },
  };
  const trayRect = normalizeTapTileTrayBounds(project.stage.safeAreas.tray);
  const trayCenterX = (trayRect.left + trayRect.right) / 2;
  const trayCenterY = (trayRect.top + trayRect.bottom) / 2;
  const trayEntity: BlenderExchangeEntity = {
    id: 'bcs-stage-tray',
    role: 'board-part',
    primitive: 'rounded-box',
    position: pixelToWorld(trayCenterX, trayCenterY, 0.28, project, pixelsPerMeter),
    rotationEulerDegrees: [0, 0, 0],
    scale: [1, 1, 1],
    dimensions: worldDimensions(trayRect.width, 0.34, trayRect.height, pixelsPerMeter),
    bevelRadius: round(24 / pixelsPerMeter),
    material: { baseColor: '#071B40', roughness: 0.52, metallic: 0.08 },
  };
  const material = tileMaterial(project);
  const imageAssetIds = new Set<string>();
  const tileEntities: BlenderExchangeEntity[] = tiles.map((tile) => ({
    id: tile.id,
    role: 'tile',
    primitive: 'rounded-box',
    position: pixelToWorld(
      tile.geometry.centerXPx,
      tile.geometry.centerYPx,
      depthForBoardLayer(tile.geometry.layer),
      project,
      pixelsPerMeter,
    ),
    rotationEulerDegrees: [0, round(tile.geometry.rotationDeg), 0],
    scale: [1, 1, 1],
    dimensions: worldDimensions(tile.geometry.widthPx, 0.28, tile.geometry.heightPx, pixelsPerMeter),
    bevelRadius: round(Math.min(tile.geometry.widthPx, tile.geometry.heightPx) * 0.12 / pixelsPerMeter),
    material: { ...material },
    face: tileFace(project, tile, imageAssetIds),
  }));
  const assets = [...imageAssetIds]
    .sort((left, right) => left.localeCompare(right))
    .map((assetId) => blenderAsset(project, assetId));

  const frames = options.includeTransformTracks === false
    ? []
    : Array.from({ length: compiled.totalFrames }, (_, index) => evaluateTapTileFrame(compiled, index));
  const tracks = options.includeTransformTracks === false
    ? []
    : tiles.map((tile) => createTileTrack(project, compiled, tile, frames, pixelsPerMeter));
  const events = compiled.actions
    .filter((action) => action.transition.matchedTileIds.length === 3)
    .map((action) => {
      const indexes = action.transition.matchedTileIds
        .map((tileId) => action.transition.trayAfterInsert.indexOf(tileId))
        .filter((index) => index >= 0);
      const points = indexes.map((index) => tapTileTraySlotCenter(index));
      const xPx = points.reduce((sum, point) => sum + point.xPx, 0) / Math.max(1, points.length);
      const yPx = points.reduce((sum, point) => sum + point.yPx, 0) / Math.max(1, points.length);
      const matchTile = level.tiles[action.transition.matchedTileIds[0] ?? ''];
      return {
        id: `${action.actionId}:match`,
        type: 'match' as const,
        frame: action.timing.matchStartFrame + 1,
        entityIds: [...action.transition.matchedTileIds],
        center: pixelToWorld(xPx, yPx, -0.56, project, pixelsPerMeter),
        intensity: Math.max(0, Math.min(2, compiled.profile.matchPresentation.shatter?.intensity ?? 1)),
        vfx: matchVfxForAction(
          compiled,
          action.timing.matchVfxEndFrame - action.timing.matchStartFrame + 1,
          paletteColor(matchTile?.matchKey ?? action.actionId),
        ),
      };
    });

  return {
    contract: 'bcs.blender-scene-exchange',
    contractVersion: '1.0.0',
    id: slug(options.packageId ?? `${project.id}-${compiled.takeId}-${stableHash({ level: level.levelHash, take: compiled.finalStateHash }, 'scene')}`),
    seed: compiled.seed,
    output: {
      width: project.render.width,
      height: project.render.height,
      fps: project.render.fps,
      frameStart: 1,
      frameEnd: Math.max(1, compiled.totalFrames),
      alphaMode: options.alphaMode ?? 'opaque',
    },
    coordinates: { handedness: 'right', upAxis: 'Z', unit: 'meter', unitScale: 1 },
    camera: {
      type: 'orthographic',
      // pixelToWorld centers the 2D canvas on world Z=0. Keeping the camera on
      // that same center and using the exact canvas height makes one meter map
      // to pixelsPerMeter pixels, so transparent VFX can overlay the 2D render
      // without a separate calibration transform.
      location: [0, -18, 0],
      target: [0, 0, 0],
      orthographicScale: round(project.stage.exportHeight / pixelsPerMeter),
    },
    stage: { backgroundColor: colors.background, groundColor: colors.board },
    assets,
    entities: [boardEntity, trayEntity, ...tileEntities],
    tracks,
    events,
  };
}
