import { parseReferenceClearRules } from './clearRules';
import { boardFingerprint, createProjectGame, replayActions } from './gameEngine';
import { identifyCreativeDocument } from './projectIdentity';
import { getShape, TILE_COLORS } from './shapes';
import type {
  BoardState,
  GameSnapshot,
  PieceInstance,
  PlacementAction,
  ProjectSpec,
  Reference2DStyleSpec,
  RhythmProfile,
  StudioTestAudio,
  StyleSpec,
  Take,
  TileColor,
} from './types';

export interface StudioBundle {
  format: 'block-creative-studio-project';
  version: '1.0.0';
  project: ProjectSpec;
  takes: Take[];
}

const MATERIALS = new Set(['glossy-plastic', 'candy-resin', 'crystal-glass']);
const LIGHTS = new Set(['clean-studio', 'soft-candy', 'neon-contrast']);
const CAMERAS = new Set(['flat-gameplay', 'premium-perspective', 'dynamic-clear']);
const EFFECTS = new Set(['clean-pop', 'crystal-shatter', 'energy-burst']);
const GEOMETRIES = new Set(['soft-cube', 'premium-beveled', 'candy-rounded']);
const RHYTHMS = new Set(['human-natural', 'tight-fast', 'suspense-burst', 'combo-rush']);
const RENDERERS = new Set(['reference-2d', 'three-3d']);
const REFERENCE_TILE_MATERIALS = new Set(['soft-bevel', 'flat-matte']);
const REFERENCE_TILE_FACE_SETS = new Set(['botanical-reference', 'none']);
const REFERENCE_PREVIEW_FX = new Set(['full-line-tint', 'cells-only']);
const REFERENCE_CLEAR_FX = new Set(['sweep-score-spark', 'sweep-only']);
const REFERENCE_FEEDBACK_FX = new Set(['praise-combo', 'score-only']);
const REFERENCE_AMBIENT_FX = new Set(['garden-petals', 'none']);
const COLORS = new Set<string>([...TILE_COLORS, 'rose']);

function piecesFingerprint(pieces: PieceInstance[]): string {
  return [...pieces]
    .sort((left, right) => left.slotIndex - right.slotIndex)
    .map((piece) =>
      [
        piece.id,
        piece.shapeId,
        piece.color,
        piece.cellColors?.join(',') ?? '',
        piece.used ? 1 : 0,
        piece.setIndex,
        piece.slotIndex,
      ].join(':'),
    )
    .join('|');
}

function snapshotFingerprint(snapshot: GameSnapshot): string {
  return [
    boardFingerprint(snapshot.board),
    piecesFingerprint(snapshot.pieces),
    snapshot.seed,
    snapshot.setIndex,
    snapshot.turn,
    snapshot.score,
    snapshot.combo,
    snapshot.status,
    snapshot.clearAxes ?? '',
    snapshot.clearTrigger ?? '',
    snapshot.supplyExhausted ? 1 : 0,
    JSON.stringify(snapshot.referenceClearRules ?? []),
    snapshot.fixedPieceSupply?.map(piecesFingerprint).join('~') ?? '',
    snapshot.seedSupplyVersion ?? '',
  ].join('~');
}

function fail(path: string, detail: string): never {
  throw new Error(`项目文件校验失败：${path} ${detail}`);
}

const FIELD_NOTES: Record<string, string> = {
  audio:
    '工作台 V1 的声音配置。当前只接受公开包自己的测试音效 {enabled, sfxGain}，以及可选的 bgmGain、bgmStartSeconds、bgmSourceOffsetSeconds、bgmLoop。不能丢弃或替换原声音。',
  lookDev: '3D 灯光外观扩展。当前渲染器不会读取它。',
  diagnosticView: '诊断视图。当前预览不会读取它。',
  enabledPasses: '渲染通道开关。当前预览不会读取它。',
  materialRuntime: '材质运行时描述。当前材质面板不会读取它。',
  materialBehavior: '材质行为。当前材质面板不会读取它。',
  shotExecution: '镜头执行。当前导演不会读取它。',
  agentAssets: '素材绑定。当前导入不会静默丢掉图集或附件。',
};

