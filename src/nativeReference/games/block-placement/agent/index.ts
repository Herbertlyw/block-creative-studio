import { MATERIAL_THEME_IDS, MATERIAL_THEMES, materialTheme } from '../render/materialThemes';
import { RHYTHM_PRESETS, RHYTHM_PRESET_LIST } from '../../../director/rhythmPresets';
import { parsePraiseWords, PRAISE_WORD_MAP_SCHEMA } from '../../../domain/praiseWords';
import type {
  GameSnapshot,
  PieceInstance,
  PlacementAction,
  RhythmPresetId,
  RhythmProfile,
  StyleSpec,
  Take,
  TileColor,
} from '../../../domain/types';
import type {
  AgentOperationInput,
  AgentOperationResult,
  GameAgentAdapter,
  GameAgentOperation,
} from '../../../game-runtime/agentOperations';
import { AGENT_RESULT_SCHEMA } from '../../../game-runtime/agentOperations';
import {
  agentGoalSearchSchema,
  assessPressureStages,
  deterministicSeedSeries,
  parseAgentSearchBudget,
  parsePressureStageTargets,
  summarizePressureTrace,
  trajectorySignature,
  type AgentPressurePoint,
} from '../../../game-runtime/agentGoalSearch';
import { GameRegistry } from '../../../game-runtime/gameRegistry';
import { validateStudioProjectDocumentV2 } from '../../../game-runtime/projectDocument';
import {
  GAME_PROJECT_CONTRACT,
  GAME_PROJECT_CONTRACT_VERSION,
  STUDIO_PROJECT_V2_FORMAT,
  STUDIO_PROJECT_V2_VERSION,
  type StudioProjectDocumentV2,
} from '../../../game-runtime/projectEnvelope';
import { stableHash } from '../../../headless/stableHash';
import { classicBlastStyle, DEFAULT_STYLE } from '../../../renderer/stylePresets';
import { blockPlacementDefinition } from '../definition';
import {
  BLOCK_PLACEMENT_DEFAULT_PRODUCTION,
  migrateBlockPlacementTakeV1,
  takeFromBlockPlacementReplay,
} from '../migrations/blockPlacementV1';
import {
  BLOCK_PLACEMENT_CONFIG_SCHEMA_ID,
  BLOCK_PLACEMENT_GAME_ID,
  BLOCK_PLACEMENT_MODULE_VERSION,
  BLOCK_PLACEMENT_RULESET_ID,
  BLOCK_PLACEMENT_RULESET_VERSION,
  BLOCK_PLACEMENT_STATE_SCHEMA_ID,
} from '../manifest';
import { compileBlockPlacementFrameSource } from '../presentation/legacyPresentationAdapter';
import { createEmptyBoard, BOARD_PRESETS } from '../runtime/boardPresets';
import {
  applyPlacement,
  boardFingerprint,
  cloneSnapshot,
  createGame,
  createPieceSet,
  listLegalMoves,
  replayActions,
} from '../runtime/gameEngine';
import { getShape, getShapeBounds, TILE_COLORS } from '../runtime/shapes';
import { boardPieceCenterNormalized } from '../profiles/layout';
import { buildAgentPointerPath } from '../presentation/pointerPath';
import {
  parseBlockPlacementAction,
  parseBlockPlacementConfig,
  parseBlockPlacementState,
} from '../schemas';
import { compileTake } from '../presentation/presentationCompiler';
import { readAgentAssetExtension } from '../../../agent-assets';
import { blockPlacementAgentAssetDeclaration } from './assetBindings';
import { planAdaptiveQualityRoute, planQualityRoute, qualityRouteStats } from './qualityRoutePlanner';
import { parseReferenceCalibration } from '../presentation/referenceCalibration';
import { parseReferenceEffects, REFERENCE_EFFECTS_SCHEMA } from '../presentation/referenceEffects';
import { productionFromDocument, withProduction, parseProductionDirection } from '../../../agent-director/contracts';

const games = new GameRegistry();
games.register(blockPlacementDefinition);

type JsonRecord = Record<string, unknown>;

const LOOK_CATALOG: Record<string, { title: string; lookPackRef: StudioProjectDocumentV2['production']['lookPackRef']; style: StyleSpec }> = {
  'classic-blast': {
    title: 'Classic Block Blast 2D',
    lookPackRef: { id: 'block-placement.look.classic-blast', version: '1.0.0', kind: 'look-pack', contentHash: 'builtin:classic-blast-v1' },
    style: classicBlastStyle(),
  },
  'reference-garden': {
    title: 'Reference garden 2D',
    lookPackRef: { id: 'block-placement.look.reference-garden', version: '1.0.0', kind: 'look-pack', contentHash: 'builtin:reference-garden-v1' },
    style: { ...structuredClone(DEFAULT_STYLE), showPointer: false },
  },
  'candy-cinematic': {
    title: 'Candy cinematic 3D',
    lookPackRef: { id: 'block-placement.look.candy-cinematic', version: '1.0.0', kind: 'look-pack', contentHash: 'builtin:candy-cinematic-v1' },
    style: {
      ...structuredClone(DEFAULT_STYLE),
      renderer: 'fixed-camera-cinematic',
      material: 'candy-resin',
      lighting: 'soft-candy',
      camera: 'premium-perspective',
      fx: 'crystal-shatter',
      background: '#07142d',
      showPointer: false,
      lookDev: { ...structuredClone(DEFAULT_STYLE.lookDev), id: 'balanced-cinematic', exposure: 1, environmentIntensity: 0.9, bloomStrength: 0.1, bloomThreshold: 0.88, bloomRadius: 0.42, clearBloomBoost: 0.28 },
    },
  },
  'crystal-energy': {
    title: 'Crystal energy 3D',
    lookPackRef: { id: 'block-placement.look.crystal-energy', version: '1.0.0', kind: 'look-pack', contentHash: 'builtin:crystal-energy-v1' },
    style: {
      ...structuredClone(DEFAULT_STYLE),
      renderer: 'fixed-camera-cinematic',
      material: 'crystal-glass',
      lighting: 'neon-contrast',
      camera: 'dynamic-clear',
      fx: 'energy-burst',
      background: '#030817',
      showPointer: false,
      lookDev: { ...structuredClone(DEFAULT_STYLE.lookDev), id: 'high-energy', exposure: 1.08, environmentIntensity: 1.15, bloomStrength: 0.18, bloomThreshold: 0.75, bloomRadius: 0.58, clearBloomBoost: 0.5 },
    },
  },
};

function object(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as JsonRecord;
}

function optionalObject(value: unknown, path: string): JsonRecord {
  return value === undefined ? {} : object(value, path);
}

function controls(input: AgentOperationInput, required = false): JsonRecord {
  const recipe = required ? object(input.recipe ?? input.options, input.recipe === undefined ? '$.options' : '$.recipe') : optionalObject(input.recipe, '$.recipe');
  const options = optionalObject(input.options, '$.options');
  for (const key of Object.keys(recipe)) {
    if (key in options && stableHash(recipe[key]) !== stableHash(options[key])) throw new Error(`Control ${key} has conflicting values in recipe and options.`);
  }
  return { ...recipe, ...options };
}

function string(value: unknown, path: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || value.length === 0 || value.length > 240) {
    throw new Error(`${path} must be a non-empty string of at most 240 characters.`);
  }
  return value;
}

function integer(value: unknown, path: string, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${path} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function finite(value: unknown, path: string, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${path} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function bool(value: unknown, path: string, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
  return value;
}

function lookIdFrom(document: StudioProjectDocumentV2): string | null {
  const packId = document.production.lookPackRef?.id;
  const found = Object.entries(LOOK_CATALOG).find(([, look]) => look.lookPackRef.id === packId);
  return found?.[0] ?? null;
}

function cloneDocument(document: StudioProjectDocumentV2): StudioProjectDocumentV2 {
  return structuredClone(document);
}

function errorResult(error: unknown): AgentOperationResult {
  const source = error as { code?: unknown; message?: unknown };
  return {
    ok: false,
    report: {
      error: {
        code: typeof source?.code === 'string' ? source.code : 'BLOCK_PLACEMENT_AGENT_INVALID_INPUT',
        message: typeof source?.message === 'string' ? source.message : String(error),
      },
    },
  };
}

function safe(execute: (input: AgentOperationInput) => AgentOperationResult): (input: AgentOperationInput) => AgentOperationResult {
  return (input) => {
    try {
      return execute(input);
    } catch (error) {
      return errorResult(error);
    }
  };
}

function validateDocument(value: unknown): StudioProjectDocumentV2 {
  const validated = validateStudioProjectDocumentV2(value, games);
  if (validated.game.game.id !== BLOCK_PLACEMENT_GAME_ID) {
    throw new Error(`Project game must be ${BLOCK_PLACEMENT_GAME_ID}.`);
  }
  const { parsed: _parsed, ...document } = validated;
  return document;
}

function rhythmFrom(document: StudioProjectDocumentV2): RhythmProfile {
  const source = object(document.direction?.rhythm, '$.project.direction.rhythm');
  const id = string(source.id, '$.project.direction.rhythm.id');
  const easing = source.easing;
  if (easing !== 'easeOutCubic' && easing !== 'easeInOutCubic' && easing !== 'easeOutBack') {
    throw new Error('$.project.direction.rhythm.easing is invalid.');
  }
  return {
    id: id as RhythmProfile['id'],
    label: string(source.label, '$.project.direction.rhythm.label'),
    description: string(source.description, '$.project.direction.rhythm.description'),
    globalSpeed: finite(source.globalSpeed, '$.project.direction.rhythm.globalSpeed', 1, 0.25, 4),
    dragFrames: integer(source.dragFrames, '$.project.direction.rhythm.dragFrames', 22, 1, 10_000),
    pickupDelayFrames: integer(source.pickupDelayFrames, '$.project.direction.rhythm.pickupDelayFrames', 3, 0, 10_000),
    placementSettleFrames: integer(source.placementSettleFrames, '$.project.direction.rhythm.placementSettleFrames', 7, 0, 10_000),
    betweenActionFrames: integer(source.betweenActionFrames, '$.project.direction.rhythm.betweenActionFrames', 14, 0, 10_000),
    clearDelayFrames: integer(source.clearDelayFrames, '$.project.direction.rhythm.clearDelayFrames', 4, 0, 10_000),
    clearDurationFrames: integer(source.clearDurationFrames, '$.project.direction.rhythm.clearDurationFrames', 18, 1, 10_000),
    cameraRecoveryFrames: integer(source.cameraRecoveryFrames, '$.project.direction.rhythm.cameraRecoveryFrames', 13, 0, 10_000),
    easing,
  };
}

function initialFrom(document: StudioProjectDocumentV2): GameSnapshot {
  return parseBlockPlacementState(document.game.initialState.data, '$.project.game.initialState.data');
}

function takeById(document: StudioProjectDocumentV2, recipe: JsonRecord): Take {
  const requested = recipe.takeId;
  const replay = requested === undefined
    ? document.takes[0]
    : document.takes.find((candidate) => candidate.takeId === requested);
  if (!replay) throw new Error(requested === undefined ? 'Project has no Take.' : `Unknown Take ${String(requested)}.`);
  return takeFromBlockPlacementReplay(document.game, replay);
}

function authoredPointer(actionIndex: number, piece: PieceInstance, anchor: { row: number; col: number }, durationFrames: number) {
  return buildAgentPointerPath({
    actionIndex,
    slotIndex: piece.slotIndex,
    landing: boardPieceCenterNormalized(anchor, getShapeBounds(getShape(piece.shapeId))),
    durationFrames,
  });
}

function authoredFixedSupply(value: unknown, seed: number, path: string): PieceInstance[][] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    throw new Error(`${path} must contain 1–500 rounds.`);
  }
  return value.map((rawBatch, setIndex) => {
    if (!Array.isArray(rawBatch) || rawBatch.length !== 3) throw new Error(`${path}[${setIndex}] must contain exactly three pieces.`);
    const specs = rawBatch.map((raw, slotIndex) => {
      if (typeof raw === 'string') return { shapeId: raw } as JsonRecord;
      return object(raw, `${path}[${setIndex}][${slotIndex}]`);
    });
    const shapeIds = specs.map((spec, slotIndex) => {
      const shapeId = string(spec.shapeId, `${path}[${setIndex}][${slotIndex}].shapeId`);
      getShape(shapeId);
      return shapeId;
    });
    return createPieceSet(seed, setIndex, shapeIds).map((piece, slotIndex) => {
      const spec = specs[slotIndex]!;
      const color = spec.color === undefined ? piece.color : spec.color;
      return {
        ...piece,
        color,
        ...(spec.cellColors === undefined ? {} : { cellColors: spec.cellColors }),
      } as PieceInstance;
    });
  });
}

type StoryMode = 'calm' | 'rising' | 'rescue';

function generateActions(initial: GameSnapshot, maximumActions: number, story: StoryMode, variant = 0): PlacementAction[] {
  const actions: PlacementAction[] = [];
  let cursor = cloneSnapshot(initial);
  for (let index = 0; index < maximumActions && cursor.status === 'playing'; index += 1) {
    const legal = listLegalMoves(cursor);
    const occupiedCells = cursor.board.cells.flat().filter(Boolean).length;
    const pressurePhase = story === 'rising' || (story === 'rescue' && index < maximumActions * 0.35 && occupiedCells < 30);
    const ranked = pressurePhase
      ? legal.slice(0, Math.min(8, legal.length)).sort((left, right) => {
          const clearDifference = left.immediateLines - right.immediateLines;
          return clearDifference === 0 ? left.heuristic - right.heuristic : clearDifference;
        })
      : legal;
    const move = ranked.length ? ranked[variant % Math.min(4, ranked.length)] : undefined;
    if (!move) break;
    const piece = cursor.pieces.find((candidate) => candidate.id === move.pieceId);
    if (!piece) break;
    const durationFrames = 16;
    const action: PlacementAction = {
      id: `authored-placement-${String(index + 1).padStart(3, '0')}`,
      actor: 'agent',
      pieceId: move.pieceId,
      anchor: { ...move.anchor },
      durationFrames,
      pointerPath: authoredPointer(index, piece, move.anchor, durationFrames),
    };
    const transition = applyPlacement(cursor, action);
    if (!transition) break;
    actions.push(action);
    cursor = transition.after;
  }
  return actions;
}

