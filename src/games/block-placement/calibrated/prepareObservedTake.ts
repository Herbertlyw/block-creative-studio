// Validate and normalize an observation without constructing a drawing backend.
import { BB_FRAME_SCHEMA } from '../planning/timelineFrameSource';
import { resolveReferenceSprites } from '../../../nativeReference/games/block-placement/presentation/referenceSprites';
import { takeFromBBReplay } from '../authoring/replayTake';
import { parseReferenceCalibration } from './parseCalibration';
import { stableHash } from '../../../nativeReference/headless/stableHash';
import { normalizeObservedTake } from '../planning/normalizeObservedTake';
import type { ImageBindings, ImageBinding } from './imageBindings';
import type { StudioProjectDocumentV2 } from '../../../nativeReference/game-runtime/projectEnvelope';
import type { PointerOverlay } from '../../../contracts/observedPointer';

type InputBinding = {
  slotId?: unknown;
  role?: unknown;
  assetId?: unknown;
  fit?: unknown;
  opacity?: unknown;
  blendMode?: unknown;
  inset?: unknown;
  transform?: unknown;
  playback?: unknown;
};
type InputAsset = {
  kind?: unknown;
  mimeType?: unknown;
  encoding?: unknown;
  data?: unknown;
  sha256?: unknown;
};
type InputStyle = {
  referenceCalibration?: unknown;
  agentAssets?: { bindings?: Record<string, InputBinding>; entries?: Record<string, InputAsset> };
};
type ObservedOptions = { takeId: string; pointer?: PointerOverlay | null; calibration?: unknown };

export function prepareObservedTake(document: StudioProjectDocumentV2, options: ObservedOptions) {
  const style = document.direction?.style as InputStyle | undefined;
  const replay = options.takeId
    ? document.takes.find((t) => t.takeId === options.takeId)
    : document.takes[0];
  if (!replay) throw new Error(`REFERENCE_CALIBRATION_TAKE_MISSING:${options.takeId}`);
  if (!options.calibration && replay !== document.takes[0])
    throw new Error('REFERENCE_CALIBRATION_TAKE_MISMATCH');
  const calibration = parseReferenceCalibration(
    options.calibration ?? style?.referenceCalibration,
    document,
    replay.takeId,
  );
  // Match the public reference clip operation before resolving transport-only
  // asset: references into data URIs. Rendering still uses the resolved bytes.
  const pointer = options.pointer ?? null,
    assets = style?.agentAssets,
    entries = assets?.entries ?? {};
  const bindings: ImageBindings = { background: null, face: null, atlas: null };
  const addedSprites: Record<string, string> = {};
  for (const [slot, key, sprite, role] of [
    ['background.base', 'background', 'workBackground', 'background-image'],
    ['tile.face', 'face', 'workTileFace', 'tile-face-image'],
    ['board.atlas', 'atlas', 'workBoardAtlas', 'board-atlas-image'],
  ] as const) {
    const binding = assets?.bindings?.[slot];
    if (!binding) continue;
    if (
      binding.slotId !== slot ||
      binding.role !== role ||
      typeof binding.assetId !== 'string' ||
      typeof binding.fit !== 'string' ||
      !['cover', 'contain', 'stretch'].includes(binding.fit) ||
      typeof binding.opacity !== 'number' ||
      !Number.isFinite(binding.opacity) ||
      binding.opacity < 0 ||
      binding.opacity > 1 ||
      typeof binding.blendMode !== 'string' ||
      !['source-over', 'multiply', 'screen', 'overlay', 'soft-light'].includes(binding.blendMode) ||
      typeof binding.inset !== 'number' ||
      !Number.isFinite(binding.inset) ||
      binding.inset < 0 ||
      binding.inset > 0.45 ||
      binding.transform !== undefined ||
      binding.playback !== undefined ||
      (slot === 'background.base' && binding.inset !== 0)
    )
      throw new Error(`CALIBRATED_IMAGE_BINDING_UNSUPPORTED:${slot}：配置包含尚未消费的字段。`);
    if (
      slot === 'background.base' &&
      (calibration.appearance?.backdropTimeline || calibration.appearance?.cleanBoardSample)
    )
      throw new Error(
        'CALIBRATED_BACKGROUND_CONFLICT:现有背景图集或棋盘采样与 background.base 不能同时使用。',
      );
    const entry = entries[binding.assetId];
    if (
      !entry ||
      entry.kind !== 'image' ||
      typeof entry.mimeType !== 'string' ||
      !['image/png', 'image/jpeg'].includes(entry.mimeType) ||
      entry.encoding !== 'base64' ||
      typeof entry.data !== 'string'
    )
      throw new Error(`CALIBRATED_IMAGE_ASSET_MISSING:${slot}:${binding.assetId}`);
    bindings[key] = {
      fit: binding.fit as ImageBinding['fit'],
      opacity: binding.opacity,
      blendMode: binding.blendMode as GlobalCompositeOperation,
      inset: binding.inset,
    };
    addedSprites[sprite] = `data:${entry.mimeType};base64,${entry.data}`;
  }
  const spriteRefs = Object.values(calibration.sprites ?? {}).filter(
    (value): value is string => typeof value === 'string' && value.startsWith('asset:'),
  );
  const usedIds = new Set([
    ...spriteRefs.map((value) => value.slice(6)),
    ...Object.values(assets?.bindings ?? {}).flatMap((value) =>
      typeof value.assetId === 'string' ? [value.assetId] : [],
    ),
  ]);
  const resourceHashes = [...usedIds]
    .sort()
    .map((assetId) => ({ assetId, sha256: entries[assetId]?.sha256 }));
  const frameSourceHash = stableHash({
    calibration,
    replay,
    frameModel: BB_FRAME_SCHEMA,
    resourceHashes,
    bindings: assets?.bindings ?? {},
    ...(pointer ? { pointer } : {}),
  });
  calibration.sprites = {
    ...resolveReferenceSprites(calibration.sprites, entries),
    ...addedSprites,
  };
  const take = takeFromBBReplay(document.game, replay);
  const plan = normalizeObservedTake(take, calibration, document.production.output.fps, pointer);
  return { replay, calibration, pointer, bindings, frameSourceHash, plan };
}