function rejectUnknownKeys(
  source: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(source)) {
    if (allowed.has(key)) continue;
    const note = FIELD_NOTES[key];
    fail(
      `${path}.${key}`,
      note
        ? `不能在当前编辑器中应用。${note}已拒绝导入。`
        : '不是当前编辑器认识的字段。为避免静默丢弃，已拒绝导入。',
    );
  }
}

export function isStudioTestAudio(value: unknown): value is StudioTestAudio {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  const audioKeys = new Set([
    'enabled',
    'sfxGain',
    'bgmGain',
    'bgmStartSeconds',
    'bgmSourceOffsetSeconds',
    'bgmLoop',
    'bgmPattern',
    'cueOverrides',
  ]);
  if (keys.some((key) => !audioKeys.has(key))) return false;
  if (typeof source.enabled !== 'boolean') return false;
  if (typeof source.sfxGain !== 'number' || !Number.isFinite(source.sfxGain)) return false;
  for (const key of ['bgmGain', 'bgmStartSeconds', 'bgmSourceOffsetSeconds']) {
    if (
      source[key] !== undefined &&
      (typeof source[key] !== 'number' || !Number.isFinite(source[key]) || source[key] < 0)
    )
      return false;
  }
  if (source.bgmLoop !== undefined && typeof source.bgmLoop !== 'boolean') return false;
  if (source.bgmPattern !== undefined && source.bgmPattern !== 'melody-v1') return false;
  if (source.bgmGain !== undefined && (source.bgmGain as number) > 1) return false;
  if (source.cueOverrides !== undefined) {
    if (!Array.isArray(source.cueOverrides)) return false;
    const kinds = new Set(['place', 'line-cleared', 'cross-cleared', 'praise', 'game-over']);
    const seen = new Set<string>();
    for (const item of source.cueOverrides) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const cue = item as Record<string, unknown>;
      if (
        Object.keys(cue).some(
          (key) => !['kind', 'gain', 'offsetSeconds', 'eventId'].includes(key),
        ) ||
        typeof cue.kind !== 'string' ||
        !kinds.has(cue.kind)
      )
        return false;
      if (
        cue.eventId !== undefined &&
        (typeof cue.eventId !== 'string' || cue.eventId.length < 1 || cue.eventId.length > 512)
      )
        return false;
      const key = `${cue.kind}:${cue.eventId ?? ''}`;
      if (seen.has(key)) return false;
      if (
        typeof cue.gain !== 'number' ||
        !Number.isFinite(cue.gain) ||
        cue.gain < 0 ||
        cue.gain > 1 ||
        typeof cue.offsetSeconds !== 'number' ||
        !Number.isFinite(cue.offsetSeconds) ||
        Math.abs(cue.offsetSeconds) > 60
      )
        return false;
      seen.add(key);
    }
  }
  return true;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '必须是对象。');
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, maximum = 240): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    fail(path, `必须是 1–${maximum} 字符的字符串。`);
  }
  return value;
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `必须是 ${minimum}–${maximum} 之间的有限数字。`);
  }
  return value;
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  const result = finite(value, path, minimum, maximum);
  if (!Number.isInteger(result)) fail(path, '必须是整数。');
  return result;
}

function enumeration<T extends string>(value: unknown, values: Set<string>, path: string): T {
  if (typeof value !== 'string' || !values.has(value)) fail(path, '包含未知枚举值。');
  return value as T;
}