function qualityCascadeSupply(rounds: number): Array<Array<{ shapeId: string }>> {
  return Array.from({ length: rounds }, (_, index) => index === 0
    ? ['tri-v', 'tri-v', 'single'].map(shapeId => ({ shapeId }))
    : ['line4-h', 'line4-h', 'line4-h'].map(shapeId => ({ shapeId })));
}

function qualityCascadeDocument(source: StudioProjectDocumentV2, seed: number, rounds: number, supplyMode: 'fixed' | 'seeded'): StudioProjectDocumentV2 {
  const board = BOARD_PRESETS.find(candidate => candidate.id === 'triple-cascade')!.create();
  const fixedPieceSupply = authoredFixedSupply(qualityCascadeSupply(rounds), seed, '$.recipe.fixedSupply');
  const parsed = parseBlockPlacementConfig({ board, pieces: fixedPieceSupply[0], ...(supplyMode === 'fixed' ? { fixedPieceSupply } : {}) }, '$.recipe');
  const initial = createGame(parsed.board, seed, parsed.pieces, parsed.fixedPieceSupply,parsed.clearAxes,parsed.clearTrigger,parsed.referenceClearRules);
  if (initial.status !== 'playing') throw new Error('Quality cascade initializer has no legal placement.');
  const document = cloneDocument(source);
  document.game.config.data = { board: parsed.board, pieces: parsed.pieces, ...(parsed.clearAxes?{clearAxes:parsed.clearAxes}:{}), ...(parsed.clearTrigger?{clearTrigger:parsed.clearTrigger}:{}), ...(parsed.referenceClearRules?{referenceClearRules:parsed.referenceClearRules}:{}), ...(parsed.fixedPieceSupply ? { fixedPieceSupply: parsed.fixedPieceSupply } : {}) };
  document.game.initialState.data = initial;
  document.game.initialState.stateHash = blockPlacementDefinition.runtime.hashState(initial);
  document.takes = [];
  validateDocument(document);
  return document;
}

function qualityRoute(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project);
  const recipe = controls(input);
  const targetDurationSeconds = finite(recipe.targetDurationSeconds, '$.recipe.targetDurationSeconds', 30, 4, 600);
  const seed = integer(recipe.seed, '$.recipe.seed', initialFrom(source).seed, 0, 0x7fffffff);
  const initializer = string(recipe.initializer, '$.recipe.initializer', 'adaptive');
  if (initializer !== 'adaptive' && initializer !== 'cascade' && initializer !== 'existing') throw new Error('$.recipe.initializer must be adaptive, cascade, or existing.');
  const rounds = integer(recipe.supplyRounds, '$.recipe.supplyRounds', 48, 4, 160);
  const supplyMode = string(recipe.supplyMode, '$.recipe.supplyMode', initializer === 'adaptive' ? 'adaptive' : 'fixed');
  if (supplyMode !== 'adaptive' && supplyMode !== 'fixed' && supplyMode !== 'seeded') throw new Error('$.recipe.supplyMode must be adaptive, fixed, or seeded.');
  if (initializer === 'adaptive' && supplyMode !== 'adaptive') throw new Error('$.recipe.supplyMode must be adaptive when initializer is adaptive.');
  if (initializer !== 'adaptive' && supplyMode === 'adaptive') throw new Error('$.recipe.supplyMode adaptive requires initializer adaptive.');
  const minActions = integer(recipe.minActions, '$.recipe.minActions', Math.max(20, Math.ceil(targetDurationSeconds * 1.1)), 1, 500);
  const goals = {
    minActions,
    minClearEvents: integer(recipe.minClearEvents, '$.recipe.minClearEvents', Math.max(5, Math.ceil(minActions * 0.55)), 1, 500),
    minClearRatio: finite(recipe.minClearRatio, '$.recipe.minClearRatio', 0.55, 0, 1),
    minTripleLineEvents: integer(recipe.minTripleLineEvents, '$.recipe.minTripleLineEvents', Math.max(2, Math.ceil(targetDurationSeconds / 7.5)), 0, 100),
    minTripleLineSegments: integer(recipe.minTripleLineSegments, '$.recipe.minTripleLineSegments', targetDurationSeconds >= 18 ? 2 : 1, 1, 3),
    minConsecutiveClearStreak: integer(recipe.minConsecutiveClearStreak, '$.recipe.minConsecutiveClearStreak', 3, 1, 100),
    maxNoClearSteps: integer(recipe.maxNoClearSteps, '$.recipe.maxNoClearSteps', 1, 0, 100),
    minIntermediateBoardCells: integer(recipe.minIntermediateBoardCells, '$.recipe.minIntermediateBoardCells', 14, 0, 64),
    initializerCandidates: integer(recipe.initializerCandidates, '$.recipe.initializerCandidates', 12, 1, 32),
    beamWidth: integer(recipe.beamWidth, '$.recipe.beamWidth', 160, 1, 256),
    branchWidth: integer(recipe.branchWidth, '$.recipe.branchWidth', 24, 1, 96),
  };
  let document = initializer === 'cascade' ? qualityCascadeDocument(source, seed, rounds, supplyMode as 'fixed' | 'seeded') : cloneDocument(source);
  let initial = initialFrom(document);
  const durationFrames = integer(recipe.actionDurationFrames, '$.recipe.actionDurationFrames', 16, 1, 10_000);
  const makeAction = (actionIndex: number, snapshot: GameSnapshot, move: { pieceId: string; anchor: { row: number; col: number } }): PlacementAction => {
    const piece = snapshot.pieces.find(candidate => candidate.id === move.pieceId);
    if (!piece) throw new Error(`Planner selected unknown piece ${move.pieceId}.`);
    return {
      id: `quality-placement-${String(actionIndex + 1).padStart(3, '0')}`,
      actor: 'agent',
      pieceId: move.pieceId,
      anchor: { ...move.anchor },
      durationFrames,
      pointerPath: authoredPointer(actionIndex, piece, move.anchor, durationFrames),
    };
  };
  const planned = initializer === 'adaptive'
    ? planAdaptiveQualityRoute(seed, goals, makeAction)
    : planQualityRoute(initial, goals, makeAction);
  if (!planned.goalReached || (initializer === 'adaptive' && !planned.initial)) {
    return {
      ok: false,
      report: {
        operation: 'quality route',
        goalReached: false,
        reason: planned.reason,
        initializer,
        initializerCandidate: planned.initializerCandidate ?? null,
        supplyRounds: rounds,
        supplyMode,
        goals,
        stats: planned.stats,
        expandedStates: planned.expandedStates,
        routeEvidence: 'No project was emitted because native replay did not satisfy every requested route goal.',
      },
    };
  }
  if (initializer === 'adaptive' && planned.initial) {
    initial = planned.initial;
    document.game.config.data = {
      board: initial.board,
      ...(initial.clearAxes?{clearAxes:initial.clearAxes}:{}), ...(initial.clearTrigger?{clearTrigger:initial.clearTrigger}:{}), ...(initial.referenceClearRules?{referenceClearRules:initial.referenceClearRules}:{}),
      pieces: initial.fixedPieceSupply?.[0] ?? initial.pieces,
      ...(initial.fixedPieceSupply ? { fixedPieceSupply: initial.fixedPieceSupply } : {}),
    };
    document.game.initialState.data = initial;
    document.game.initialState.stateHash = blockPlacementDefinition.runtime.hashState(initial);
    document.takes = [];
  }
  const takeId = string(recipe.takeId, '$.recipe.takeId', `quality-route-${seed}`);
  if (document.takes.some(take => take.takeId === takeId)) throw new Error(`Take ${takeId} already exists.`);
  const take: Take = { id: takeId, name: takeId, createdAt: '1970-01-01T00:00:00.000Z', initial, actions: planned.actions };
  document.takes.push(migrateBlockPlacementTakeV1(take, document.game.initialState.stateHash));
  validateDocument(document);
  const retimed = retimeDirector({ project: document, recipe: { takeId, targetDurationSeconds } });
  if (retimed.document) document = retimed.document;
  const compiled = compileTake(take, rhythmFrom(document), document.production.output.fps);
  const stats = qualityRouteStats(initial, planned.actions);
  return {
    ok: planned.goalReached,
    document,
    report: {
      operation: 'quality route',
      goalReached: planned.goalReached,
      reason: planned.reason,
      initializer,
      initializerCandidate: planned.initializerCandidate ?? null,
      supplyRounds: rounds,
      supplyMode,
      takeId,
      goals,
      stats,
      expandedStates: planned.expandedStates,
      actualActiveSeconds: compiled.actions.length ? (compiled.actions.at(-1)?.startFrame ?? 0) / document.production.output.fps : 0,
      routeEvidence: 'All actions are generated by native legal-move replay; multi-line counts rows plus columns cleared in one placement.',
      preserves: initializer === 'existing' ? ['game.initialState', 'production', 'direction', 'existingTakes'] : ['production', 'direction'],
      invalidates: ['compiledPlans', 'survivalEvidence', 'renderArtifacts'],
    },
  };
}

function createProject(input: AgentOperationInput): AgentOperationResult {
  const recipe = controls(input);
  const seed = integer(recipe.seed, '$.recipe.seed', 41782, 0, 2_147_483_647);
  const includeSquare3 = bool(recipe.includeSquare3, '$.recipe.includeSquare3', false);
  const presetId = string(recipe.boardPreset, '$.recipe.boardPreset', 'empty');
  const preset = BOARD_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset && recipe.board === undefined) throw new Error(`Unknown board preset ${presetId}.`);
  const fixedPieceSupply = recipe.fixedSupply === undefined
    ? undefined
    : authoredFixedSupply(recipe.fixedSupply, seed, '$.recipe.fixedSupply');
  const parsed = parseBlockPlacementConfig({
    board: recipe.board ?? preset?.create() ?? createEmptyBoard(),
    clearAxes:recipe.clearAxes,
    clearTrigger:recipe.clearTrigger,
    referenceClearRules:recipe.referenceClearRules,
    pieces: fixedPieceSupply?.[0] ?? recipe.pieces ?? createPieceSet(seed, 0, ['single', 'tri-h', includeSquare3 ? 'square-3' : 'square-2']),
    ...(fixedPieceSupply ? { fixedPieceSupply } : {}),
  }, '$.recipe');
  const initial = createGame(parsed.board, seed, parsed.pieces, parsed.fixedPieceSupply,parsed.clearAxes,parsed.clearTrigger,parsed.referenceClearRules);
  if (recipe.initialUsedSlots !== undefined) {
    const slots = recipe.initialUsedSlots;
    if (!Array.isArray(slots) || slots.length > 2 || new Set(slots).size !== slots.length || slots.some(slot => !Number.isInteger(slot) || slot < 0 || slot > 2)) throw new Error('INITIAL_USED_SLOTS_INVALID');
    for (const piece of initial.pieces) piece.used = slots.includes(piece.slotIndex);
    initial.status = listLegalMoves(initial).length ? 'playing' : 'game-over';
  }
  if (initial.status !== 'playing') throw new Error('Authored initial board has no legal placement.');
  const projectId = string(recipe.projectId, '$.recipe.projectId', `block-placement-${seed}`);
  const document: StudioProjectDocumentV2 = {
    format: STUDIO_PROJECT_V2_FORMAT,
    version: STUDIO_PROJECT_V2_VERSION,
    id: projectId,
    name: string(recipe.name, '$.recipe.name', `Block Placement ${seed}`),
    game: {
      contract: GAME_PROJECT_CONTRACT,
      contractVersion: GAME_PROJECT_CONTRACT_VERSION,
      game: {
        id: BLOCK_PLACEMENT_GAME_ID,
        moduleVersion: BLOCK_PLACEMENT_MODULE_VERSION,
        rulesetId: BLOCK_PLACEMENT_RULESET_ID,
        rulesetVersion: BLOCK_PLACEMENT_RULESET_VERSION,
      },
      config: {
        schemaId: BLOCK_PLACEMENT_CONFIG_SCHEMA_ID,
        data: { board: parsed.board, pieces: parsed.pieces, ...(parsed.clearAxes?{clearAxes:parsed.clearAxes}:{}), ...(parsed.clearTrigger?{clearTrigger:parsed.clearTrigger}:{}), ...(parsed.referenceClearRules?{referenceClearRules:parsed.referenceClearRules}:{}), ...(parsed.fixedPieceSupply ? { fixedPieceSupply: parsed.fixedPieceSupply } : {}) },
      },
      initialState: {
        schemaId: BLOCK_PLACEMENT_STATE_SCHEMA_ID,
        data: initial,
        stateHash: blockPlacementDefinition.runtime.hashState(initial),
      },
    },
    production: {
      ...structuredClone(BLOCK_PLACEMENT_DEFAULT_PRODUCTION),
      lookPackRef: structuredClone(LOOK_CATALOG['classic-blast']!.lookPackRef),
      output: {
        width: integer(recipe.width, '$.recipe.width', 1080, 256, 4096),
        height: integer(recipe.height, '$.recipe.height', 1920, 256, 4096),
        fps: integer(recipe.fps, '$.recipe.fps', 30, 1, 120),
        quality: 'standard',
      },
    },
    takes: [],
    direction: {
      rhythm: structuredClone(RHYTHM_PRESETS['human-natural']),
      style: structuredClone(LOOK_CATALOG['classic-blast']!.style),
    },
  };
  const validated = validateDocument(document);
  return {
    ok: true,
    document: validated,
    report: {
      operation: 'project.create',
      seed,
      includeSquare3,
      boardPreset: recipe.board === undefined ? presetId : 'custom',
      boardFingerprint: boardFingerprint(initial.board),
      initialSupply: initial.pieces.map((piece) => ({ slotIndex: piece.slotIndex, shapeId: piece.shapeId, color: piece.color })),
      supplyMode: initial.fixedPieceSupply ? 'fixed' : 'seeded',
      authoredSupplyRounds: initial.fixedPieceSupply?.length ?? null,
      deterministicIdentity: stableHash(validated),
      preserves: [],
      invalidates: [],
    },
  };
}

