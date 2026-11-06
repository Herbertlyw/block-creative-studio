// Run from the public repository root after npm ci.
// This is a generated fixture: its observations are authored below, not inferred from video.
import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const server = await createServer({
  server: { middlewareMode: true, ws: false },
  appType: 'custom',
});
try {
  const { blockPlacementAgentAdapter } = await server.ssrLoadModule(
    '/src/nativeReference/games/block-placement/agent/index.ts',
  );
  const { inspectNativeRuntime } = await server.ssrLoadModule(
    '/src/contracts/inspectNativeRuntime.ts',
  );
  const { prepareCalibratedRenderer } = await server.ssrLoadModule(
    '/src/contracts/calibratedRenderer.ts',
  );
  const run = async (id, input) => {
    const operation = blockPlacementAgentAdapter.operations.find((item) => item.id === id);
    if (!operation) throw new Error(`Operation unavailable: ${id}`);
    const result = await operation.execute(input);
    if (!result.ok || !result.document) throw new Error(JSON.stringify(result.report));
    return result;
  };

  const cells = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let col = 0; col < 7; col++) cells[0][col] = 'blue';
  const created = await run('project create', {
    options: {
      projectId: 'bb-demo-observed',
      name: 'BB synthetic observed',
      seed: 42,
      board: { rows: 8, cols: 8, cells },
      fixedSupply: [
        [
          { shapeId: 'single', color: 'blue' },
          { shapeId: 'single', color: 'coral' },
          { shapeId: 'single', color: 'lime' },
        ],
      ],
      width: 512,
      height: 864,
      fps: 30,
    },
  });
  const pieces = created.document.game.initialState.data.pieces;
  const anchors = [
    { row: 0, col: 7 },
    { row: 1, col: 1 },
    { row: 1, col: 2 },
  ];
  const actions = pieces.map((piece, index) => ({
    id: `observed-${index + 1}`,
    actor: 'human',
    pieceId: piece.id,
    anchor: anchors[index],
    durationFrames: 15,
    pointerPath: [],
  }));
  const imported = await run('take import', {
    project: created.document,
    options: {
      takeId: 'bb-observed-take',
      actions,
    },
  });
  assert.equal(imported.report.validatedActionCount, 3);

  // These timing and geometry numbers are synthetic. Replace with confirmed measurements.
  const calibration = {
    version: 1,
    theme: 'grey',
    duration: 5,
    sourceOffset: 0,
    board: [60, 300, 100],
    rackY: 1450,
    rackCell: 70,
    bestScore: 0,
    scoreTrack: [],
    actions: [
      { actionId: 'observed-1', start: 0.2, release: 0.7, clear: 0.9, slot: 0 },
      { actionId: 'observed-2', start: 1.2, release: 1.7, clear: 1.8, slot: 1 },
      { actionId: 'observed-3', start: 2.2, release: 2.7, clear: 2.8, slot: 2 },
    ],
  };
  const calibrated = await run('reference calibrate', {
    project: imported.document,
    options: { calibration },
  });
  const audit = inspectNativeRuntime(calibrated.document);
  assert.equal(audit.validated, true);
  assert.equal(audit.takes[0].legal, true);
  assert.equal(audit.takes[0].actions, 3);
  // First placement fills the only empty cell in row 0 and clears it.
  assert.ok(audit.takes[0].frames[1].cells[0].every((cell) => cell === null));
  const renderer = prepareCalibratedRenderer(calibrated.document, 'bb-observed-take');
  assert.equal(renderer.frameSource.fps, 30);
  assert.equal(renderer.frameSource.totalFrames, 150);
  const out = process.argv[2];
  if (out)
    await writeFile(out, JSON.stringify(calibrated.document, null, 2) + '\n', { flag: 'wx' });
  console.log(
    JSON.stringify(
      {
        created: created.ok,
        actionsValidated: imported.report.validatedActionCount,
        firstRowCleared: true,
        calibrationBound: calibrated.ok,
        frames: renderer.frameSource.totalFrames,
        fps: renderer.frameSource.fps,
        out: out ?? null,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