function parseBoard(value: unknown, path: string): BoardState {
  const source = record(value, path);
  rejectUnknownKeys(source, new Set(['rows', 'cols', 'cells']), path);
  const rows = integer(source.rows, `${path}.rows`, 8, 8);
  const cols = integer(source.cols, `${path}.cols`, 8, 8);
  if (!Array.isArray(source.cells) || source.cells.length !== rows)
    fail(`${path}.cells`, '必须有 8 行。');
  const cells = source.cells.map((rowValue, row) => {
    if (!Array.isArray(rowValue) || rowValue.length !== cols)
      fail(`${path}.cells[${row}]`, '必须有 8 列。');
    return rowValue.map((cell, col) => {
      if (cell === null) return null;
      if (typeof cell !== 'string' || !COLORS.has(cell))
        fail(`${path}.cells[${row}][${col}]`, '颜色无效。');
      return cell as TileColor;
    });
  });
  return { rows, cols, cells };
}

function parsePiece(value: unknown, path: string): PieceInstance {
  const source = record(value, path);
  rejectUnknownKeys(
    source,
    new Set(['id', 'shapeId', 'color', 'used', 'setIndex', 'slotIndex', 'cellColors']),
    path,
  );
  const shapeId = string(source.shapeId, `${path}.shapeId`, 80);
  let shape: ReturnType<typeof getShape>;
  try {
    shape = getShape(shapeId);
  } catch {
    fail(`${path}.shapeId`, `未知形状 ${shapeId}。`);
  }

  let cellColors: TileColor[] | undefined;
  if (source.cellColors !== undefined) {
    if (!Array.isArray(source.cellColors)) fail(`${path}.cellColors`, '必须是颜色数组。');
    if (source.cellColors.length !== shape.cells.length) {
      fail(`${path}.cellColors`, `必须与形状单元数量一致（${shape.cells.length}）。`);
    }
    cellColors = source.cellColors.map((color, index) =>
      enumeration<TileColor>(color, COLORS, `${path}.cellColors[${index}]`),
    );
  }

  return {
    id: string(source.id, `${path}.id`, 160),
    shapeId,
    color: enumeration<TileColor>(source.color, COLORS, `${path}.color`),
    used: typeof source.used === 'boolean' ? source.used : fail(`${path}.used`, '必须是布尔值。'),
    setIndex: integer(source.setIndex, `${path}.setIndex`, 0, 100_000),
    slotIndex: integer(source.slotIndex, `${path}.slotIndex`, 0, 2),
    ...(cellColors ? { cellColors } : {}),
  };
}

function parsePieces(value: unknown, path: string): PieceInstance[] {
  if (!Array.isArray(value) || value.length !== 3) fail(path, '必须正好包含三个候选块。');
  const pieces = value.map((piece, index) => parsePiece(piece, `${path}[${index}]`));
  const slotIndexes = pieces.map((piece) => piece.slotIndex).sort((left, right) => left - right);
  if (slotIndexes.join(',') !== '0,1,2') fail(path, 'slotIndex 必须恰好覆盖 0、1、2。');
  if (new Set(pieces.map((piece) => piece.id)).size !== 3) fail(path, '三个 piece id 必须唯一。');
  if (new Set(pieces.map((piece) => piece.setIndex)).size !== 1) {
    fail(path, '同一候选组的 setIndex 必须一致。');
  }
  return pieces;
}

function parseAxes(value: unknown, path: string): 'rows' | 'columns' | 'both' {
  if (value === 'rows' || value === 'columns' || value === 'both') return value;
  fail(path, '必须是 rows、columns 或 both。');
}

function parseTrigger(value: unknown, path: string): 'line-complete' | 'board-full' {
  if (value === 'line-complete' || value === 'board-full') return value;
  fail(path, '必须是 line-complete 或 board-full。');
}

function parseRuleFields(
  source: Record<string, unknown>,
  path: string,
): Pick<GameSnapshot, 'clearAxes' | 'clearTrigger' | 'referenceClearRules'> {
  let referenceClearRules: GameSnapshot['referenceClearRules'];
  if (source.referenceClearRules !== undefined) {
    try {
      referenceClearRules = parseReferenceClearRules(source.referenceClearRules);
    } catch (error) {
      fail(`${path}.referenceClearRules`, error instanceof Error ? error.message : '无效。');
    }
  }
  return {
    ...(source.clearAxes === undefined
      ? {}
      : { clearAxes: parseAxes(source.clearAxes, `${path}.clearAxes`) }),
    ...(source.clearTrigger === undefined
      ? {}
      : { clearTrigger: parseTrigger(source.clearTrigger, `${path}.clearTrigger`) }),
    ...(referenceClearRules ? { referenceClearRules } : {}),
  };
}