function inspectProject(input: AgentOperationInput): AgentOperationResult {
  const document = validateDocument(input.project);
  const initial = initialFrom(document);
  return {
    ok: true,
    document,
    report: {
      operation: 'project.inspect',
      project: { id: document.id, name: document.name, gameId: document.game.game.id },
      initial: {
        seed: initial.seed,
        boardFingerprint: boardFingerprint(initial.board),
        occupiedCells: initial.board.cells.flat().filter(Boolean).length,
        supply: initial.pieces.map((piece) => ({ slotIndex: piece.slotIndex, shapeId: piece.shapeId, color: piece.color })),
        supplyMode: initial.fixedPieceSupply ? 'fixed' : 'seeded',
        authoredSupplyRounds: initial.fixedPieceSupply?.length ?? null,
      },
      takes: document.takes.map((take) => ({ takeId: take.takeId, actionCount: take.actions.length })),
      production: structuredClone(document.production),
      lookId: lookIdFrom(document),
      rhythmId: document.direction?.rhythm && typeof document.direction.rhythm === 'object'
        ? (document.direction.rhythm as { id?: unknown }).id ?? null
        : null,
      directionHash: stableHash(document.direction),
      documentHash: stableHash(document),
    },
  };
}

function validateProject(input: AgentOperationInput): AgentOperationResult {
  const document = validateDocument(input.project);
  const initial = initialFrom(document);
  const takes = document.takes.map((replay) => {
    const take = takeFromBlockPlacementReplay(document.game, replay);
    const transitions = replayActions(initial, take.actions);
    const final = transitions.at(-1)?.after ?? initial;
    return {
      takeId: replay.takeId,
      actionCount: take.actions.length,
      finalStatus: final.status,
      supplyMode: initial.fixedPieceSupply ? 'fixed' : 'seeded',
      supplyExhausted: final.supplyExhausted === true,
      finalStateHash: blockPlacementDefinition.runtime.hashState(final),
    };
  });
  return { ok: true, document, report: { operation: 'project.validate', schemaValid: true, rulesValid: true, takes } };
}

function editProject(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project);
  const recipe = controls(input, true);
  if (recipe.board === undefined && recipe.pieces === undefined && recipe.fixedSupply === undefined && recipe.supplyMode === undefined && recipe.cells === undefined && recipe.clearAxes === undefined && recipe.clearTrigger === undefined && recipe.referenceClearRules === undefined) {
    throw new Error('project.edit requires board, pieces, fixedSupply, supplyMode, or cells.');
  }
  const initial = initialFrom(source);
  const supplyMode = recipe.supplyMode;
  if (supplyMode !== undefined && supplyMode !== 'seeded' && supplyMode !== 'fixed') {
    throw new Error('$.recipe.supplyMode must be seeded or fixed.');
  }
  const fixedPieceSupply = recipe.fixedSupply !== undefined
    ? authoredFixedSupply(recipe.fixedSupply, initial.seed, '$.recipe.fixedSupply')
    : supplyMode === 'seeded' || recipe.pieces !== undefined
      ? undefined
      : initial.fixedPieceSupply;
  if (supplyMode === 'fixed' && !fixedPieceSupply) throw new Error('fixed supply mode requires $.recipe.fixedSupply.');
  const baseConfig = parseBlockPlacementConfig({
    board: recipe.board ?? initial.board,
    clearAxes:recipe.clearAxes??initial.clearAxes,
    clearTrigger:recipe.clearTrigger??initial.clearTrigger,
    referenceClearRules:recipe.referenceClearRules??initial.referenceClearRules,
    pieces: fixedPieceSupply?.[0] ?? recipe.pieces ?? initial.pieces,
    ...(fixedPieceSupply ? { fixedPieceSupply } : {}),
  }, '$.recipe');
  const board = structuredClone(baseConfig.board!);
  if (recipe.cells !== undefined) {
    if (!Array.isArray(recipe.cells)) throw new Error('$.recipe.cells must be an array.');
    for (const [index, raw] of recipe.cells.entries()) {
      const patch = object(raw, `$.recipe.cells[${index}]`);
      const row = integer(patch.row, `$.recipe.cells[${index}].row`, -1, 0, 7);
      const col = integer(patch.col, `$.recipe.cells[${index}].col`, -1, 0, 7);
      if (patch.color !== null && (typeof patch.color !== 'string' || !TILE_COLORS.includes(patch.color as TileColor))) {
        throw new Error(`$.recipe.cells[${index}].color is invalid.`);
      }
      board.cells[row]![col] = patch.color as TileColor | null;
    }
  }
  const config = parseBlockPlacementConfig({
    board,
    pieces: baseConfig.pieces,
    clearAxes:baseConfig.clearAxes,
    clearTrigger:baseConfig.clearTrigger,
    referenceClearRules:baseConfig.referenceClearRules,
    ...(baseConfig.fixedPieceSupply ? { fixedPieceSupply: baseConfig.fixedPieceSupply } : {}),
  }, '$.recipe');
  const nextInitial = createGame(config.board, initial.seed, config.pieces, config.fixedPieceSupply,config.clearAxes,config.clearTrigger,config.referenceClearRules);
  if (nextInitial.status !== 'playing') throw new Error('Edited setup has no legal placement.');
  const document = cloneDocument(source);
  document.game.config.data = { board: config.board, pieces: config.pieces, ...(config.clearAxes?{clearAxes:config.clearAxes}:{}), ...(config.clearTrigger?{clearTrigger:config.clearTrigger}:{}), ...(config.referenceClearRules?{referenceClearRules:config.referenceClearRules}:{}), ...(config.fixedPieceSupply ? { fixedPieceSupply: config.fixedPieceSupply } : {}) };
  document.game.initialState.data = nextInitial;
  document.game.initialState.stateHash = blockPlacementDefinition.runtime.hashState(nextInitial);
  const invalidatedTakeIds = document.takes.map((take) => take.takeId);
  document.takes = [];
  validateDocument(document);
  return {
    ok: true,
    document,
    report: {
      operation: 'project.edit',
      changed: ['game.config', 'game.initialState'],
      preserves: ['production', 'direction'],
      invalidated: { takes: invalidatedTakeIds, compiledPlans: true, survivalEvidence: true },
      beforeStateHash: source.game.initialState.stateHash,
      afterStateHash: document.game.initialState.stateHash,
    },
  };
}

function editLayout(input: AgentOperationInput): AgentOperationResult {
  const recipe = controls(input, true);
  if (recipe.pieces !== undefined) throw new Error('layout.edit does not accept pieces; use supply.edit.');
  if (recipe.board === undefined && recipe.cells === undefined) throw new Error('layout.edit requires board or cells.');
  return editProject(input);
}

function editSupply(input: AgentOperationInput): AgentOperationResult {
  const recipe = controls(input, true);
  if (recipe.board !== undefined || recipe.cells !== undefined) throw new Error('supply.edit changes pieces only; use layout.edit for the board.');
  if (recipe.pieces === undefined && recipe.fixedSupply === undefined && recipe.supplyMode !== 'seeded') {
    throw new Error('supply.edit requires pieces, fixedSupply, or supplyMode seeded.');
  }
  return editProject(input);
}

function generateTake(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project);
  const recipe = controls(input);
  const initial = initialFrom(source);
  const targetSeconds = finite(recipe.targetDurationSeconds, '$.recipe.targetDurationSeconds', 60, 4, 600);
  const fps = source.production.output.fps;
  const targetFrames = Math.round(targetSeconds * fps);
  const maximumActions = integer(recipe.maximumActions, '$.recipe.maximumActions', 120, 1, 500);
  const storyValue = recipe.story ?? 'calm';
  if (storyValue !== 'calm' && storyValue !== 'rising' && storyValue !== 'rescue') {
    throw new Error('$.recipe.story must be calm, rising, or rescue.');
  }
  const story = storyValue as StoryMode;
  const candidates = generateActions(initial, maximumActions, story);
  const rhythm = rhythmFrom(source);
  let actions: PlacementAction[] | undefined;
  for (let count = 1; count <= candidates.length; count += 1) {
    const candidate = candidates.slice(0, count);
    const compiledCandidate = compileTake({
      id: 'coverage-probe', name: 'coverage-probe', createdAt: '1970-01-01T00:00:00.000Z', initial, actions: candidate,
    }, rhythm, fps);
    if ((compiledCandidate.actions.at(-1)?.startFrame ?? 0) >= targetFrames) {
      actions = candidate;
      break;
    }
  }
  if (!actions) {
    const candidateFinal = candidates.length > 0 ? replayActions(initial, candidates).at(-1)?.after : initial;
    const exhausted = candidateFinal?.supplyExhausted === true;
    throw new Error(`Generated ${candidates.length} legal actions, but active gameplay did not reach ${targetSeconds}s${exhausted ? '; fixed supply was exhausted' : ''}.`);
  }
  const transitions = replayActions(initial, actions);
  const final = transitions.at(-1)?.after ?? initial;
  if (final.status !== 'playing') throw new Error('Generated trajectory reaches game over before the target duration.');
  const takeId = string(recipe.takeId, '$.recipe.takeId', `survival-${initial.seed}-${targetFrames}`);
  if (source.takes.some((take) => take.takeId === takeId)) throw new Error(`Take ${takeId} already exists.`);
  const take: Take = { id: takeId, name: takeId, createdAt: '1970-01-01T00:00:00.000Z', initial, actions };
  const replay = migrateBlockPlacementTakeV1(take, source.game.initialState.stateHash);
  const document = cloneDocument(source);
  document.takes.push(replay);
  validateDocument(document);
  const compiled = compileTake(take, rhythm, fps);
  const supplies = [...new Set(transitions.map((transition) => transition.before.setIndex))].map((setIndex) => {
    const snapshot = transitions.find((transition) => transition.before.setIndex === setIndex)!.before;
    return { setIndex, shapes: snapshot.pieces.map((piece) => piece.shapeId) };
  });
  return {
    ok: true,
    document,
    report: {
      operation: 'take.generate',
      takeId,
      story,
      targetDurationSeconds: targetSeconds,
      actualDurationSeconds: compiled.totalFrames / fps,
      lastActionStartSeconds: (compiled.actions.at(-1)?.startFrame ?? 0) / fps,
      actionCount: actions.length,
      finalStatus: final.status,
      finalStateHash: blockPlacementDefinition.runtime.hashState(final),
      authoredSupply: supplies,
      supplyMode: initial.fixedPieceSupply ? 'fixed' : 'seeded',
      authoredSupplyRounds: initial.fixedPieceSupply?.length ?? null,
      supplyExhausted: final.supplyExhausted === true,
      pressureTrace: transitions.map((transition, index) => ({
        actionIndex: index + 1,
        occupiedCells: transition.after.board.cells.flat().filter(Boolean).length,
        legalMoves: listLegalMoves(transition.after).length,
        clearedLines: transition.clear.rows.length + transition.clear.cols.length,
      })),
      storyEvidence: story === 'calm'
        ? 'Each step chooses the runtime highest-rated legal move.'
        : story === 'rising'
          ? 'Each step prefers a low-clear move among the runtime top eight; success is reported only if the full target remains legal.'
          : 'The opening 55% uses the rising-pressure selector, then switches to the runtime highest-rated rescue selector.',
      preserves: ['game.initialState', 'production', 'direction', 'existingTakes'],
      invalidates: ['compiledPlans', 'survivalEvidence'],
    },
  };
}

function importTake(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project);
  const recipe = controls(input, true);
  if (!Array.isArray(recipe.actions)) throw new Error('$.recipe.actions must be an array.');
  const initial = initialFrom(source);
  const actions = recipe.actions.map((raw, index) => {
    const semantic = object(raw, `$.recipe.actions[${index}]`);
    const durationFrames = integer(semantic.durationFrames, `$.recipe.actions[${index}].durationFrames`, 16, 1, 10_000);
    const provisional = {
      id: string(semantic.id, `$.recipe.actions[${index}].id`, `imported-placement-${String(index + 1).padStart(3, '0')}`),
      actor: semantic.actor ?? 'agent',
      pieceId: semantic.pieceId,
      anchor: semantic.anchor,
      durationFrames,
      pointerPath: semantic.pointerPath ?? [],
    };
    return parseBlockPlacementAction(provisional, `$.recipe.actions[${index}]`);
  });
  const transitions = replayActions(initial, actions);
  const takeId = string(recipe.takeId, '$.recipe.takeId', `imported-${stableHash(actions).slice(-8)}`);
  if (source.takes.some((take) => take.takeId === takeId)) throw new Error(`Take ${takeId} already exists.`);
  const take: Take = { id: takeId, name: takeId, createdAt: '1970-01-01T00:00:00.000Z', initial, actions };
  const document = cloneDocument(source);
  document.takes.push(migrateBlockPlacementTakeV1(take, source.game.initialState.stateHash));
  validateDocument(document);
  const final = transitions.at(-1)?.after ?? initial;
  return {
    ok: true,
    document,
    report: {
      operation: 'take.import',
      takeId,
      specifiedActionCount: recipe.actions.length,
      validatedActionCount: transitions.length,
      fullInputValidated: transitions.length === recipe.actions.length,
      finalStatus: final.status,
      supplyMode: initial.fixedPieceSupply ? 'fixed' : 'seeded',
      authoredSupplyRounds: initial.fixedPieceSupply?.length ?? null,
      supplyExhausted: final.supplyExhausted === true,
      preserves: ['game.initialState', 'production', 'direction', 'existingTakes'],
      invalidates: ['compiledPlans', 'survivalEvidence'],
    },
  };
}

function calibrateReference(input: AgentOperationInput): AgentOperationResult {
  const document = cloneDocument(validateDocument(input.project));
  const calibration = parseReferenceCalibration(controls(input, true).calibration, document);
  const style = object(document.direction?.style, '$.direction.style');
  document.direction!.style = { ...style, referenceCalibration: calibration };
  return { ok: true, document, report: { operation: 'reference calibrate', actionCount: calibration.actions.length, durationSeconds: calibration.duration, takeHash: calibration.takeHash, scoreFeedback: calibration.scoreFeedback ?? null, authoredScorePopupCount: calibration.actions.filter(a=>a.scorePopup).length, preserves: ['game', 'takes'], renderer: 'block-placement-calibrated' } };
}

