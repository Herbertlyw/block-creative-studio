import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '.core-dist');
const tsc = resolve(root, 'node_modules', 'typescript', 'bin', 'tsc');
rmSync(output, { recursive: true, force: true });
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.core.json', '--pretty', 'false'], {
  cwd: root,
  stdio: 'inherit',
});
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'package.json'), '{"type":"commonjs"}\n');

const require = createRequire(import.meta.url);
const { createCrossClearBoard, createEmptyBoard } = require(resolve(output, 'domain/boardPresets.js'));
const {
  applyPlacement,
  boardFingerprint,
  canPlace,
  chooseGreedyMove,
  createGame,
  createPieceSet,
  pieceCellColor,
  replayActions,
  replacePieceShape,
} = require(resolve(output, 'domain/gameEngine.js'));
const { compileTake, evaluateCompiledTake } = require(resolve(output, 'director/presentationCompiler.js'));
const { RHYTHM_PRESETS } = require(resolve(output, 'director/rhythmPresets.js'));
const { parseStudioBundle } = require(resolve(output, 'domain/projectValidation.js'));

const assert = (condition, message) => {
  if (!condition) throw new Error(`Core check failed: ${message}`);
};
const assertThrows = (operation, message, pattern) => {
  let thrown = null;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, message);
  if (pattern) {
    assert(pattern.test(thrown instanceof Error ? thrown.message : String(thrown)), `${message} (unexpected error)`);
  }
};
const makeAction = (pieceId, row, col, actor = 'human') => ({
  id: `${actor}-${pieceId}-${row}-${col}`,
  actor,
  pieceId,
  anchor: { row, col },
  durationFrames: 16,
  pointerPath: [],
});

const crossPieces = createPieceSet(41782, 0, ['single', 'tri-h', 'square-2']);
const crossInitial = createGame(createCrossClearBoard(), 41782, crossPieces);
const cross = applyPlacement(crossInitial, makeAction(crossPieces[0].id, 5, 4));
assert(cross, 'single tile should complete a cross clear');
assert(cross.clear.rows.length === 1, 'exactly one row should clear');
assert(cross.clear.cols.length === 1, 'exactly one column should clear');
assert(cross.clear.cells.length === 15, 'cross intersection must only be counted once');

const occupiedBoard = createEmptyBoard();
occupiedBoard.cells[0][0] = 'coral';
const occupiedPieces = createPieceSet(2, 0, ['single', 'single', 'single']);
const occupiedGame = createGame(occupiedBoard, 2, occupiedPieces);
assert(!canPlace(occupiedGame.board, occupiedGame.pieces[0], { row: 0, col: 0 }), 'overlap must be rejected');
assert(
  applyPlacement(occupiedGame, makeAction(occupiedGame.pieces[0].id, 0, 0)) === null,
  'an invalid placement must not produce a transition',
);

const multiColorPieces = createPieceSet(44, 0, ['tri-h', 'single', 'single']);
multiColorPieces[0].cellColors = ['coral', 'lime', 'blue'];
const multiColorInitial = createGame(createEmptyBoard(), 44, multiColorPieces);
const multiColorTransition = applyPlacement(
  multiColorInitial,
  makeAction(multiColorPieces[0].id, 2, 2),
);
assert(multiColorTransition, 'multi-color candidate must place');
assert(multiColorTransition.placedBoard.cells[2][2] === 'coral', 'first per-cell color must be preserved');
assert(multiColorTransition.placedBoard.cells[2][3] === 'lime', 'second per-cell color must be preserved');
assert(multiColorTransition.placedBoard.cells[2][4] === 'blue', 'third per-cell color must be preserved');
assert(pieceCellColor(multiColorPieces[0], 1) === 'lime', 'pieceCellColor must resolve per-cell overrides');

let refreshGame = createGame(createEmptyBoard(), 9, createPieceSet(9, 0, ['single', 'single', 'single']));
for (let slot = 0; slot < 3; slot += 1) {
  const piece = refreshGame.pieces.find((candidate) => candidate.slotIndex === slot);
  assert(piece, `piece slot ${slot} must exist before refresh`);
  const transition = applyPlacement(refreshGame, makeAction(piece.id, 0, slot));
  assert(transition, `single piece ${slot} must place during refresh check`);
  refreshGame = transition.after;
}
assert(refreshGame.setIndex === 1, 'using all three pieces must refresh the tray');
assert(
  refreshGame.pieces.every((piece) => !piece.used && piece.setIndex === 1),
  'refreshed pieces must be unused and versioned by set index',
);

const fullBoard = createEmptyBoard();
for (const row of fullBoard.cells) row.fill('blue');
const terminalGame = createGame(fullBoard, 3, createPieceSet(3, 0, ['single', 'single', 'single']));
assert(terminalGame.status === 'game-over', 'a board with no legal move must start in game-over');