function parseSupply(value: unknown, path: string): PieceInstance[][] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500)
    fail(path, '必须是 1–500 组候选。');
  const supply = value.map((batch, index) => {
    const pieces = parsePieces(batch, `${path}[${index}]`);
    if (pieces.some((piece) => piece.setIndex !== index || piece.used)) {
      fail(`${path}[${index}]`, '每组 setIndex 必须等于轮次，且供给中的候选不能已使用。');
    }
    return pieces;
  });
  return supply;
}

function parseSnapshot(value: unknown, path: string): GameSnapshot {
  const source = record(value, path);
  rejectUnknownKeys(
    source,
    new Set([
      'board',
      'pieces',
      'seed',
      'setIndex',
      'turn',
      'score',
      'combo',
      'status',
      'clearAxes',
      'clearTrigger',
      'referenceClearRules',
      'fixedPieceSupply',
      'supplyExhausted',
      'seedSupplyVersion',
    ]),
    path,
  );
  const status =
    source.status === 'playing' || source.status === 'game-over'
      ? source.status
      : fail(`${path}.status`, '无效。');
  const pieces = parsePieces(source.pieces, `${path}.pieces`);
  const setIndex = integer(source.setIndex, `${path}.setIndex`, 0, 100_000);
  if (pieces.some((piece) => piece.setIndex !== setIndex)) {
    fail(`${path}.pieces`, '候选块 setIndex 必须与快照 setIndex 一致。');
  }
  return {
    board: parseBoard(source.board, `${path}.board`),
    pieces,
    seed: integer(source.seed, `${path}.seed`, 0, 2_147_483_647),
    setIndex,
    turn: integer(source.turn, `${path}.turn`, 0, 100_000),
    score: integer(source.score, `${path}.score`, 0, 2_147_483_647),
    combo: integer(source.combo, `${path}.combo`, 0, 100_000),
    status,
    ...parseRuleFields(source, path),
    ...(source.seedSupplyVersion === undefined
      ? {}
      : {
          seedSupplyVersion:
            source.seedSupplyVersion === 'reference-worktree-0f237a8f'
              ? source.seedSupplyVersion
              : fail(`${path}.seedSupplyVersion`, '未知种子供给版本。'),
        }),
    ...(source.supplyExhausted === undefined
      ? {}
      : {
          supplyExhausted:
            source.supplyExhausted === true
              ? true
              : fail(`${path}.supplyExhausted`, '必须是 true。'),
        }),
    ...(source.fixedPieceSupply === undefined
      ? {}
      : { fixedPieceSupply: parseSupply(source.fixedPieceSupply, `${path}.fixedPieceSupply`) }),
  };
}