function editReferenceEffects(input: AgentOperationInput): AgentOperationResult {
  const document=cloneDocument(validateDocument(input.project));
  const style=object(document.direction?.style,'$.direction.style');
  const calibration=parseReferenceCalibration(style.referenceCalibration,document);
  const opts=controls(input,true);
  if(Object.keys(opts).some(k=>k!=='effects'&&k!=='actions')||(!opts.effects&&!opts.actions))throw new Error('REFERENCE_EFFECT_OPTIONS_INVALID');
  if(opts.effects!==undefined){
    const patch=parseReferenceEffects(opts.effects);
    calibration.effects={...calibration.effects,...patch,...(patch.library?{library:{...calibration.effects?.library,...patch.library}}:{})};
  }
  if(opts.actions!==undefined){
    if(!Array.isArray(opts.actions)||opts.actions.length>calibration.actions.length)throw new Error('REFERENCE_EFFECT_ACTIONS_INVALID');
    const seen=new Set<string>();
    for(const raw of opts.actions){
      const cue=object(raw,'$.options.actions[]');
      if(typeof cue.actionId!=='string'||seen.has(cue.actionId)||Object.keys(cue).some(k=>!['actionId','like'].includes(k))||!['none','pink-cluster','blue-badge'].includes(String(cue.like)))throw new Error('REFERENCE_EFFECT_ACTIONS_INVALID');
      const action=calibration.actions.find(a=>a.actionId===cue.actionId);if(!action)throw new Error('REFERENCE_EFFECT_ACTION_NOT_FOUND');
      seen.add(cue.actionId);action.like=cue.like as 'none'|'pink-cluster'|'blue-badge';
    }
  }
  document.direction!.style={...style,referenceCalibration:parseReferenceCalibration(calibration,document)};
  return {ok:true,document,report:{operation:'reference effects edit',effects:calibration.effects,authoredLikeCount:calibration.actions.filter(a=>a.like&&a.like!=='none').length,preserves:['game','takes','production','audio','reference-timing'],invalidates:['render-artifacts'],renderer:'block-placement-calibrated'}};
}

/** Bind a sample to the calibrated clock rather than the standard gameplay director. */
function editReferenceClip(input:AgentOperationInput):AgentOperationResult {
 const document=cloneDocument(validateDocument(input.project)),opts=controls(input,true);
 if(Object.keys(opts).some(k=>!['id','startFrame','endFrame'].includes(k)))throw new Error('REFERENCE_CLIP_OPTIONS_INVALID');
 const calibration=parseReferenceCalibration(object(document.direction?.style,'$.direction.style').referenceCalibration,document),take=document.takes[0]!;
 const totalFrames=Math.round(calibration.duration*document.production.output.fps);
 const startFrame=integer(opts.startFrame,'$.options.startFrame',0,0,totalFrames-1),endFrame=integer(opts.endFrame,'$.options.endFrame',totalFrames-1,startFrame,totalFrames-1);
 const production=productionFromDocument(document)??{version:'1.0.0' as const};
 if(production.presentation)throw new Error('REFERENCE_CLIP_TIMING_OVERRIDE_UNSUPPORTED');
 const clip={id:string(opts.id,'$.options.id'),takeId:take.takeId,source:{takeHash:stableHash(take),frameSourceHash:stableHash({calibration,replay:take})},startFrame,endFrame};
 production.clips=[...(production.clips??[]).filter(c=>c.id!==clip.id),clip];production.selectedClipId=clip.id;
 return{ok:true,document:withProduction(document,parseProductionDirection(production)),report:{operation:'reference clip edit',clip,totalFrames,durationSeconds:(endFrame-startFrame+1)/document.production.output.fps,renderer:'block-placement-calibrated',preserves:['game','takes','reference-timing','audio'],stalePolicy:'reject-on-reference-calibration-or-take-change'}};
}

function validateTake(input: AgentOperationInput): AgentOperationResult {
  const document = validateDocument(input.project);
  const recipe = controls(input);
  const initial = initialFrom(document);
  const take = takeById(document, recipe);
  const transitions = replayActions(initial, take.actions);
  const final = transitions.at(-1)?.after ?? initial;
  return {
    ok: true,
    document,
    report: {
      operation: 'take.validate', takeId: take.id, fullInputValidated: true,
      actionCount: take.actions.length, finalStatus: final.status,
      supplyMode: initial.fixedPieceSupply ? 'fixed' : 'seeded',
      authoredSupplyRounds: initial.fixedPieceSupply?.length ?? null,
      supplyExhausted: final.supplyExhausted === true,
      finalStateHash: blockPlacementDefinition.runtime.hashState(final),
      steps: transitions.map((transition) => ({
        actionId: transition.action.id,
        clearedRows: transition.clear.rows,
        clearedColumns: transition.clear.cols,
        statusAfter: transition.after.status,
      })),
    },
  };
}

function retimeDirector(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project);
  const recipe = controls(input, true);
  const targetSeconds = finite(recipe.targetDurationSeconds, '$.recipe.targetDurationSeconds', 0, 1, 600);
  const take = takeById(source, recipe);
  const fps = source.production.output.fps;
  const targetFrames = Math.round(targetSeconds * fps);
  const beforeRhythm = rhythmFrom(source);
  const compileAt = (speed: number) => compileTake(take, { ...beforeRhythm, globalSpeed: speed }, fps);
  const candidates = new Map<number, { speed: number; distance: number }>();
  let low = 0.25;
  let high = 4;
  const slowestFrames = compileAt(low).totalFrames;
  const fastestFrames = compileAt(high).totalFrames;
  if (targetFrames > slowestFrames || targetFrames < fastestFrames) {
    throw new Error(`Target duration ${targetSeconds}s is outside the reachable rhythm range ${fastestFrames / fps}s–${slowestFrames / fps}s.`);
  }
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const speed = (low + high) / 2;
    const frames = compileAt(speed).totalFrames;
    const candidate = { speed, distance: Math.abs(frames - targetFrames) };
    const previous = candidates.get(frames);
    if (!previous || candidate.distance < previous.distance) candidates.set(frames, candidate);
    if (frames > targetFrames) low = speed;
    else high = speed;
  }
  const bestEntry = [...candidates.entries()].sort((left, right) => left[1].distance - right[1].distance)[0];
  if (!bestEntry) throw new Error(`Target duration ${targetSeconds}s could not be evaluated.`);
  const [actualFrames, best] = bestEntry;
  const document = cloneDocument(source);
  document.direction = { ...document.direction!, rhythm: { ...beforeRhythm, globalSpeed: best.speed } };
  validateDocument(document);
  return {
    ok: true,
    document,
    report: {
      operation: 'director.retime', takeId: take.id,
      targetDurationSeconds: targetSeconds, actualDurationSeconds: actualFrames / fps,
      durationDeltaSeconds: (actualFrames - targetFrames) / fps,
      beforeSpeed: beforeRhythm.globalSpeed, afterSpeed: best.speed,
      actionsUnchanged: stableHash(source.takes) === stableHash(document.takes),
      rulesUnchanged: stableHash(source.game) === stableHash(document.game),
      preserves: ['game', 'takes', 'production', 'direction.style'],
      invalidates: ['compiledPlans', 'renderArtifacts', 'frameCoordinateCuts'],
    },
  };
}

function getCatalog(_input: AgentOperationInput): AgentOperationResult {
  return {
    ok: true,
    report: {
      operation: 'catalog.get',
      boardPresets: BOARD_PRESETS.map((preset) => preset.id),
      shapes: ['single', 'domino-h', 'domino-v', 'tri-h', 'tri-v', 'line4-h', 'line4-v', 'line5-h', 'line5-v', 'square-2', 'square-3', 'l-3', 'l-5', 'j-5', 't-4', 's-4', 'z-4', 'plus-5'],
      colors: TILE_COLORS,
      stories: [
        { id: 'calm', evidence: 'highest-rated native legal move at each step' },
        { id: 'rising', evidence: 'low-clear choice among the native top eight, accepted only if full target validation succeeds' },
        { id: 'rescue', evidence: 'rising selector for the opening 55%, then highest-rated native selector' },
      ],
      looks: Object.entries(LOOK_CATALOG).map(([id, look]) => ({
        id,
        title: look.title,
        renderer: look.style.renderer,
        material: look.style.material,
        lighting: look.style.lighting,
        camera: look.style.camera,
        fx: look.style.fx,
      })),
      materialThemes: MATERIAL_THEME_IDS.map(id => ({ id, title: MATERIAL_THEMES[id].title, cellGapPx: 0.75, tileFace: 'Preserves the embedded tile.face binding; the delivered theme recipe groups all three surfaces.' })),
      rhythms: RHYTHM_PRESET_LIST.map((preset) => ({
        id: preset.id,
        label: preset.label,
        description: preset.description,
        globalSpeed: preset.globalSpeed,
      })),
      assetSlots: blockPlacementAgentAssetDeclaration.slots.map((slot) => ({
        slotId: slot.slotId,
        title: slot.title,
        role: slot.role,
        consumer: slot.consumer,
      })),
      faceModes: [
        { id: 'stamp', slotId: 'tile.face', surfaces: ['board', 'tray', 'drag'], deferred: false },
        { id: 'atlas', slotId: 'board.atlas', surfaces: ['board-occupied'], deferred: false },
        { id: 'underlay', slotId: null, surfaces: ['board'], deferred: true },
      ],
      composed: {
        author: 'project create, optional look apply, optional rhythm apply, take generate, production validate. Does not encode video.',
        produce: 'After author, use bcs render then bcs video verify. Game operations never encode.',
      },
      deferred: ['photo-underlay', 'stickers', 'easter-egg-rules'],
      square3: { randomSupply: false, includeSquare3: 'project create and supply generate opt in; default generation still excludes square-3' },
      goalAuthoring: {
        nativePressureMetrics: PLACEMENT_PRESSURE_METRICS,
        operations: ['candidate search','quality route','take alternative','take edit','take clone','take select','take delete','take replay','supply generate','robustness evaluate'],
        example: { operation: 'candidate search', options: { takeId: 'tension-rescue', stories: ['rescue'], budget: { candidates: 6, maxSteps: 120 }, pressureStages: [{ id: 'tension', from: 0.15, to: 0.55, metric: 'occupiedCells', minimum: 16 }, { id: 'rescue', from: 0.55, to: 1, metric: 'legalMoves', minimum: 1 }] } },
      },
      claimBoundary: 'Story selectors are explainable heuristics. Only a returned validated Take proves its requested trajectory; arbitrary pressure curves are not guaranteed.',
    },
  };
}

function applyLook(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project);
  const recipe = controls(input, true);
  const lookId = string(recipe.lookId, '$.recipe.lookId');
  const look = LOOK_CATALOG[lookId];
  if (!look) throw new Error(`Unknown or unresolved look ${lookId}; call catalog.get for supported look IDs.`);
  const document = cloneDocument(source);
  const previousAssets = source.direction?.style && typeof source.direction.style === 'object'
    ? (source.direction.style as JsonRecord).agentAssets
    : undefined;
  document.production.lookPackRef = structuredClone(look.lookPackRef);
  document.direction = {
    ...document.direction!,
    style: {
      ...structuredClone(look.style),
      ...(previousAssets === undefined ? {} : { agentAssets: structuredClone(previousAssets) }),
    },
  };
  validateDocument(document);
  return {
    ok: true,
    document,
    report: {
      operation: 'look.apply', lookId, before: source.production.lookPackRef, after: look.lookPackRef,
      gameUnchanged: stableHash(source.game) === stableHash(document.game),
      takesUnchanged: stableHash(source.takes) === stableHash(document.takes),
      rhythmUnchanged: stableHash(source.direction?.rhythm) === stableHash(document.direction?.rhythm),
      rendererStyleChanged: stableHash(source.direction?.style) !== stableHash(document.direction?.style),
      preserves: ['game', 'takes', 'direction.rhythm', 'production.layoutProfileRef', 'production.cameraProfileRef', 'production.output', 'agentAssets'],
      invalidates: ['renderArtifacts', 'visualPreviews'],
      assetsUnchanged: stableHash((source.direction?.style as JsonRecord | undefined)?.agentAssets ?? null)
        === stableHash((document.direction?.style as JsonRecord | undefined)?.agentAssets ?? null),
    },
  };
}

function editPraise(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project);
  const words = parsePraiseWords(controls(input, true).words);
  const document = cloneDocument(source);
  const style = structuredClone(document.direction?.style) as StyleSpec;
  if (!style?.reference2d) throw new Error('PRAISE_STYLE_REQUIRED');
  style.reference2d.praiseWords = words;
  document.direction = { ...document.direction!, style };
  validateDocument(document);
  return { ok: true, document, report: { operation: 'praise.edit', words,
    gameUnchanged: stableHash(source.game) === stableHash(document.game),
    takesUnchanged: stableHash(source.takes) === stableHash(document.takes),
    rhythmUnchanged: stableHash(source.direction?.rhythm) === stableHash(document.direction?.rhythm),
  } };
}

function applyMaterialTheme(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project);
  const options = controls(input, true);
  const selected = materialTheme(options.themeId);
  if (!selected) throw new Error('Unknown material theme; call catalog get.');
  const gap = options.cellGapPx ?? 0.75;
  if (typeof gap !== 'number' || !Number.isFinite(gap) || gap < 0 || gap > 8) throw new Error('cellGapPx must be a finite number between 0 and 8.');
  const document = cloneDocument(source);
  const style = document.direction?.style as JsonRecord | undefined;
  if (!style || style.renderer !== 'reference-2d') throw new Error('Material themes require the reference-2d renderer.');
  const reference = style.reference2d as JsonRecord;
  if (reference.tileMaterial !== 'candy-blast') throw new Error('Material themes require the classic-blast tile material.');
  style.reference2d = { ...reference, materialTheme: selected.id, cellGapPx: gap };
  style.background = selected.stage.middle;
  validateDocument(document);
  return { ok: true, document, report: { operation: 'theme.apply', themeId: selected.id, title: selected.title, cellGapPx: gap,
    gameUnchanged: stableHash(source.game) === stableHash(document.game), takesUnchanged: stableHash(source.takes) === stableHash(document.takes),
    rhythmUnchanged: stableHash(source.direction?.rhythm) === stableHash(document.direction?.rhythm),
    assetsUnchanged: stableHash((source.direction?.style as JsonRecord)?.agentAssets ?? null) === stableHash(style.agentAssets ?? null),
    palette: selected, preserves: ['game','takes','direction.rhythm','agentAssets','production'], invalidates: ['render-artifacts','visual-previews'] } };
}

