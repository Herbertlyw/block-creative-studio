import {
  TAPTILE_PROJECT_FORMAT,
  TAPTILE_RULE_PROFILE_ID,
  TAPTILE_SCHEMA_VERSION,
  type TapTileProjectV2,
} from './types';
import {
  DEFAULT_TAPTILE_SNAP_GAP_PX,
  MAX_TAPTILE_SNAP_GAP_PX,
  MIN_TAPTILE_SNAP_GAP_PX,
} from '../snapGap';
import { normalizeTapTileTrayBounds } from '../trayLayout';

export class TapTileProjectValidationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'TapTileProjectValidationError';
  }
}

function fail(path: string, message: string): never {
  throw new TapTileProjectValidationError(path, message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '必须是对象。');
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(path, '必须是非空字符串。');
  return value;
}

function integer(value: unknown, path: string, minimum = Number.MIN_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || (value as number) < minimum) fail(path, `必须是大于等于 ${minimum} 的整数。`);
  return value as number;
}

function finite(value: unknown, path: string, minimum = Number.NEGATIVE_INFINITY): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) fail(path, `必须是大于等于 ${minimum} 的有限数值。`);
  return value;
}

export function isTapTileProjectV2(value: unknown): value is TapTileProjectV2 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TapTileProjectV2>;
  return candidate.format === TAPTILE_PROJECT_FORMAT && candidate.schemaVersion === TAPTILE_SCHEMA_VERSION;
}