function parseAction(value: unknown, path: string): PlacementAction {
  const source = record(value, path);
  rejectUnknownKeys(
    source,
    new Set([
      'id',
      'actor',
      'pieceId',
      'anchor',
      'durationFrames',
      'pointerPath',
      'pointerPathMode',
    ]),
    path,
  );
  const anchorSource = record(source.anchor, `${path}.anchor`);
  rejectUnknownKeys(anchorSource, new Set(['row', 'col']), `${path}.anchor`);
  if (!Array.isArray(source.pointerPath) || source.pointerPath.length > 10_000) {
    fail(`${path}.pointerPath`, '必须是长度不超过 10000 的数组。');
  }
  let previousFrame = -1;
  const pointerPath = source.pointerPath.map((sampleValue, index) => {
    const sample = record(sampleValue, `${path}.pointerPath[${index}]`);
    rejectUnknownKeys(sample, new Set(['frameOffset', 'x', 'y']), `${path}.pointerPath[${index}]`);
    const frameOffset = integer(
      sample.frameOffset,
      `${path}.pointerPath[${index}].frameOffset`,
      0,
      100_000,
    );
    if (frameOffset < previousFrame) fail(`${path}.pointerPath`, 'frameOffset 必须按升序排列。');
    previousFrame = frameOffset;
    return {
      frameOffset,
      x: finite(sample.x, `${path}.pointerPath[${index}].x`, 0, 1),
      y: finite(sample.y, `${path}.pointerPath[${index}].y`, 0, 1),
    };
  });
  const durationFrames = integer(source.durationFrames, `${path}.durationFrames`, 1, 10_000);
  if (pointerPath.length > 0 && pointerPath[0]?.frameOffset !== 0) {
    fail(`${path}.pointerPath[0].frameOffset`, '非空轨迹必须从第 0 帧开始。');
  }
  if (pointerPath.some((sample) => sample.frameOffset > durationFrames)) {
    fail(`${path}.pointerPath`, 'frameOffset 不能超过动作 durationFrames。');
  }
  if (source.pointerPathMode !== undefined && source.pointerPathMode !== 'authored')
    fail(`${path}.pointerPathMode`, '未知轨迹模式。');
  if (source.pointerPathMode === 'authored' && pointerPath.length < 2)
    fail(`${path}.pointerPath`, '自定义轨迹至少需要两个点。');
  return {
    id: string(source.id, `${path}.id`, 180),
    actor:
      source.actor === 'human' || source.actor === 'agent'
        ? source.actor
        : fail(`${path}.actor`, '必须是 human 或 agent。'),
    pieceId: string(source.pieceId, `${path}.pieceId`, 180),
    anchor: {
      row: integer(anchorSource.row, `${path}.anchor.row`, 0, 7),
      col: integer(anchorSource.col, `${path}.anchor.col`, 0, 7),
    },
    durationFrames,
    pointerPath,
    ...(source.pointerPathMode === 'authored' ? { pointerPathMode: 'authored' as const } : {}),
  };
}

function parseTake(value: unknown, path: string): Take {
  const source = record(value, path);
  rejectUnknownKeys(source, new Set(['id', 'name', 'createdAt', 'initial', 'actions']), path);
  if (!Array.isArray(source.actions) || source.actions.length > 2_000)
    fail(`${path}.actions`, '动作数量超过限制。');
  const take: Take = {
    id: string(source.id, `${path}.id`, 180),
    name: string(source.name, `${path}.name`, 240),
    createdAt: string(source.createdAt, `${path}.createdAt`, 80),
    initial: parseSnapshot(source.initial, `${path}.initial`),
    actions: source.actions.map((action, index) =>
      parseAction(action, `${path}.actions[${index}]`),
    ),
  };
  if (Number.isNaN(Date.parse(take.createdAt))) fail(`${path}.createdAt`, '不是合法 ISO 日期。');
  if (new Set(take.actions.map((action) => action.id)).size !== take.actions.length) {
    fail(`${path}.actions`, 'action id 必须唯一。');
  }
  try {
    replayActions(take.initial, take.actions);
  } catch (error) {
    fail(`${path}.actions`, error instanceof Error ? error.message : '包含非法动作。');
  }
  return take;
}

const LEGACY_REFERENCE_2D_STYLE: Reference2DStyleSpec = {
  profile: 'block-garden-reference-v1',
  tileMaterial: 'soft-bevel',
  tileFaceSet: 'botanical-reference',
  previewFx: 'full-line-tint',
  clearFx: 'sweep-score-spark',
  feedbackFx: 'praise-combo',
  ambientFx: 'garden-petals',
  bestScore: 22634,
};