function inspectLook(input: AgentOperationInput): AgentOperationResult {
  const document = validateDocument(input.project);
  const lookId = lookIdFrom(document);
  const style = document.direction?.style as JsonRecord | undefined;
  const assets = readAgentAssetExtension(document);
  const slots = blockPlacementAgentAssetDeclaration.slots.map((slot) => {
    const binding = assets.bindings[slot.slotId];
    const entry = binding ? assets.entries[binding.assetId] : undefined;
    return {
      slotId: slot.slotId,
      title: slot.title,
      bound: Boolean(binding),
      assetId: binding?.assetId ?? null,
      width: entry?.width ?? null,
      height: entry?.height ?? null,
      byteLength: entry?.byteLength ?? null,
      consumer: slot.consumer,
    };
  });
  const stamp = Boolean(assets.bindings['tile.face']);
  const atlas = Boolean(assets.bindings['board.atlas']);
  return {
    ok: true,
    document,
    report: {
      operation: 'look.inspect',
      lookId,
      lookPackRef: document.production.lookPackRef,
      catalog: Object.entries(LOOK_CATALOG).map(([id, look]) => ({ id, title: look.title, current: id === lookId })),
      style: style ? {
        renderer: style.renderer ?? null,
        material: style.material ?? null,
        lighting: style.lighting ?? null,
        camera: style.camera ?? null,
        fx: style.fx ?? null,
        background: style.background ?? null,
      } : null,
      face: {
        stamp,
        atlas,
        boardPrefersAtlas: atlas,
        trayUsesStamp: stamp,
        underlay: false,
      },
      slots,
      deferred: ['photo-underlay', 'stickers', 'easter-egg-rules'],
      warnings: [
        ...(atlas ? [] : []),
        ...(stamp && atlas ? ['Occupied board cells sample board.atlas; tray and drag keep tile.face.'] : []),
      ],
    },
  };
}

function applyRhythm(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project);
  const recipe = controls(input, true);
  const rhythmId = string(recipe.rhythmId, '$.recipe.rhythmId') as RhythmPresetId;
  const preset = RHYTHM_PRESETS[rhythmId];
  if (!preset) throw new Error(`Unknown rhythm ${rhythmId}; call catalog.get for supported rhythm IDs.`);
  const document = cloneDocument(source);
  document.direction = { ...document.direction!, rhythm: structuredClone(preset) };
  validateDocument(document);
  return {
    ok: true,
    document,
    report: {
      operation: 'rhythm.apply',
      rhythmId,
      before: source.direction?.rhythm,
      after: document.direction?.rhythm,
      gameUnchanged: stableHash(source.game) === stableHash(document.game),
      takesUnchanged: stableHash(source.takes) === stableHash(document.takes),
      styleUnchanged: stableHash(source.direction?.style) === stableHash(document.direction?.style),
      preserves: ['game', 'takes', 'production', 'direction.style'],
      invalidates: ['compiledPlans', 'renderArtifacts', 'frameCoordinateCuts'],
    },
  };
}

function inspectRhythm(input: AgentOperationInput): AgentOperationResult {
  const document = validateDocument(input.project);
  const current = rhythmFrom(document);
  return {
    ok: true,
    document,
    report: {
      operation: 'rhythm.inspect',
      current,
      catalog: RHYTHM_PRESET_LIST.map((preset) => ({
        id: preset.id,
        label: preset.label,
        description: preset.description,
        globalSpeed: preset.globalSpeed,
        current: preset.id === current.id,
      })),
      retiming: 'director retime scales globalSpeed toward a target duration without replacing the preset identity.',
    },
  };
}

function validateProduction(input: AgentOperationInput): AgentOperationResult {
  const document = validateDocument(input.project);
  const recipe = controls(input);
  const gates: Array<{ id: string; passed: boolean; detail: JsonRecord }> = [
    { id: 'schema', passed: true, detail: { schemaValid: true, rulesValid: true } },
  ];
  const lookId = lookIdFrom(document);
  gates.push({
    id: 'look',
    passed: Boolean(document.production.lookPackRef?.id),
    detail: { lookId, cataloged: lookId !== null, lookPackRef: document.production.lookPackRef },
  });
  const showPointer = (document.direction?.style as StyleSpec | undefined)?.showPointer;
  gates.push({
    id: 'interaction-overlay',
    passed: showPointer === false,
    detail: {
      showPointer: showPointer ?? null,
      requirement: 'Selection and drag keep their motion but must not render the procedural white pointer circle.',
    },
  });
  const assets = readAgentAssetExtension(document);
  const declaredSlots = new Set(blockPlacementAgentAssetDeclaration.slots.map((slot) => slot.slotId));
  const unknownBindings = Object.keys(assets.bindings).filter((slotId) => !declaredSlots.has(slotId));
  gates.push({
    id: 'assets',
    passed: unknownBindings.length === 0,
    detail: { boundSlots: Object.keys(assets.bindings), unknownBindings },
  });
  if (document.takes.length === 0) {
    gates.push({ id: 'take', passed: false, detail: { reason: 'Project has no Take.' } });
    return {
      ok: false,
      document,
      report: {
        operation: 'production.validate',
        passed: false,
        readyForRender: false,
        readyForArtReview: false,
        gates,
        encodesVideo: false,
        claimBoundary: 'Technical gates do not certify aesthetic quality. This command never sets ready-for-art-review.',
      },
    };
  }
  const take = takeById(document, recipe);
  const validated = validateTake({ project: document, options: { takeId: take.id } });
  gates.push({ id: 'take-legal', passed: validated.ok, detail: validated.report as JsonRecord });
  const targetDurationSeconds = recipe.targetDurationSeconds === undefined
    ? 60
    : finite(recipe.targetDurationSeconds, '$.recipe.targetDurationSeconds', 60, 1, 600);
  const survival = checkSurvival({
    project: document,
    options: { takeId: take.id, targetDurationSeconds },
  });
  gates.push({ id: 'survival', passed: survival.ok, detail: survival.report as JsonRecord });
  const plan = compilePlan({ project: document, options: { takeId: take.id } });
  gates.push({
    id: 'plan',
    passed: plan.ok,
    detail: {
      takeId: take.id,
      durationSeconds: plan.report.durationSeconds,
      totalFrames: plan.report.totalFrames,
      frameSourceHash: plan.report.frameSourceHash,
    },
  });
  const passed = gates.every((gate) => gate.passed);
  return {
    ok: passed,
    document,
    report: {
      operation: 'production.validate',
      passed,
      takeId: take.id,
      readyForRender: passed,
      readyForArtReview: false,
      gates,
      encodesVideo: false,
      next: passed ? 'bcs render then bcs video verify' : 'fix failing gates; do not encode',
      claimBoundary: 'Technical gates do not certify aesthetic quality. This command never sets ready-for-art-review.',
    },
    artifact: plan.artifact,
  };
}

function author(input: AgentOperationInput): AgentOperationResult {
  const recipe = controls(input);
  const created = createProject(input);
  if (!created.ok || !created.document) return { ...created, report: { operation: 'author', failedAt: 'project create', details: created.report } };
  let document = created.document;
  const steps: Array<{ operation: string; report: JsonRecord }> = [{ operation: 'project create', report: created.report as JsonRecord }];
  try {
    if (recipe.lookId !== undefined) {
      const looked = applyLook({ project: document, options: { lookId: recipe.lookId } });
      if (!looked.ok || !looked.document) return { ...looked, document, report: { operation: 'author', failedAt: 'look apply', steps: steps.map((step) => step.operation), details: looked.report } };
      document = looked.document;
      steps.push({ operation: 'look apply', report: looked.report as JsonRecord });
    }
    if (recipe.rhythmId !== undefined) {
      const rhythm = applyRhythm({ project: document, options: { rhythmId: recipe.rhythmId } });
      if (!rhythm.ok || !rhythm.document) return { ...rhythm, document, report: { operation: 'author', failedAt: 'rhythm apply', steps: steps.map((step) => step.operation), details: rhythm.report } };
      document = rhythm.document;
      steps.push({ operation: 'rhythm apply', report: rhythm.report as JsonRecord });
    }
    const generated = generateTake({
      project: document,
      options: {
        ...(recipe.takeId === undefined ? {} : { takeId: recipe.takeId }),
        ...(recipe.targetDurationSeconds === undefined ? {} : { targetDurationSeconds: recipe.targetDurationSeconds }),
        ...(recipe.story === undefined ? {} : { story: recipe.story }),
        ...(recipe.maximumActions === undefined ? {} : { maximumActions: recipe.maximumActions }),
      },
    });
    if (!generated.ok || !generated.document) {
      return { ...generated, document, report: { operation: 'author', failedAt: 'take generate', steps: steps.map((step) => step.operation), details: generated.report } };
    }
    document = generated.document;
    steps.push({ operation: 'take generate', report: generated.report as JsonRecord });
    const validated = validateProduction({
      project: document,
      options: {
        ...(recipe.takeId === undefined ? {} : { takeId: recipe.takeId }),
        ...(recipe.targetDurationSeconds === undefined ? {} : { targetDurationSeconds: recipe.targetDurationSeconds }),
      },
    });
    steps.push({ operation: 'production validate', report: validated.report as JsonRecord });
    return {
      ok: validated.ok,
      document,
      report: {
        operation: 'author',
        steps: steps.map((step) => step.operation),
        details: steps,
        encodesVideo: false,
        readyForRender: validated.report.readyForRender === true,
        readyForArtReview: false,
        next: 'bcs render then bcs video verify',
      },
      artifact: validated.artifact,
    };
  } catch (error) {
    return { ...errorResult(error), document, report: { ...errorResult(error).report, operation: 'author', failedAt: 'author', steps: steps.map((step) => step.operation) } };
  }
}

function compilePlan(input: AgentOperationInput): AgentOperationResult {
  const document = validateDocument(input.project);
  const recipe = controls(input);
  const take = takeById(document, recipe);
  const rhythm = rhythmFrom(document);
  const fps = document.production.output.fps;
  const compiled = compileTake(take, rhythm, fps);
  const frameSource = compileBlockPlacementFrameSource({ take, rhythm, fps, praiseWords: (document.direction?.style as StyleSpec | undefined)?.reference2d.praiseWords });
  return {
    ok: true,
    document,
    report: {
      operation: 'plan.compile', takeId: take.id, fps,
      totalFrames: compiled.totalFrames, durationSeconds: compiled.totalFrames / fps,
      frameSourceHash: frameSource.frameSourceHash,
      actionCount: compiled.actions.length,
    },
    artifact: {
      kind: 'block-placement-presentation-plan', version: '1.0.0', takeId: take.id,
      fps, totalFrames: compiled.totalFrames, frameSourceHash: frameSource.frameSourceHash,
      actions: compiled.actions.map((entry) => ({
        actionId: entry.action.id,
        startFrame: entry.startFrame,
        releaseFrame: entry.releaseFrame,
        clearStartFrame: entry.clearStartFrame,
        clearEndFrame: entry.clearEndFrame,
        endFrame: entry.endFrame,
      })),
    },
  };
}

function checkSurvival(input: AgentOperationInput): AgentOperationResult {
  const document = validateDocument(input.project);
  const recipe = controls(input);
  const targetSeconds = finite(recipe.targetDurationSeconds, '$.recipe.targetDurationSeconds', 60, 1, 600);
  const take = takeById(document, recipe);
  const initial = initialFrom(document);
  const transitions = replayActions(initial, take.actions);
  const final = transitions.at(-1)?.after ?? initial;
  const fps = document.production.output.fps;
  const compiled = compileTake(take, rhythmFrom(document), fps);
  const first = compiled.actions[0];
  const last = compiled.actions.at(-1);
  const gaps = compiled.actions.slice(1).map((entry, index) => entry.startFrame - compiled.actions[index]!.endFrame);
  const maximumIdleFrames = Math.max(first?.startFrame ?? compiled.totalFrames, ...gaps, compiled.totalFrames - (last?.endFrame ?? 0));
  const presentationPass = compiled.totalFrames >= Math.round(targetSeconds * fps)
    && (last?.startFrame ?? 0) >= Math.round(targetSeconds * fps)
    && maximumIdleFrames <= fps * 2
    && compiled.actions.length >= Math.ceil(targetSeconds / 2);
  const runtimePass = transitions.length === take.actions.length && final.status === 'playing';
  const report = {
    operation: 'survival.check', takeId: take.id, passed: presentationPass && runtimePass,
    targetDurationSeconds: targetSeconds,
    presentationCoverage: {
      clock: 'presentation-time', totalFrames: compiled.totalFrames,
      durationSeconds: compiled.totalFrames / fps,
      firstActionFrame: first?.startFrame ?? null,
      targetReachedDuringActiveSequence: (last?.startFrame ?? 0) >= Math.round(targetSeconds * fps),
      lastActionEndFrame: last?.endFrame ?? null,
      maximumIdleSeconds: maximumIdleFrames / fps,
      actionDensityPerSecond: take.actions.length / (compiled.totalFrames / fps),
      passed: presentationPass,
    },
    runtimeCoverage: {
      clock: 'action-sequence; this ruleset has no independent rising-field or countdown clock',
      legalActionsValidated: transitions.length,
      requestedActions: take.actions.length,
      boardChanges: new Set(transitions.map((transition) => boardFingerprint(transition.after.board))).size,
      finalStatus: final.status,
      supplyMode: initial.fixedPieceSupply ? 'fixed' : 'seeded',
      authoredSupplyRounds: initial.fixedPieceSupply?.length ?? null,
      supplyExhausted: final.supplyExhausted === true,
      finalStateHash: blockPlacementDefinition.runtime.hashState(final),
      passed: runtimePass,
    },
    claimBoundary: 'This proves one deterministic authored trajectory only; it does not claim survival for arbitrary players or random supplies.',
  };
  return { ok: report.passed, document, report };
}

const PLACEMENT_PRESSURE_METRICS = ['occupiedCells', 'legalMoves', 'clearedLines'] as const;