const deterministicPieces = createPieceSet(21, 0, ['single', 'domino-h', 'tri-v']);
const initial = createGame(createEmptyBoard(), 21, deterministicPieces);
const moveOne = chooseGreedyMove(initial);
assert(moveOne, 'machine player should find a legal first action');
const actionOne = makeAction(moveOne.pieceId, moveOne.anchor.row, moveOne.anchor.col, 'agent');
const transitionOne = applyPlacement(initial, actionOne);
assert(transitionOne, 'first machine action must be legal');
const moveTwo = chooseGreedyMove(transitionOne.after);
assert(moveTwo, 'machine player should find a legal second action');
const actionTwo = makeAction(moveTwo.pieceId, moveTwo.anchor.row, moveTwo.anchor.col, 'agent');
const replayed = replayActions(initial, [actionOne, actionTwo]);
const direct = applyPlacement(transitionOne.after, actionTwo);
assert(direct, 'second machine action must be legal');
assert(
  boardFingerprint(replayed[1].after.board) === boardFingerprint(direct.after.board),
  'semantic replay must be deterministic',
);

const take = {
  id: 'smoke-take',
  name: 'Smoke Take',
  createdAt: '2026-09-01T00:00:00.000Z',
  initial: crossInitial,
  actions: [makeAction(crossPieces[0].id, 5, 4)],
};
const rhythm = RHYTHM_PRESETS['tight-fast'];
const compiled = compileTake(take, rhythm, 30);
const clearAction = compiled.actions[0];
assert(clearAction, 'compiled take must contain the source action');
const activeClear = evaluateCompiledTake(
  compiled,
  Math.round((clearAction.clearStartFrame + clearAction.clearEndFrame) / 2),
  rhythm,
);
assert(activeClear.clearing, 'frame evaluator must expose the active clear interval');
const placementFeedback = evaluateCompiledTake(compiled, clearAction.releaseFrame + 1, rhythm);
assert(placementFeedback.placementFeedback, 'placement settle must expose cell feedback');
assert(
  placementFeedback.placementFeedback.cells.length === 1 && placementFeedback.snapshot.score >= 1,
  'placement feedback must carry placed cells and stepped score state',
);
assert(
  clearAction.endFrame - clearAction.clearEndFrame ===
    Math.max(1, Math.round(rhythm.cameraRecoveryFrames / rhythm.globalSpeed)),
  'compiled clear actions must reserve the configured camera recovery interval',
);
assert(compiled.totalFrames > clearAction.endFrame, 'compiled take must contain an ending hold');
const remappedLastSample = clearAction.action.pointerPath.at(-1);
assert(
  !remappedLastSample || remappedLastSample.frameOffset <= clearAction.action.durationFrames,
  'directed pointer samples must remain inside the remapped drag duration',
);
const finalFrame = evaluateCompiledTake(compiled, compiled.totalFrames - 1, rhythm);
assert(finalFrame.totalFrames === compiled.totalFrames, 'presentation frames must carry the total frame count');

const sequentialPieces = createPieceSet(11, 0, ['single', 'single', 'single']);
const sequentialInitial = createGame(createEmptyBoard(), 11, sequentialPieces);
const sequentialTake = {
  id: 'sequential-take',
  name: 'Sequential Take',
  createdAt: '2026-09-01T00:00:00.000Z',
  initial: sequentialInitial,
  actions: [
    makeAction(sequentialPieces[0].id, 0, 0),
    makeAction(sequentialPieces[1].id, 0, 1),
  ],
};
const sequentialCompiled = compileTake(sequentialTake, RHYTHM_PRESETS['human-natural'], 30);
const sequentialSecond = sequentialCompiled.actions[1];
assert(sequentialSecond, 'compiled take must include the second non-clearing action');
const duringSequentialSecond = evaluateCompiledTake(
  sequentialCompiled,
  sequentialSecond.startFrame + 2,
  RHYTHM_PRESETS['human-natural'],
);
assert(
  duringSequentialSecond.draggedPiece?.piece.id === sequentialPieces[1].id,
  'frame evaluator must advance beyond a non-clearing placement',
);
const sequentialFinal = evaluateCompiledTake(
  sequentialCompiled,
  sequentialCompiled.totalFrames - 1,
  RHYTHM_PRESETS['human-natural'],
);
assert(sequentialFinal.snapshot.turn === 2, 'later non-clearing actions must reach the final frame');