function parseReference2DStyle(value: unknown, path: string): Reference2DStyleSpec {
  if (value === undefined) return { ...LEGACY_REFERENCE_2D_STYLE };
  const source = record(value, path);
  rejectUnknownKeys(
    source,
    new Set([
      'profile',
      'tileMaterial',
      'tileFaceSet',
      'tileSkin',
      'previewFx',
      'clearFx',
      'feedbackFx',
      'ambientFx',
      'backgroundColor',
      'bestScore',
    ]),
    path,
  );
  return {
    profile:
      source.profile === 'block-garden-reference-v1'
        ? 'block-garden-reference-v1'
        : fail(`${path}.profile`, '仅支持 block-garden-reference-v1。'),
    tileMaterial:
      source.tileMaterial === undefined
        ? 'soft-bevel'
        : enumeration(source.tileMaterial, REFERENCE_TILE_MATERIALS, `${path}.tileMaterial`),
    tileFaceSet:
      source.tileFaceSet === undefined
        ? source.tileSkin === 'solid-color'
          ? 'none'
          : 'botanical-reference'
        : enumeration(source.tileFaceSet, REFERENCE_TILE_FACE_SETS, `${path}.tileFaceSet`),
    previewFx: enumeration(source.previewFx, REFERENCE_PREVIEW_FX, `${path}.previewFx`),
    clearFx: enumeration(source.clearFx, REFERENCE_CLEAR_FX, `${path}.clearFx`),
    feedbackFx: enumeration(source.feedbackFx, REFERENCE_FEEDBACK_FX, `${path}.feedbackFx`),
    ambientFx: enumeration(source.ambientFx, REFERENCE_AMBIENT_FX, `${path}.ambientFx`),
    ...(source.backgroundColor === undefined
      ? {}
      : {
          backgroundColor:
            typeof source.backgroundColor === 'string' &&
            /^#[0-9a-f]{6}$/iu.test(source.backgroundColor)
              ? source.backgroundColor
              : fail(`${path}.backgroundColor`, '必须是 #RRGGBB。'),
        }),
    bestScore: integer(source.bestScore, `${path}.bestScore`, 0, 2_147_483_647),
  };
}