function placementPressure(initial: GameSnapshot, actions: PlacementAction[]): AgentPressurePoint[] {
  const transitions = replayActions(initial, actions);
  return transitions.map((transition, index) => ({
    step: index + 1,
    progress: transitions.length <= 1 ? 1 : index / (transitions.length - 1),
    stateHash: blockPlacementDefinition.runtime.hashState(transition.after),
    metrics: {
      occupiedCells: transition.after.board.cells.flat().filter(Boolean).length,
      legalMoves: listLegalMoves(transition.after).length,
      clearedLines: transition.clear.rows.length + transition.clear.cols.length,
    },
  }));
}

function candidateSearch(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project);
  const recipe = controls(input);
  const budget = parseAgentSearchBudget(recipe.budget, { candidates: 6, maxSteps: 120 });
  const targetDurationSeconds = finite(recipe.targetDurationSeconds, '$.recipe.targetDurationSeconds', 0, 0, 600);
  const stages = parsePressureStageTargets(recipe.pressureStages, PLACEMENT_PRESSURE_METRICS);
  const requestedStories = recipe.stories ?? ['calm', 'rising', 'rescue'];
  if (!Array.isArray(requestedStories) || requestedStories.length < 1 || requestedStories.some(item => item !== 'calm' && item !== 'rising' && item !== 'rescue')) {
    throw new Error('$.recipe.stories must contain calm, rising, or rescue.');
  }
  const initial = initialFrom(source);
  const candidates = Array.from({ length: budget.candidates }, (_, index) => {
    const story = requestedStories[index % requestedStories.length] as StoryMode;
    const actions = generateActions(initial, budget.maxSteps, story, index);
    const pressure = placementPressure(initial, actions);
    const stageResults = assessPressureStages(pressure, stages);
    const probe: Take = { id: 'candidate-probe', name: 'candidate-probe', createdAt: '1970-01-01T00:00:00.000Z', initial, actions };
    const activeDurationSeconds = actions.length ? (compileTake(probe, rhythmFrom(source), source.production.output.fps).actions.at(-1)?.startFrame ?? 0) / source.production.output.fps : 0;
    const durationAchieved = targetDurationSeconds === 0 || activeDurationSeconds >= targetDurationSeconds;
    const achieved = stageResults.every(stage => stage.achieved) && durationAchieved;
    const final = actions.length ? replayActions(initial, actions).at(-1)!.after : initial;
    return {
      index, story, variant: index, achieved, actionCount: actions.length,
      signature: trajectorySignature(actions.map(action => ({ pieceId: action.pieceId, anchor: action.anchor }))),
      finalStatus: final.status, stageResults, pressure, pressureSummary: summarizePressureTrace(pressure), activeDurationSeconds, durationAchieved, actions,
    };
  });
  const selected = [...candidates].sort((a, b) => Number(b.achieved) - Number(a.achieved) || b.actionCount - a.actionCount)[0]!;
  if (!selected.actions.length) return { ok: false, report: { operation: 'candidate search', searchedCandidates: candidates.length, targetAchieved: false, reason: 'No legal trajectory candidate was found.', budget } };
  const takeId = string(recipe.takeId, '$.recipe.takeId', `goal-${selected.story}-${selected.index}`);
  if (source.takes.some(take => take.takeId === takeId)) throw new Error(`Take ${takeId} already exists.`);
  const take: Take = { id: takeId, name: takeId, createdAt: '1970-01-01T00:00:00.000Z', initial, actions: selected.actions };
  const document = cloneDocument(source);
  document.takes.push(migrateBlockPlacementTakeV1(take, source.game.initialState.stateHash));
  validateDocument(document);
  const peakPressureIndex = selected.pressure.reduce((best, point, index, all) => (point.metrics.occupiedCells ?? -Infinity) > (all[best]!.metrics.occupiedCells ?? -Infinity) ? index : best, 0);
  return {
    ok: true,
    document,
    report: {
      operation: 'candidate search', budget, searchedCandidates: candidates.length, targetAchieved: selected.achieved,
      selected: { takeId, story: selected.story, variant: selected.variant, signature: selected.signature, actionCount: selected.actionCount, finalStatus: selected.finalStatus, stageResults: selected.stageResults, pressureSummary: selected.pressureSummary },
      unmetTargets: selected.stageResults.filter(stage => !stage.achieved),
      durationTarget: { requestedSeconds: targetDurationSeconds || null, achieved: selected.durationAchieved, actualActiveSeconds: selected.activeDurationSeconds },
      previewCanary: { basis: 'action-window', startActionIndex: Math.max(0, peakPressureIndex - 4), endActionIndex: Math.min(selected.actions.length - 1, peakPressureIndex + 5), requestedDurationSeconds: 10 },
      nativeMetricSemantics: { occupiedCells: 'occupied cells after the placement resolves', legalMoves: 'runtime-legal piece and anchor pairs after the step', clearedLines: 'rows plus columns cleared by this step' },
      arbitraryCurveGuaranteed: false,
    },
    artifact: { candidates: candidates.map(({ actions: _actions, pressure, ...candidate }) => ({ ...candidate, pressure })) },
  };
}

function alternativeTake(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project);
  const recipe = controls(input);
  const base = takeById(source, { takeId: recipe.takeId });
  const budget = parseAgentSearchBudget(recipe.budget, { candidates: 8, maxSteps: Math.max(1, base.actions.length) });
  const initial = initialFrom(source);
  const lockedSetupHash = stableHash(source.game);
  const baseSignature = trajectorySignature(base.actions.map(action => ({ pieceId: action.pieceId, anchor: action.anchor })));
  let found: { story: StoryMode; actions: PlacementAction[]; signature: string } | undefined;
  for (let index = 0; index < budget.candidates; index += 1) {
    const story = (['calm', 'rising', 'rescue'] as const)[index % 3]!;
    const actions = generateActions(initial, budget.maxSteps, story, index);
    const signature = trajectorySignature(actions.map(action => ({ pieceId: action.pieceId, anchor: action.anchor })));
    if (actions.length && signature !== baseSignature) { found = { story, actions, signature }; break; }
  }
  if (!found) return { ok: true, document: source, report: { operation: 'take alternative', setupLocked: true, lockedSetupHash, sourceSignature: baseSignature, searchedCandidates: budget.candidates, exhausted: true, alternativeFound: false, budget } };
  const takeId = string(recipe.newTakeId, '$.recipe.newTakeId', `${base.id}-alternative`);
  if (source.takes.some(take => take.takeId === takeId)) throw new Error(`Take ${takeId} already exists.`);
  const take: Take = { id: takeId, name: takeId, createdAt: '1970-01-01T00:00:00.000Z', initial, actions: found.actions };
  const document = cloneDocument(source);
  document.takes.push(migrateBlockPlacementTakeV1(take, source.game.initialState.stateHash));
  if (stableHash(document.game) !== lockedSetupHash) throw new Error('LOCKED setup changed during alternative search.');
  validateDocument(document);
  return { ok: true, document, report: { operation: 'take alternative', setupLocked: true, lockedSetupHash, sourceSignature: baseSignature, alternativeSignature: found.signature, signaturesDiffer: true, alternativeFound: true, exhausted: false, searchedCandidates: budget.candidates, takeId, story: found.story, staleCuts: { status: 'explicit', scope: 'native-gameplay-envelope', affected: [], productionClips: 'preserved-with-original-source-identities-and-validated-when-accessed', reason: 'The new native trajectory has no cut bindings; shared direction.production clips remain unchanged.' } } };
}

function editTake(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project);
  const recipe = controls(input, true);
  const base = takeById(source, recipe);
  const at = integer(recipe.at, '$.recipe.at', -1, 0, base.actions.length);
  const deleteCount = integer(recipe.deleteCount, '$.recipe.deleteCount', 0, 0, base.actions.length - at);
  if (!Array.isArray(recipe.actions)) throw new Error('$.recipe.actions must be an array (empty is allowed for deletion).');
  const inserted = recipe.actions.map((raw, index) => {
    const value = object(raw, `$.recipe.actions[${index}]`);
    return parseBlockPlacementAction({
      id: string(value.id, `$.recipe.actions[${index}].id`, `edited-${at + index + 1}`), actor: value.actor ?? 'agent',
      pieceId: value.pieceId, anchor: value.anchor,
      durationFrames: integer(value.durationFrames, `$.recipe.actions[${index}].durationFrames`, 16, 1, 10_000), pointerPath: value.pointerPath ?? [],
    }, `$.recipe.actions[${index}]`);
  });
  const actions = [...base.actions.slice(0, at), ...inserted, ...base.actions.slice(at + deleteCount)];
  if (!actions.length) throw new Error('Edited Take must contain at least one action.');
  const initial = initialFrom(source);
  const transitions = replayActions(initial, actions);
  if (transitions.length !== actions.length) throw new Error('Edited Take did not replay every action.');
  const takeId = string(recipe.newTakeId, '$.recipe.newTakeId');
  if (source.takes.some(take => take.takeId === takeId)) throw new Error(`Take ${takeId} already exists.`);
  const nextTake: Take = { id: takeId, name: takeId, createdAt: '1970-01-01T00:00:00.000Z', initial, actions };
  const document = cloneDocument(source);
  document.takes.push(migrateBlockPlacementTakeV1(nextTake, source.game.initialState.stateHash));
  validateDocument(document);
  return { ok: true, document, report: { operation: 'take edit', sourceTakeId: base.id, takeId, at, deleteCount, insertedCount: inserted.length, actionCount: actions.length, fullInputValidated: true, setupUnchanged: stableHash(source.game) === stableHash(document.game), staleCuts: { status: 'explicit', scope: 'native-gameplay-envelope', affected: [], productionClips: 'preserved-with-original-source-identities-and-validated-when-accessed', reason: 'The edited trajectory is a new Take and receives no inherited native cut binding.' } } };
}

function cloneTake(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project); const recipe = controls(input, true);
  const base = takeById(source, recipe); const takeId = string(recipe.newTakeId, '$.recipe.newTakeId');
  if (source.takes.some(take => take.takeId === takeId)) throw new Error(`Take ${takeId} already exists.`);
  const cloned: Take = { ...structuredClone(base), id: takeId, name: takeId };
  const document = cloneDocument(source); document.takes.push(migrateBlockPlacementTakeV1(cloned, source.game.initialState.stateHash)); validateDocument(document);
  return { ok: true, document, report: { operation: 'take clone', sourceTakeId: base.id, takeId, semanticSignature: trajectorySignature(cloned.actions), exactClone: stableHash(base.actions) === stableHash(cloned.actions), staleCuts: { status: 'explicit', scope: 'native-gameplay-envelope', affected: [], productionClips: 'preserved-with-original-source-identities-and-validated-when-accessed', reason: 'The cloned trajectory receives no native cut binding.' } } };
}

function selectTake(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project); const recipe = controls(input, true);
  const requested = string(recipe.takeId, '$.recipe.takeId'); const index = source.takes.findIndex(take => take.takeId === requested);
  if (index < 0) throw new Error(`Unknown Take ${requested}.`);
  const document = cloneDocument(source); const [take] = document.takes.splice(index, 1); document.takes.unshift(take!); validateDocument(document);
  return { ok: true, document, report: { operation: 'take select', takeId: requested, selectionEncoding: 'takes[0]', actionsUnchanged: true, setupUnchanged: true } };
}

function deleteTake(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project); const recipe = controls(input, true); const takeId = string(recipe.takeId, '$.recipe.takeId');
  if (!source.takes.some(take => take.takeId === takeId)) throw new Error(`Unknown Take ${takeId}.`);
  const productionClips = source.direction?.production && typeof source.direction.production === 'object'
    ? (source.direction.production as { clips?: Array<{ id?: unknown; takeId?: unknown }> }).clips ?? []
    : [];
  const affectedProductionClipIds = productionClips
    .filter(clip => clip.takeId === takeId && typeof clip.id === 'string')
    .map(clip => clip.id as string);
  const document = cloneDocument(source); document.takes = document.takes.filter(take => take.takeId !== takeId); validateDocument(document);
  return { ok: true, document, report: { operation: 'take delete', takeId, remainingTakeIds: document.takes.map(take => take.takeId), staleCuts: { status: 'explicit', scope: 'native-gameplay-envelope', affected: [], affectedProductionClipIds, productionClips: 'preserved-with-original-source-identities-and-validated-when-accessed', reason: 'Shared direction.production clips bound to the deleted Take remain explicit and will fail source validation when accessed.' } } };
}

function replayTakeSteps(input: AgentOperationInput): AgentOperationResult {
  const document = validateDocument(input.project); const recipe = controls(input); const take = takeById(document, recipe); const initial = initialFrom(document);
  const transitions = replayActions(initial, take.actions); const points = placementPressure(initial, take.actions);
  return { ok: true, document, report: { operation: 'take replay', takeId: take.id, fullInputValidated: transitions.length === take.actions.length, stepCount: transitions.length, finalStatus: transitions.at(-1)?.after.status ?? initial.status }, artifact: { initialStateHash: blockPlacementDefinition.runtime.hashState(initial), steps: transitions.map((transition, index) => ({ index, action: { pieceId: transition.action.pieceId, anchor: transition.action.anchor }, beforeStateHash: blockPlacementDefinition.runtime.hashState(transition.before), afterStateHash: blockPlacementDefinition.runtime.hashState(transition.after), events: { clearedRows: transition.clear.rows, clearedColumns: transition.clear.cols, scoreDelta: transition.after.score - transition.before.score }, state: { status: transition.after.status, setIndex: transition.after.setIndex, turn: transition.after.turn, score: transition.after.score, occupiedCells: points[index]!.metrics.occupiedCells, legalMoves: points[index]!.metrics.legalMoves } })) } };
}

