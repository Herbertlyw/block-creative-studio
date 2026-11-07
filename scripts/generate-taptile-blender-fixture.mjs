#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

const output = resolve(process.argv[2] ?? 'artifacts/blender/taptile-real-take.scene-exchange.json');
const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const projectModule = await server.ssrLoadModule('/src/taptile/project/index.ts');
  const gameplayModule = await server.ssrLoadModule('/src/taptile/gameplay/index.ts');
  const directorModule = await server.ssrLoadModule('/src/taptile/director/index.ts');
  const blenderModule = await server.ssrLoadModule('/src/taptile/blender/index.ts');
  const project = projectModule.createDefaultTapTileProject('hourglass');
  project.visuals.selectedThemeId = projectModule.CHAIN_COMBO_UI_THEME_ID;
  const level = gameplayModule.compileTapTileLevel(project);
  const solved = gameplayModule.solveTapTileTake(level, {
    profile: 'max-clear',
    seed: 20260904,
    beamWidth: 420,
    maxExpandedStates: 300_000,
  });
  if (!solved.take) throw new Error(`Unable to generate a Blender fixture Take: ${solved.diagnostic ?? solved.status}`);
  const profile = project.director.profiles[project.director.selectedProfileId];
  if (!profile) throw new Error(`Director profile is missing: ${project.director.selectedProfileId}`);
  const compiled = directorModule.compileTapTileTake(level, solved.take, profile, {
    fps: project.render.fps,
    seed: project.director.seed,
    actionOverrides: project.director.actionOverrides,
  });
  const exchange = blenderModule.createTapTileBlenderSceneExchange(project, level, compiled, {
    packageId: 'taptile-hourglass-max-clear-v1',
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(exchange, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output,
    tileCount: level.initialBoardIds.length,
    actionCount: solved.take.actions.length,
    clearedTileCount: solved.metrics?.clearedTileCount ?? 0,
    theoreticalClearableTileCount: solved.metrics?.theoreticalClearableTileCount ?? 0,
    frameCount: exchange.output.frameEnd,
    trackCount: exchange.tracks.length,
    keyframeCount: exchange.tracks.reduce((sum, track) => sum + track.keyframes.length, 0),
    matchEventCount: exchange.events.length,
    imageAssetCount: exchange.assets.length,
  }, null, 2)}\n`);
} finally {
  await server.close();
}