function parseStyle(value: unknown, path: string): StyleSpec {
  const source = record(value, path);
  rejectUnknownKeys(
    source,
    new Set([
      'renderer',
      'reference2d',
      'material',
      'lighting',
      'camera',
      'fx',
      'geometry',
      'background',
      'showPointer',
    ]),
    path,
  );
  const geometry = record(source.geometry, `${path}.geometry`);
  rejectUnknownKeys(geometry, new Set(['id', 'depth', 'bevel', 'gap']), `${path}.geometry`);
  const background = string(source.background, `${path}.background`, 32);
  if (!/^#[0-9a-f]{6}$/iu.test(background)) fail(`${path}.background`, '必须是 #RRGGBB。');
  return {
    // Bundles exported before the reference-first rebuild had no renderer field.
    // Preserve their appearance by treating them as the original experimental 3D backend.
    renderer:
      source.renderer === undefined
        ? 'three-3d'
        : enumeration(source.renderer, RENDERERS, `${path}.renderer`),
    reference2d: parseReference2DStyle(source.reference2d, `${path}.reference2d`),
    material: enumeration(source.material, MATERIALS, `${path}.material`),
    lighting: enumeration(source.lighting, LIGHTS, `${path}.lighting`),
    camera: enumeration(source.camera, CAMERAS, `${path}.camera`),
    fx: enumeration(source.fx, EFFECTS, `${path}.fx`),
    geometry: {
      id: enumeration(geometry.id, GEOMETRIES, `${path}.geometry.id`),
      depth: finite(geometry.depth, `${path}.geometry.depth`, 0.05, 2),
      bevel: finite(geometry.bevel, `${path}.geometry.bevel`, 0, 0.5),
      gap: finite(geometry.gap, `${path}.geometry.gap`, 0, 0.5),
    },
    background,
    showPointer:
      typeof source.showPointer === 'boolean'
        ? source.showPointer
        : fail(`${path}.showPointer`, '必须是布尔值。'),
  };
}

function parseRhythm(value: unknown, path: string): RhythmProfile {
  const source = record(value, path);
  rejectUnknownKeys(
    source,
    new Set([
      'id',
      'label',
      'description',
      'globalSpeed',
      'dragFrames',
      'pickupDelayFrames',
      'placementSettleFrames',
      'betweenActionFrames',
      'clearDelayFrames',
      'clearDurationFrames',
      'cameraRecoveryFrames',
      'easing',
    ]),
    path,
  );
  const easing =
    source.easing === 'easeOutCubic' ||
    source.easing === 'easeInOutCubic' ||
    source.easing === 'easeOutBack'
      ? source.easing
      : fail(`${path}.easing`, '无效。');
  return {
    id: enumeration(source.id, RHYTHMS, `${path}.id`),
    label: string(source.label, `${path}.label`, 80),
    description: string(source.description, `${path}.description`, 320),
    globalSpeed: finite(source.globalSpeed, `${path}.globalSpeed`, 0.1, 8),
    dragFrames: integer(source.dragFrames, `${path}.dragFrames`, 1, 1_000),
    pickupDelayFrames: integer(source.pickupDelayFrames, `${path}.pickupDelayFrames`, 0, 1_000),
    placementSettleFrames: integer(
      source.placementSettleFrames,
      `${path}.placementSettleFrames`,
      0,
      1_000,
    ),
    betweenActionFrames: integer(
      source.betweenActionFrames,
      `${path}.betweenActionFrames`,
      0,
      1_000,
    ),
    clearDelayFrames: integer(source.clearDelayFrames, `${path}.clearDelayFrames`, 0, 1_000),
    clearDurationFrames: integer(
      source.clearDurationFrames,
      `${path}.clearDurationFrames`,
      1,
      1_000,
    ),
    cameraRecoveryFrames: integer(
      source.cameraRecoveryFrames,
      `${path}.cameraRecoveryFrames`,
      0,
      1_000,
    ),
    easing,
  };
}

function parseTestAudio(value: unknown, path: string): StudioTestAudio {
  if (!isStudioTestAudio(value)) {
    const keys =
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.keys(value as object).join(', ')
        : '无效结构';
    fail(path, `不是公开包测试音效。看到的字段：${keys}。${FIELD_NOTES.audio}已拒绝导入。`);
  }
  if (value.sfxGain < 0 || value.sfxGain > 1) fail(`${path}.sfxGain`, '必须在 0 到 1 之间。');
  return {
    enabled: value.enabled,
    sfxGain: value.sfxGain,
    ...(typeof value.bgmGain === 'number' ? { bgmGain: value.bgmGain } : {}),
    ...(typeof value.bgmStartSeconds === 'number'
      ? { bgmStartSeconds: value.bgmStartSeconds }
      : {}),
    ...(typeof value.bgmSourceOffsetSeconds === 'number'
      ? { bgmSourceOffsetSeconds: value.bgmSourceOffsetSeconds }
      : {}),
    ...(typeof value.bgmLoop === 'boolean' ? { bgmLoop: value.bgmLoop } : {}),
    ...(value.bgmPattern ? { bgmPattern: value.bgmPattern } : {}),
    ...(value.cueOverrides ? { cueOverrides: structuredClone(value.cueOverrides) } : {}),
  };
}

function parseProject(value: unknown, path: string): ProjectSpec {
  const source = record(value, path);
  rejectUnknownKeys(
    source,
    new Set([
      'schemaVersion',
      'id',
      'name',
      'ruleProfile',
      'seed',
      'setupBoard',
      'setupPieces',
      'style',
      'rhythm',
      'render',
      'audio',
      'clearAxes',
      'clearTrigger',
      'referenceClearRules',
      'fixedPieceSupply',
      'seedSupplyVersion',
    ]),
    path,
  );
  const render = record(source.render, `${path}.render`);
  rejectUnknownKeys(render, new Set(['width', 'height', 'fps', 'quality']), `${path}.render`);
  const quality =
    render.quality === 'preview' || render.quality === 'standard' || render.quality === 'cinematic'
      ? render.quality
      : fail(`${path}.render.quality`, '无效。');
  const project: ProjectSpec = {
    schemaVersion:
      source.schemaVersion === '1.0.0' ? '1.0.0' : fail(`${path}.schemaVersion`, '仅支持 1.0.0。'),
    id: string(source.id, `${path}.id`, 180),
    name: string(source.name, `${path}.name`, 240),
    ruleProfile:
      source.ruleProfile === 'block-placement-classic-v1'
        ? 'block-placement-classic-v1'
        : fail(`${path}.ruleProfile`, '无效。'),
    seed: integer(source.seed, `${path}.seed`, 0, 2_147_483_647),
    setupBoard: parseBoard(source.setupBoard, `${path}.setupBoard`),
    setupPieces: parsePieces(source.setupPieces, `${path}.setupPieces`),
    style: parseStyle(source.style, `${path}.style`),
    rhythm: parseRhythm(source.rhythm, `${path}.rhythm`),
    render: {
      width: integer(render.width, `${path}.render.width`, 256, 4096),
      height: integer(render.height, `${path}.render.height`, 256, 4096),
      fps: integer(render.fps, `${path}.render.fps`, 1, 120),
      quality,
    },
    ...(source.audio === undefined ? {} : { audio: parseTestAudio(source.audio, `${path}.audio`) }),
    ...parseRuleFields(source, path),
    ...(source.seedSupplyVersion === undefined
      ? {}
      : {
          seedSupplyVersion:
            source.seedSupplyVersion === 'reference-worktree-0f237a8f'
              ? source.seedSupplyVersion
              : fail(`${path}.seedSupplyVersion`, '未知种子供给版本。'),
        }),
    ...(source.fixedPieceSupply === undefined
      ? {}
      : { fixedPieceSupply: parseSupply(source.fixedPieceSupply, `${path}.fixedPieceSupply`) }),
  };
  if (project.render.width % 2 !== 0 || project.render.height % 2 !== 0) {
    fail(`${path}.render`, 'H.264 输出宽高必须是偶数。');
  }
  if (project.setupPieces.some((piece) => piece.used)) {
    fail(`${path}.setupPieces`, '初始候选块不能标记为已使用。');
  }
  if (project.setupPieces.some((piece) => piece.setIndex !== 0)) {
    fail(`${path}.setupPieces`, '一期项目的初始候选块 setIndex 必须为 0。');
  }
  if (
    project.fixedPieceSupply &&
    piecesFingerprint(project.setupPieces) !== piecesFingerprint(project.fixedPieceSupply[0]!)
  ) {
    fail(`${path}.fixedPieceSupply[0]`, '第一轮固定供给必须与初始候选完全一致。');
  }
  return project;
}

export function parseStudioBundle(value: unknown): StudioBundle {
  const source = record(value, 'root');
  if (source.format !== 'block-creative-studio-project' || source.version !== '1.0.0') {
    fail('root', identifyCreativeDocument(source).detail);
  }
  rejectUnknownKeys(source, new Set(['format', 'version', 'project', 'takes']), 'root');
  if (!Array.isArray(source.takes) || source.takes.length > 500) fail('root.takes', '数量无效。');
  const project = parseProject(source.project, 'root.project');
  const takes = source.takes.map((take, index) => parseTake(take, `root.takes[${index}]`));
  if (new Set(takes.map((take) => take.id)).size !== takes.length) {
    fail('root.takes', 'take id 必须唯一。');
  }
  const expectedInitial = createProjectGame(project);
  const expectedInitialKey = snapshotFingerprint(expectedInitial);
  for (const [index, take] of takes.entries()) {
    if (snapshotFingerprint(take.initial) !== expectedInitialKey) {
      fail(
        `root.takes[${index}].initial`,
        '必须与项目的初始牌面、候选块、Seed、得分和状态完全一致。',
      );
    }
  }
  return {
    format: 'block-creative-studio-project',
    version: '1.0.0',
    project,
    takes,
  };
}