function generateSupply(input: AgentOperationInput): AgentOperationResult {
  const source = validateDocument(input.project); const recipe = controls(input);
  const rounds = integer(recipe.rounds, '$.recipe.rounds', 24, 1, 160); const seed = integer(recipe.seed, '$.recipe.seed', initialFrom(source).seed, 0, 0x7fffffff);
  const policy = recipe.policy ?? 'state-aware-rescue-v1';
  if (policy !== 'fixed-seeded-v1' && policy !== 'state-aware-rescue-v1') throw new Error('$.recipe.policy must be fixed-seeded-v1 or state-aware-rescue-v1.');
  const includeSquare3 = bool(recipe.includeSquare3, '$.recipe.includeSquare3', false);
  let cursor = initialFrom(source); const sequence: PieceInstance[][] = []; const decisions: JsonRecord[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const occupied = cursor.board.cells.flat().filter(Boolean).length;
    const openShapes = [includeSquare3 ? 'square-3' : 'square-2', 'tri-h', 'line4-v'];
    const shapeIds = policy === 'state-aware-rescue-v1' && occupied >= 34
      ? ['single', 'domino-h', 'domino-v']
      : policy === 'state-aware-rescue-v1' && occupied >= 22
        ? ['single', 'tri-h', 'square-2']
        : openShapes;
    const batch = createPieceSet(seed, round, shapeIds); sequence.push(batch); decisions.push({ round, observedOccupiedCells: occupied, shapes: shapeIds });
    cursor = { ...cursor, pieces: batch, setIndex: round, fixedPieceSupply: sequence, supplyExhausted: false, status: 'playing' };
    for (let slot = 0; slot < 3; slot += 1) {
      const move = listLegalMoves(cursor)[0]; if (!move) break;
      const piece = cursor.pieces.find(item => item.id === move.pieceId)!;
      const action: PlacementAction = { id: `supply-probe-${round}-${slot}`, actor: 'agent', pieceId: move.pieceId, anchor: move.anchor, durationFrames: 1, pointerPath: authoredPointer(slot, piece, move.anchor, 1) };
      const transition = applyPlacement(cursor, action); if (!transition) break; cursor = transition.after;
    }
  }
  const edited = editProject({ project: source, recipe: { fixedSupply: sequence.map(batch => batch.map(piece => ({ shapeId: piece.shapeId, color: piece.color }))) } });
  if (!edited.ok || !edited.document) return edited;
  return { ok: true, document: edited.document, report: { operation: 'supply generate', policy: { id: policy, version: '1.0.0', stateAware: policy === 'state-aware-rescue-v1' }, seed, includeSquare3, roundsRequested: rounds, roundsMaterialized: sequence.length, sequenceHash: stableHash(sequence), reproducible: true, recordedSequence: sequence.map(batch => batch.map(piece => ({ shapeId: piece.shapeId, color: piece.color }))), decisions, invalidatedTakeIds: source.takes.map(take => take.takeId), claimBoundary: 'The sequence records this bounded policy rollout; it does not guarantee arbitrary-player survival.' } };
}

function evaluateRobustness(input: AgentOperationInput): AgentOperationResult {
  const document = validateDocument(input.project); const recipe = controls(input); const initial = initialFrom(document);
  const budget = parseAgentSearchBudget(recipe.budget, { strategies: 3, seeds: 4, maxSteps: 120 });
  const strategies = (['calm', 'rising', 'rescue'] as const).slice(0, budget.strategies);
  const seeds = deterministicSeedSeries(integer(recipe.seed, '$.recipe.seed', initial.seed, 0, 0x7fffffff), budget.seeds);
  const samples = strategies.flatMap((strategy, strategyIndex) => seeds.map((seed, seedIndex) => {
    const actions = generateActions(initial, budget.maxSteps, strategy, (strategyIndex + seedIndex + seed) % 4);
    const transitions = replayActions(initial, actions); const final = transitions.at(-1)?.after ?? initial;
    return { strategy, seed, actionCount: actions.length, survived: final.status === 'playing', finalStatus: final.status, finalScore: final.score, signature: trajectorySignature(actions.map(action => ({ pieceId: action.pieceId, anchor: action.anchor }))) };
  }));
  return { ok: true, document, report: { operation: 'robustness evaluate', budget: { ...budget, actualSamples: samples.length }, sampleSemantics: 'Each sample is one bounded deterministic strategy/selector-seed trajectory on the exact locked setup.', setupLocked: true, setupHash: stableHash(document.game), strategies, seeds, survivedSamples: samples.filter(sample => sample.survived).length, totalSamples: samples.length, survivalRate: samples.filter(sample => sample.survived).length / samples.length, arbitraryPlayerGuarantee: false }, artifact: { samples } };
}

function controlSchemaFor(id: string): JsonRecord {
  const goal = agentGoalSearchSchema(PLACEMENT_PRESSURE_METRICS);
  const schemas: Record<string, JsonRecord> = {
    'reference calibrate': { type: 'object', required: ['calibration'], properties: { calibration: { type: 'object' } }, additionalProperties: false },
    'reference effects edit': {type:'object',properties:{effects:REFERENCE_EFFECTS_SCHEMA,actions:{type:'array',maxItems:500,items:{type:'object',required:['actionId','like'],properties:{actionId:{type:'string'},like:{enum:['none','pink-cluster','blue-badge']}},additionalProperties:false}}},additionalProperties:false},
    'reference clip edit': {type:'object',required:['id','startFrame','endFrame'],properties:{id:{type:'string'},startFrame:{type:'integer',minimum:0},endFrame:{type:'integer',minimum:0}},additionalProperties:false},
    'project create': {
      type: 'object',
      properties: {
        projectId: { type: 'string' }, name: { type: 'string' }, seed: { type: 'integer', minimum: 0 },
        boardPreset: { enum: BOARD_PRESETS.map((preset) => preset.id) }, board: { type: 'object' },
        pieces: { type: 'array', minItems: 3, maxItems: 3 }, fixedSupply: { type: 'array', minItems: 1, maxItems: 500 },
        includeSquare3: { type: 'boolean' },
        clearAxes: { type: 'string', enum: ['rows','columns','both'] }, clearTrigger: { type: 'string', enum: ['line-complete','board-full'] }, referenceClearRules: { type:'array', maxItems:500, items:{type:'object',required:['turn'],properties:{turn:{type:'integer',minimum:0,maximum:499},axes:{enum:['rows','columns','both']},trigger:{enum:['line-complete','board-full']}},additionalProperties:false} },
        initialUsedSlots: { type: 'array', maxItems: 2, uniqueItems: true, items: { type: 'integer', minimum: 0, maximum: 2 } },
        width: { type: 'integer' }, height: { type: 'integer' }, fps: { type: 'integer' },
      },
      additionalProperties: false,
    },
    'project edit': {
      type: 'object', properties: { clearAxes: { type: 'string', enum: ['rows','columns','both'] }, clearTrigger: { type: 'string', enum: ['line-complete','board-full'] }, referenceClearRules: { type:'array', maxItems:500, items:{type:'object',required:['turn'],properties:{turn:{type:'integer',minimum:0,maximum:499},axes:{enum:['rows','columns','both']},trigger:{enum:['line-complete','board-full']}},additionalProperties:false} }, board: { type: 'object' }, pieces: { type: 'array', minItems: 3, maxItems: 3 }, fixedSupply: { type: 'array', minItems: 1, maxItems: 500 }, supplyMode: { enum: ['seeded', 'fixed'] }, cells: { type: 'array', items: { type: 'object', required: ['row', 'col', 'color'] } } },
      anyOf: [{ required: ['referenceClearRules'] }, { required: ['clearTrigger'] }, { required: ['clearAxes'] }, { required: ['board'] }, { required: ['pieces'] }, { required: ['fixedSupply'] }, { required: ['supplyMode'] }, { required: ['cells'] }], additionalProperties: false,
    },
    'layout edit': {
      type: 'object', properties: { board: { type: 'object' }, cells: { type: 'array', items: { type: 'object', required: ['row', 'col', 'color'] } } },
      anyOf: [{ required: ['board'] }, { required: ['cells'] }], additionalProperties: false,
    },
    'supply edit': {
      type: 'object', properties: { pieces: { type: 'array', minItems: 3, maxItems: 3 }, fixedSupply: { type: 'array', minItems: 1, maxItems: 500 }, supplyMode: { enum: ['seeded', 'fixed'] } },
      anyOf: [{ required: ['pieces'] }, { required: ['fixedSupply'] }, { properties: { supplyMode: { const: 'seeded' } }, required: ['supplyMode'] }], additionalProperties: false,
    },
    'take generate': {
      type: 'object', properties: { takeId: { type: 'string' }, targetDurationSeconds: { type: 'number', minimum: 4, maximum: 600 }, maximumActions: { type: 'integer', minimum: 1, maximum: 500 }, story: { enum: ['calm', 'rising', 'rescue'] } }, additionalProperties: false,
    },
    'take import': {
      type: 'object', required: ['actions'], properties: { takeId: { type: 'string' }, actions: { type: 'array', minItems: 0, maxItems: 500, items: { type: 'object', required: ['pieceId', 'anchor'] } } }, additionalProperties: false,
    },
    'take validate': { type: 'object', properties: { takeId: { type: 'string' } }, additionalProperties: false },
    'director retime': { type: 'object', required: ['targetDurationSeconds'], properties: { takeId: { type: 'string' }, targetDurationSeconds: { type: 'number', minimum: 1, maximum: 600 } }, additionalProperties: false },
    'look apply': { type: 'object', required: ['lookId'], properties: { lookId: { enum: Object.keys(LOOK_CATALOG) } }, additionalProperties: false },
    'praise edit': { type: 'object', required: ['words'], properties: { words: PRAISE_WORD_MAP_SCHEMA }, additionalProperties: false },
    'theme apply': { type: 'object', required: ['themeId'], properties: { themeId: { enum: [...MATERIAL_THEME_IDS] }, cellGapPx: { type: 'number', minimum: 0, maximum: 8 } }, additionalProperties: false },
    'look inspect': { type: 'object', additionalProperties: false },
    'rhythm apply': { type: 'object', required: ['rhythmId'], properties: { rhythmId: { enum: Object.keys(RHYTHM_PRESETS) } }, additionalProperties: false },
    'rhythm inspect': { type: 'object', additionalProperties: false },
    'production validate': { type: 'object', properties: { takeId: { type: 'string' }, targetDurationSeconds: { type: 'number', minimum: 1, maximum: 600 } }, additionalProperties: false },
    'author': {
      type: 'object',
      properties: {
        projectId: { type: 'string' }, name: { type: 'string' }, seed: { type: 'integer', minimum: 0 },
        boardPreset: { enum: BOARD_PRESETS.map((preset) => preset.id) }, board: { type: 'object' },
        pieces: { type: 'array', minItems: 3, maxItems: 3 }, fixedSupply: { type: 'array', minItems: 1, maxItems: 500 },
        includeSquare3: { type: 'boolean' },
        width: { type: 'integer' }, height: { type: 'integer' }, fps: { type: 'integer' },
        lookId: { enum: Object.keys(LOOK_CATALOG) }, rhythmId: { enum: Object.keys(RHYTHM_PRESETS) },
        takeId: { type: 'string' }, targetDurationSeconds: { type: 'number', minimum: 4, maximum: 600 },
        maximumActions: { type: 'integer', minimum: 1, maximum: 500 }, story: { enum: ['calm', 'rising', 'rescue'] },
      },
      additionalProperties: false,
    },
    'plan compile': { type: 'object', properties: { takeId: { type: 'string' } }, additionalProperties: false },
    'survival check': { type: 'object', properties: { takeId: { type: 'string' }, targetDurationSeconds: { type: 'number', minimum: 1, maximum: 600 } }, additionalProperties: false },
    'candidate search': { type: 'object', properties: { takeId: { type: 'string' }, targetDurationSeconds: { type: 'number', minimum: 0, maximum: 600 }, stories: { type: 'array', items: { enum: ['calm', 'rising', 'rescue'] }, minItems: 1, maxItems: 3 }, ...goal }, additionalProperties: false },
    'quality route': { type: 'object', properties: {
      takeId: { type: 'string' }, initializer: { enum: ['adaptive', 'cascade', 'existing'] }, supplyMode: { enum: ['adaptive', 'fixed', 'seeded'] }, seed: { type: 'integer', minimum: 0 },
      targetDurationSeconds: { type: 'number', minimum: 4, maximum: 600 }, supplyRounds: { type: 'integer', minimum: 4, maximum: 160 },
      minActions: { type: 'integer', minimum: 1, maximum: 500 }, minClearEvents: { type: 'integer', minimum: 1, maximum: 500 },
      minClearRatio: { type: 'number', minimum: 0, maximum: 1 }, minTripleLineSegments: { type: 'integer', minimum: 1, maximum: 3 },
      minTripleLineEvents: { type: 'integer', minimum: 0, maximum: 100 }, minConsecutiveClearStreak: { type: 'integer', minimum: 1, maximum: 100 },
      maxNoClearSteps: { type: 'integer', minimum: 0, maximum: 100 }, minIntermediateBoardCells: { type: 'integer', minimum: 0, maximum: 64 },
      initializerCandidates: { type: 'integer', minimum: 1, maximum: 32 }, beamWidth: { type: 'integer', minimum: 1, maximum: 256 },
      branchWidth: { type: 'integer', minimum: 1, maximum: 96 }, actionDurationFrames: { type: 'integer', minimum: 1, maximum: 10000 },
    }, additionalProperties: false },
    'take alternative': { type: 'object', properties: { takeId: { type: 'string' }, newTakeId: { type: 'string' }, budget: goal.budget }, additionalProperties: false },
    'take edit': { type: 'object', required: ['newTakeId', 'at', 'actions'], properties: { takeId: { type: 'string' }, newTakeId: { type: 'string' }, at: { type: 'integer', minimum: 0 }, deleteCount: { type: 'integer', minimum: 0 }, actions: { type: 'array', maxItems: 500 } }, additionalProperties: false },
    'take clone': { type: 'object', required: ['newTakeId'], properties: { takeId: { type: 'string' }, newTakeId: { type: 'string' } }, additionalProperties: false },
    'take select': { type: 'object', required: ['takeId'], properties: { takeId: { type: 'string' } }, additionalProperties: false },
    'take delete': { type: 'object', required: ['takeId'], properties: { takeId: { type: 'string' } }, additionalProperties: false },
    'take replay': { type: 'object', properties: { takeId: { type: 'string' } }, additionalProperties: false },
    'supply generate': { type: 'object', properties: { policy: { enum: ['fixed-seeded-v1', 'state-aware-rescue-v1'] }, seed: { type: 'integer', minimum: 0 }, rounds: { type: 'integer', minimum: 1, maximum: 160 }, includeSquare3: { type: 'boolean' } }, additionalProperties: false },
    'robustness evaluate': { type: 'object', properties: { seed: { type: 'integer', minimum: 0 }, budget: goal.budget }, additionalProperties: false },
  };
  return schemas[id] ?? { type: 'object', additionalProperties: false };
}