export function parseTapTileProjectV2(value: unknown): TapTileProjectV2 {
  const root = record(value, 'root');
  if (root.format !== TAPTILE_PROJECT_FORMAT) fail('root.format', `必须是 ${TAPTILE_PROJECT_FORMAT}。`);
  if (root.schemaVersion !== TAPTILE_SCHEMA_VERSION) fail('root.schemaVersion', `仅支持 ${TAPTILE_SCHEMA_VERSION}。`);
  if (root.ruleProfileId !== TAPTILE_RULE_PROFILE_ID) fail('root.ruleProfileId', `仅支持 ${TAPTILE_RULE_PROFILE_ID}。`);
  string(root.id, 'root.id');
  string(root.name, 'root.name');
  integer(root.revision, 'root.revision', 0);
  if (Number.isNaN(Date.parse(string(root.createdAt, 'root.createdAt')))) fail('root.createdAt', '必须是合法 ISO 时间。');
  if (Number.isNaN(Date.parse(string(root.updatedAt, 'root.updatedAt')))) fail('root.updatedAt', '必须是合法 ISO 时间。');

  const stage = record(root.stage, 'root.stage');
  if (stage.authoringWidth !== 432 || stage.authoringHeight !== 768 || stage.exportWidth !== 1080 || stage.exportHeight !== 1920 || stage.scale !== 2.5 || stage.fps !== 30) {
    fail('root.stage', '一期舞台必须是 432×768 → 1080×1920、2.5 倍、30fps。');
  }
  record(stage.safeAreas, 'root.stage.safeAreas');
  const assets = record(root.assets, 'root.assets');
  const assetEntries = record(assets.entries, 'root.assets.entries');
  for (const [assetId, rawAsset] of Object.entries(assetEntries)) {
    const path = `root.assets.entries.${assetId}`;
    const asset = record(rawAsset, path);
    if (string(asset.id, `${path}.id`) !== assetId) fail(`${path}.id`, '必须与字典 key 一致。');
    if (!['image', 'sequence', 'audio', 'video'].includes(string(asset.kind, `${path}.kind`))) fail(`${path}.kind`, '是不支持的资产类型。');
    const source = record(asset.source, `${path}.source`);
    const sourceType = string(source.type, `${path}.source.type`);
    if (sourceType === 'builtin') string(source.uri, `${path}.source.uri`);
    else if (sourceType === 'indexeddb') string(source.blobId, `${path}.source.blobId`);
    else fail(`${path}.source.type`, '必须是 builtin 或 indexeddb。');
    string(asset.version, `${path}.version`);
  }
  const visuals = record(root.visuals, 'root.visuals');
  const archetypes = record(visuals.archetypes, 'root.visuals.archetypes');
  record(visuals.faceAssemblies, 'root.visuals.faceAssemblies');
  record(visuals.bodyStyles, 'root.visuals.bodyStyles');
  const themes = record(visuals.themes, 'root.visuals.themes');
  const selectedThemeId = string(visuals.selectedThemeId, 'root.visuals.selectedThemeId');
  if (!themes[selectedThemeId]) fail('root.visuals.selectedThemeId', `找不到主题 ${selectedThemeId}。`);

  const level = record(root.level, 'root.level');
  string(level.id, 'root.level.id');
  string(level.name, 'root.level.name');
  if (!Array.isArray(level.tileInstances)) fail('root.level.tileInstances', '必须是数组。');
  const ids = new Set<string>();
  level.tileInstances.forEach((raw, index) => {
    const path = `root.level.tileInstances[${index}]`;
    const tile = record(raw, path);
    const id = string(tile.id, `${path}.id`);
    if (ids.has(id)) fail(`${path}.id`, `重复 tile id：${id}。`);
    ids.add(id);
    const archetypeId = string(tile.archetypeId, `${path}.archetypeId`);
    if (!archetypes[archetypeId]) fail(`${path}.archetypeId`, `找不到 archetype ${archetypeId}。`);
    const geometry = record(tile.geometry, `${path}.geometry`);
    integer(geometry.centerXPx, `${path}.geometry.centerXPx`);
    integer(geometry.centerYPx, `${path}.geometry.centerYPx`);
    integer(geometry.widthPx, `${path}.geometry.widthPx`, 1);
    integer(geometry.heightPx, `${path}.geometry.heightPx`, 1);
    finite(geometry.rotationDeg, `${path}.geometry.rotationDeg`);
    integer(geometry.layer, `${path}.geometry.layer`, 0);
    integer(geometry.order, `${path}.geometry.order`);
    const authoring = record(tile.authoring, `${path}.authoring`);
    if (typeof authoring.editorLocked !== 'boolean') fail(`${path}.authoring.editorLocked`, '必须是布尔值。');
  });
  const policy = record(level.blockerPolicy, 'root.level.blockerPolicy');
  finite(policy.minimumOverlapAreaPx, 'root.level.blockerPolicy.minimumOverlapAreaPx', 0);
  finite(policy.minimumOverlapRatio, 'root.level.blockerPolicy.minimumOverlapRatio', 0);
  finite(policy.epsilonPx, 'root.level.blockerPolicy.epsilonPx', 0);
  const overrides = record(level.blockerOverrides, 'root.level.blockerOverrides');
  if (!Array.isArray(overrides.forced) || !Array.isArray(overrides.ignored)) fail('root.level.blockerOverrides', 'forced/ignored 必须是数组。');
  if (!Array.isArray(root.takes)) fail('root.takes', '必须是数组。');
  record(root.director, 'root.director');
  const render = record(root.render, 'root.render');
  if (render.width !== 1080 || render.height !== 1920 || render.fps !== 30) fail('root.render', '一期输出必须是 1080×1920、30fps。');
  const authoring = record(root.authoring, 'root.authoring');
  if (authoring.snapGapPx !== undefined) {
    const snapGapPx = integer(authoring.snapGapPx, 'root.authoring.snapGapPx', MIN_TAPTILE_SNAP_GAP_PX);
    if (snapGapPx > MAX_TAPTILE_SNAP_GAP_PX) {
      fail('root.authoring.snapGapPx', `必须小于等于 ${MAX_TAPTILE_SNAP_GAP_PX}。`);
    }
  }
  const production = record(root.production, 'root.production');
  const audioPacks = record(production.audioPacks, 'root.production.audioPacks');
  const validateCue = (rawCue: unknown, path: string): void => {
    const cue = record(rawCue, path);
    if (!Array.isArray(cue.assetIds) || cue.assetIds.length === 0) fail(`${path}.assetIds`, '必须至少引用一个音频资产。');
    for (const [index, rawAssetId] of cue.assetIds.entries()) {
      const assetId = string(rawAssetId, `${path}.assetIds[${index}]`);
      const asset = assetEntries[assetId] as Record<string, unknown> | undefined;
      if (!asset) fail(`${path}.assetIds[${index}]`, `找不到资产 ${assetId}。`);
      if (asset.kind !== 'audio') fail(`${path}.assetIds[${index}]`, `${assetId} 不是音频资产。`);
    }
    finite(cue.volume, `${path}.volume`, 0);
    finite(cue.startOffsetMs, `${path}.startOffsetMs`, 0);
    finite(cue.fadeInMs, `${path}.fadeInMs`, 0);
    finite(cue.fadeOutMs, `${path}.fadeOutMs`, 0);
    integer(cue.delayFrames, `${path}.delayFrames`, 0);
    if (cue.peakLimit !== undefined && (finite(cue.peakLimit, `${path}.peakLimit`, 0) > 1)) fail(`${path}.peakLimit`, '必须在 0–1 之间。');
  };
  for (const [packId, rawPack] of Object.entries(audioPacks)) {
    const path = `root.production.audioPacks.${packId}`;
    const pack = record(rawPack, path);
    if (string(pack.id, `${path}.id`) !== packId) fail(`${path}.id`, '必须与字典 key 一致。');
    string(pack.name, `${path}.name`);
    if (pack.peakLimit !== undefined && (finite(pack.peakLimit, `${path}.peakLimit`, 0) > 1)) fail(`${path}.peakLimit`, '必须在 0–1 之间。');
    validateCue(pack.tap, `${path}.tap`);
    validateCue(pack.traySettle, `${path}.traySettle`);
    validateCue(pack.match, `${path}.match`);
    for (const cueName of ['pickup', 'shatter', 'warning', 'win', 'outro']) if (pack[cueName] !== undefined) validateCue(pack[cueName], `${path}.${cueName}`);
  }
  if (production.selectedAudioPackId !== undefined) {
    const selectedAudioPackId = string(production.selectedAudioPackId, 'root.production.selectedAudioPackId');
    if (!audioPacks[selectedAudioPackId]) fail('root.production.selectedAudioPackId', `找不到 AudioPack ${selectedAudioPackId}。`);
  }
  const outros = record(production.outros, 'root.production.outros');
  for (const [outroId, rawOutro] of Object.entries(outros)) {
    const path = `root.production.outros.${outroId}`;
    const outro = record(rawOutro, path);
    if (string(outro.id, `${path}.id`) !== outroId) fail(`${path}.id`, '必须与字典 key 一致。');
    string(outro.name, `${path}.name`);
    integer(outro.durationFrames, `${path}.durationFrames`, 1);
  }
  const cuts = record(production.cuts, 'root.production.cuts');
  for (const [cutId, rawCut] of Object.entries(cuts)) {
    const path = `root.production.cuts.${cutId}`;
    const cut = record(rawCut, path);
    if (string(cut.id, `${path}.id`) !== cutId) fail(`${path}.id`, '必须与字典 key 一致。');
    string(cut.name, `${path}.name`);
    const range = record(cut.takeRange, `${path}.takeRange`);
    const start = integer(range.startActionIndex, `${path}.takeRange.startActionIndex`, 0);
    const end = integer(range.endActionIndex, `${path}.takeRange.endActionIndex`, 0);
    if (end < start) fail(`${path}.takeRange`, 'endActionIndex 不得小于 startActionIndex。');
    if (cut.introFrames !== undefined) integer(cut.introFrames, `${path}.introFrames`, 0);
    if (cut.targetDurationFrames !== undefined) integer(cut.targetDurationFrames, `${path}.targetDurationFrames`, 1);
    if (cut.outroPackId !== undefined) {
      const outroPackId = string(cut.outroPackId, `${path}.outroPackId`);
      if (!outros[outroPackId]) fail(`${path}.outroPackId`, `找不到 OutroPack ${outroPackId}。`);
    }
    if (cut.timeWarpSegments !== undefined) {
      if (!Array.isArray(cut.timeWarpSegments)) fail(`${path}.timeWarpSegments`, '必须是数组。');
      for (const [index, rawSegment] of cut.timeWarpSegments.entries()) {
        const segmentPath = `${path}.timeWarpSegments[${index}]`;
        const segment = record(rawSegment, segmentPath);
        const sourceStart = integer(segment.sourceStartFrame, `${segmentPath}.sourceStartFrame`, 0);
        const sourceEnd = integer(segment.sourceEndFrame, `${segmentPath}.sourceEndFrame`, 0);
        if (sourceEnd < sourceStart) fail(segmentPath, 'sourceEndFrame 不得小于 sourceStartFrame。');
        finite(segment.speed, `${segmentPath}.speed`, Number.EPSILON);
      }
    }
  }
  if (production.selectedCutId !== undefined) {
    const selectedCutId = string(production.selectedCutId, 'root.production.selectedCutId');
    if (!cuts[selectedCutId]) fail('root.production.selectedCutId', `找不到 CutSpec ${selectedCutId}。`);
  }
  const parsed = structuredClone(value) as TapTileProjectV2;
  parsed.stage.safeAreas.tray = normalizeTapTileTrayBounds(parsed.stage.safeAreas.tray);
  parsed.authoring.snapGapPx = authoring.snapGapPx === undefined
    ? DEFAULT_TAPTILE_SNAP_GAP_PX
    : authoring.snapGapPx as number;
  return parsed;
}