for (let seed = 0; seed < 12; seed += 1) {
  const fuzzInitial = createGame(createEmptyBoard(), seed, createPieceSet(seed, 0));
  const actions = [];
  let cursor = fuzzInitial;
  for (let step = 0; step < 18 && cursor.status === 'playing'; step += 1) {
    const move = chooseGreedyMove(cursor);
    if (!move) break;
    const nextAction = makeAction(move.pieceId, move.anchor.row, move.anchor.col, 'agent');
    nextAction.id = `fuzz-${seed}-${step}`;
    const transition = applyPlacement(cursor, nextAction);
    assert(transition, `seed ${seed} step ${step} must stay legal`);
    actions.push(nextAction);
    cursor = transition.after;
  }
  const fuzzTransitions = replayActions(fuzzInitial, actions);
  const fuzzFinal = fuzzTransitions.at(-1)?.after ?? fuzzInitial;
  assert(
    boardFingerprint(fuzzFinal.board) === boardFingerprint(cursor.board) &&
      fuzzFinal.score === cursor.score &&
      fuzzFinal.turn === cursor.turn,
    `seed ${seed} replay must match direct simulation`,
  );
}

const paletteFingerprints = new Set(
  ['coral', 'amber', 'lime', 'cyan', 'blue', 'violet', 'rose'].map((color) => {
    const board = createEmptyBoard();
    board.cells[0][0] = color;
    return boardFingerprint(board);
  }),
);
assert(
  paletteFingerprints.size === 7,
  'board fingerprints must not collide across palette colors',
);

const indexedPieces = createPieceSet(13, 4, ['single', 'domino-h', 'tri-v']);
const indexedGame = createGame(createEmptyBoard(), 13, indexedPieces);
assert(indexedGame.setIndex === 4, 'createGame must preserve the candidate set index');
const reshaped = replacePieceShape(indexedPieces, 0, 'square-2');
assert(reshaped[0].id === 'piece-4-0-square-2', 'piece ids must stay deterministic after shape edits');

const project = {
  schemaVersion: '1.0.0',
  id: 'core-check-project',
  name: 'Core Check Project',
  ruleProfile: 'block-placement-classic-v1',
  seed: 41782,
  setupBoard: createCrossClearBoard(),
  setupPieces: crossPieces,
  style: {
    material: 'candy-resin',
    lighting: 'soft-candy',
    camera: 'premium-perspective',
    fx: 'crystal-shatter',
    geometry: { id: 'premium-beveled', depth: 0.42, bevel: 0.14, gap: 0.08 },
    background: '#101a35',
    showPointer: true,
  },
  rhythm,
  render: { width: 1080, height: 1920, fps: 30, quality: 'standard' },
};
const bundle = {
  format: 'block-creative-studio-project',
  version: '1.0.0',
  project,
  takes: [take],
};
parseStudioBundle(bundle);
const mismatchedBundle = structuredClone(bundle);
mismatchedBundle.takes[0].initial.pieces[0].color = 'violet';
assertThrows(
  () => parseStudioBundle(mismatchedBundle),
  'project validation must reject stale Take setup state',
  /初始牌面、候选块/u,
);

const invalidPointerBundle = structuredClone(bundle);
invalidPointerBundle.takes[0].actions[0].pointerPath = [
  { frameOffset: 0, x: 0.5, y: 0.8 },
  { frameOffset: 17, x: 0.5, y: 0.4 },
];
assertThrows(
  () => parseStudioBundle(invalidPointerBundle),
  'project validation must reject pointer samples beyond action duration',
  /durationFrames/u,
);

const oddRenderBundle = structuredClone(bundle);
oddRenderBundle.project.render.width = 1079;
assertThrows(
  () => parseStudioBundle(oddRenderBundle),
  'project validation must reject odd H.264 dimensions',
  /偶数/u,
);

const duplicateTakeBundle = structuredClone(bundle);
duplicateTakeBundle.takes.push(structuredClone(duplicateTakeBundle.takes[0]));
assertThrows(
  () => parseStudioBundle(duplicateTakeBundle),
  'project validation must reject duplicate take ids',
  /take id/u,
);
const exampleBundle = JSON.parse(
  readFileSync(resolve(root, 'examples/demo-cross-clear.block-creative.json'), 'utf8'),
);
parseStudioBundle(exampleBundle);

console.log('✓ 8×8 placement, per-cell colors, overlap rejection and simultaneous row/column clear');
console.log('✓ three-piece tray refresh and terminal game-over detection');
console.log('✓ deterministic piece generation, set indexes, ids, and machine-player action API');
console.log('✓ semantic Replay reproduces the same board state');
console.log('✓ Raw Take advances across non-clearing actions, placement feedback, and fixed-frame clear intervals');
console.log('✓ 12 deterministic multi-step simulations replay without state drift');
console.log('✓ project import rejects stale Takes, invalid trajectories, odd H.264 sizes, and duplicate ids');
console.log('✓ committed example project passes runtime validation');