function exampleFor(id: string): JsonRecord {
  if (id === 'project create') return { options: { projectId: 'placement-60s', seed: 41782, boardPreset: 'empty' } };
  if (id === 'take generate') return { project: {}, options: { takeId: 'continuous-60s', targetDurationSeconds: 60, story: 'calm' } };
  if (id === 'take import') return { project: {}, options: { takeId: 'external', actions: [{ pieceId: 'piece-0-0-single', anchor: { row: 0, col: 0 } }] } };
  if (id === 'director retime') return { project: {}, options: { takeId: 'continuous-60s', targetDurationSeconds: 45 } };
  if (id === 'look apply') return { project: {}, options: { lookId: 'classic-blast' } };
  if (id === 'theme apply') return { project: {}, options: { themeId: 'watermelon', cellGapPx: 0.75 } };
  if (id === 'look inspect') return { project: {} };
  if (id === 'rhythm apply') return { project: {}, options: { rhythmId: 'human-natural' } };
  if (id === 'production validate') return { project: {}, options: { takeId: 'continuous-60s', targetDurationSeconds: 60 } };
  if (id === 'author') return { options: { projectId: 'placement-60s', seed: 41782, boardPreset: 'empty', lookId: 'classic-blast', rhythmId: 'human-natural', takeId: 'continuous-60s', targetDurationSeconds: 60, story: 'calm' } };
  if (id === 'survival check') return { project: {}, options: { takeId: 'continuous-60s', targetDurationSeconds: 60 } };
  if (id === 'candidate search') return { project: {}, options: { takeId: 'tension-rescue', stories: ['rescue'], budget: { candidates: 6, maxSteps: 120 }, pressureStages: [{ id: 'tension', from: 0.1, to: 0.55, metric: 'occupiedCells', minimum: 16 }, { id: 'rescue', from: 0.55, to: 1, metric: 'legalMoves', minimum: 1 }] } };
  if (id === 'quality route') return { project: {}, options: { takeId: 'quality-30s', initializer: 'adaptive', supplyMode: 'adaptive', targetDurationSeconds: 30, minClearRatio: 0.55, minTripleLineEvents: 4, minTripleLineSegments: 2, minConsecutiveClearStreak: 3, maxNoClearSteps: 1, minIntermediateBoardCells: 14 } };
  if (id === 'take alternative') return { project: {}, options: { takeId: 'source', newTakeId: 'alternative', budget: { candidates: 8, maxSteps: 120 } } };
  if (id === 'take edit') return { project: {}, options: { takeId: 'source', newTakeId: 'edited', at: 2, deleteCount: 1, actions: [{ pieceId: 'piece-0-2-single', anchor: { row: 2, col: 2 } }] } };
  if (id === 'supply generate') return { project: {}, options: { policy: 'state-aware-rescue-v1', seed: 41782, rounds: 24 } };
  if (id === 'robustness evaluate') return { project: {}, options: { budget: { strategies: 3, seeds: 4, maxSteps: 120 } } };
  return id === 'catalog get' ? {} : { project: {} };
}

function inputSchemaFor(id: string, requires: string[]): JsonRecord {
  const controlSchema = controlSchemaFor(id);
  const schema: JsonRecord = {
    type: 'object',
    properties: { project: { type: 'object' }, recipe: controlSchema, options: controlSchema },
    additionalProperties: false,
    examples: [exampleFor(id)],
  };
  if (requires.includes('project')) schema.required = ['project'];
  if (requires.some((item) => item === 'options' || item.startsWith('options.'))) {
    schema.anyOf = [{ required: ['options'] }, { required: ['recipe'] }];
  }
  return schema;
}

function operation(
  contract: Omit<GameAgentOperation, 'version' | 'inputSchema' | 'outputSchema' | 'execute'>,
  execute: (input: AgentOperationInput) => AgentOperationResult,
): GameAgentOperation {
  return {
    ...contract,
    version: '1.0.0',
    inputSchema: inputSchemaFor(contract.id, contract.requires),
    outputSchema: AGENT_RESULT_SCHEMA,
    execute: safe(execute),
  };
}

export const blockPlacementAgentAdapter: GameAgentAdapter = {
  gameId: BLOCK_PLACEMENT_GAME_ID,
  version: '1.0.0',
  aliases: ['block', 'block-placement-classic'],
  operations: [
    operation({ id: 'reference calibrate', title: 'Calibrate reference timing and layout', description: 'Bind measured release times, board geometry and HUD score observations to a validated Take. Used by the calibrated SDK renderer; never changes game rules.', kind: 'edit', requires: ['project', 'options'], preserves: ['game', 'takes'], invalidates: ['render-artifacts'] }, calibrateReference),
    operation({id:'reference effects edit',title:'Edit reference feedback effects',description:'Configure like icons, butterfly rim, rack glow, rolling score/diamond pulse, Perfect confetti, layered Combo and clear polish. Merge only supplied sections; authored cues bind to existing action IDs.',kind:'edit',requires:['project','options'],preserves:['game','takes','production','audio','reference-timing'],invalidates:['render-artifacts']},editReferenceEffects),
    operation({id:'reference clip edit',title:'Clip a calibrated reference replay',description:'Create a frame-bound sample using the calibrated timeline and exact Take identity; preserves the complete editable project and source timing.',kind:'edit',requires:['project','options'],preserves:['game','takes','reference-timing','audio'],invalidates:['render-artifacts']},editReferenceClip),
    operation({ id: 'catalog get', title: 'Get catalog', description: 'List supported board, supply, story, look, rhythm, asset slots, and composed workflows.', kind: 'query', requires: [], preserves: [], invalidates: [] }, getCatalog),
    operation({ id: 'project create', title: 'Create project', description: 'Create a deterministic V2 block-placement project with an authored board and initial supply.', kind: 'edit', requires: [], preserves: [], invalidates: [] }, createProject),
    operation({ id: 'project inspect', title: 'Inspect project', description: 'Summarize setup, Takes, direction, and production identities.', kind: 'query', requires: ['project'], preserves: ['project'], invalidates: [] }, inspectProject),
    operation({ id: 'project validate', title: 'Validate project', description: 'Validate the V2 envelope, game schemas, and every complete Take.', kind: 'query', requires: ['project'], preserves: ['project'], invalidates: [] }, validateProject),
    operation({ id: 'project edit', title: 'Edit setup', description: 'Edit board cells or initial supply and invalidate setup-dependent Takes.', kind: 'edit', requires: ['project', 'options'], preserves: ['production', 'direction'], invalidates: ['takes', 'compiled-plans', 'survival-evidence'] }, editProject),
    operation({ id: 'layout edit', title: 'Edit layout', description: 'Edit only the authored board while preserving the initial piece supply.', kind: 'edit', requires: ['project', 'options'], preserves: ['game.config.pieces', 'production', 'direction'], invalidates: ['takes', 'compiled-plans', 'survival-evidence'] }, editLayout),
    operation({ id: 'supply edit', title: 'Edit supply', description: 'Edit only seeded or fixed three-piece supply while preserving the authored board.', kind: 'edit', requires: ['project', 'options'], preserves: ['game.config.board', 'production', 'direction'], invalidates: ['takes', 'compiled-plans', 'survival-evidence'] }, editSupply),
    operation({ id: 'take generate', title: 'Generate Take', description: 'Author a deterministic legal trajectory with active presentation coverage.', kind: 'workflow', requires: ['project'], preserves: ['game.initialState', 'production', 'direction', 'existing-takes'], invalidates: ['compiled-plans', 'survival-evidence'] }, generateTake),
    operation({ id: 'take import', title: 'Import Take', description: 'Import exactly the supplied actions after full sequential legality validation.', kind: 'edit', requires: ['project', 'options.actions'], preserves: ['game.initialState', 'production', 'direction', 'existing-takes'], invalidates: ['compiled-plans', 'survival-evidence'] }, importTake),
    operation({ id: 'take validate', title: 'Validate Take', description: 'Replay and report every supplied rule action without substitution.', kind: 'query', requires: ['project'], preserves: ['project'], invalidates: [] }, validateTake),
    operation({ id: 'director retime', title: 'Retime direction', description: 'Change presentation speed while preserving rule actions and game state.', kind: 'edit', requires: ['project', 'options.targetDurationSeconds'], preserves: ['game', 'takes', 'production', 'direction.style'], invalidates: ['compiled-plans', 'render-artifacts', 'frame-coordinate-cuts'] }, retimeDirector),
    operation({ id: 'look apply', title: 'Apply look', description: 'Apply a cataloged renderer-consumed style and its matching identity.', kind: 'edit', requires: ['project', 'options.lookId'], preserves: ['game', 'takes', 'direction.rhythm', 'production.layoutProfileRef', 'production.cameraProfileRef', 'production.output', 'agentAssets'], invalidates: ['render-artifacts', 'visual-previews'] }, applyLook),
    operation({ id: 'theme apply', title: 'Apply coordinated material theme', description: 'Coordinate stage and board colors and visible tile seams, preserving the bound tile material and gameplay.', kind: 'edit', requires: ['project','options.themeId'], preserves: ['game','takes','direction.rhythm','agentAssets','production'], invalidates: ['render-artifacts','visual-previews'] }, applyMaterialTheme),
    operation({ id: 'look inspect', title: 'Inspect look', description: 'Report the current look, face-image slots, and deferred visual modes without changing the project.', kind: 'query', requires: ['project'], preserves: ['project'], invalidates: [] }, inspectLook),
    operation({ id: 'praise edit', title: 'Edit praise vocabulary', description: 'Map existing praise tiers to matching visual words and voice events without changing gameplay or timing.', kind: 'edit', requires: ['project', 'options.words'], preserves: ['game', 'takes', 'production', 'direction.rhythm'], invalidates: ['compiled-plans', 'render-artifacts', 'audio-mix'] }, editPraise),
    operation({ id: 'rhythm apply', title: 'Apply rhythm', description: 'Replace presentation rhythm with a cataloged preset while preserving rules, Takes, and look.', kind: 'edit', requires: ['project', 'options.rhythmId'], preserves: ['game', 'takes', 'production', 'direction.style'], invalidates: ['compiled-plans', 'render-artifacts', 'frame-coordinate-cuts'] }, applyRhythm),
    operation({ id: 'rhythm inspect', title: 'Inspect rhythm', description: 'Report the current rhythm profile and cataloged presets without changing the project.', kind: 'query', requires: ['project'], preserves: ['project'], invalidates: [] }, inspectRhythm),
    operation({ id: 'plan compile', title: 'Compile plan', description: 'Compile the native block-placement presentation plan without rendering video.', kind: 'workflow', requires: ['project'], preserves: ['project'], invalidates: [] }, compilePlan),
    operation({ id: 'survival check', title: 'Check survival', description: 'Verify presentation coverage and full rule replay as separate evidence.', kind: 'query', requires: ['project'], preserves: ['project'], invalidates: [] }, checkSurvival),
    operation({ id: 'candidate search', title: 'Search conditional candidates', description: 'Run bounded native candidate search and review explicit custom pressure-stage targets.', kind: 'workflow', requires: ['project'], preserves: ['game.initialState', 'production', 'direction', 'existing-takes'], invalidates: ['compiled-plans'] }, candidateSearch),
    operation({ id: 'quality route', title: 'Plan quality route', description: 'Jointly search a seed-varied initializer, each real three-piece supply round, and a native legal trajectory for sustained and multi-line clears.', kind: 'workflow', requires: ['project'], preserves: ['production', 'direction'], invalidates: ['takes', 'compiled-plans', 'survival-evidence', 'render-artifacts'] }, qualityRoute),
    operation({ id: 'take alternative', title: 'Search alternative Take', description: 'Search a semantically different trajectory on the exact LOCKED setup and report exhaustion.', kind: 'workflow', requires: ['project'], preserves: ['game', 'production', 'direction', 'existing-takes'], invalidates: ['compiled-plans'] }, alternativeTake),
    operation({ id: 'take edit', title: 'Edit Take splice', description: 'Create a new Take from an exact splice and replay every resulting action.', kind: 'edit', requires: ['project', 'options'], preserves: ['game', 'production', 'direction', 'existing-takes'], invalidates: ['compiled-plans', 'frame-bound-cuts'] }, editTake),
    operation({ id: 'take clone', title: 'Clone Take', description: 'Clone a Take under a new exact ID without inheriting frame-bound cuts.', kind: 'edit', requires: ['project', 'options'], preserves: ['game', 'production', 'direction', 'existing-takes'], invalidates: ['frame-bound-cuts'] }, cloneTake),
    operation({ id: 'take select', title: 'Select Take', description: 'Select by moving the exact Take to the default first position.', kind: 'edit', requires: ['project', 'options'], preserves: ['game', 'take-actions', 'production', 'direction'], invalidates: [] }, selectTake),
    operation({ id: 'take delete', title: 'Delete Take', description: 'Delete exactly one Take and report downstream cut staleness.', kind: 'edit', requires: ['project', 'options'], preserves: ['game', 'other-takes', 'production', 'direction'], invalidates: ['deleted-take-cuts'] }, deleteTake),
    operation({ id: 'take replay', title: 'Inspect stepwise replay', description: 'Return every native post-resolution state hash, event, and pressure metric.', kind: 'query', requires: ['project'], preserves: ['project'], invalidates: [] }, replayTakeSteps),
    operation({ id: 'supply generate', title: 'Materialize supply policy', description: 'Run a versioned fixed or state-aware supply policy and store its exact deterministic sequence.', kind: 'workflow', requires: ['project'], preserves: ['board', 'production', 'direction'], invalidates: ['takes', 'compiled-plans'] }, generateSupply),
    operation({ id: 'robustness evaluate', title: 'Evaluate bounded robustness', description: 'Evaluate declared strategy and selector-seed samples without extrapolating to arbitrary players.', kind: 'query', requires: ['project'], preserves: ['project'], invalidates: [] }, evaluateRobustness),
    operation({ id: 'production validate', title: 'Validate production', description: 'Check schema, Take legality, survival coverage, look identity, and assets without encoding video.', kind: 'query', requires: ['project'], preserves: ['project'], invalidates: [] }, validateProduction),
    operation({ id: 'author', title: 'Author playable project', description: 'Compose project create, optional look and rhythm, Take generation, and production validation. Does not encode video.', kind: 'workflow', requires: [], preserves: [], invalidates: [] }, author),
  ],
};
