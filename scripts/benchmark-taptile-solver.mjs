#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

function argument(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const rounds = Math.max(1, Number(argument('rounds', '3')) || 3);
const output = resolve(argument('out', 'artifacts/benchmarks/taptile-solver.json'));
const templates = ['hourglass', 't-shape', 'terraces', 'free'];
const seeds = [1, 81, 935, 240811];
const server = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } });

try {
  const project = await server.ssrLoadModule('/src/taptile/project/index.ts');
  const gameplay = await server.ssrLoadModule('/src/taptile/gameplay/index.ts');
  const samples = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const template of templates) {
      const level = gameplay.compileTapTileLevel(project.createDefaultTapTileProject(template));
      for (const seed of seeds) {
        const startedAt = performance.now();
        const result = gameplay.solveTapTileTake(level, {
          profile: 'max-clear',
          seed,
          beamWidth: 420,
          maxExpandedStates: 300_000,
        });
        const elapsedMs = performance.now() - startedAt;
        samples.push({
          round,
          template,
          seed,
          elapsedMs,
          expandedStates: result.expandedStates,
          status: result.status,
          terminationReason: result.terminationReason,
          actionCount: result.actions?.length ?? 0,
          clearedTileCount: result.metrics?.clearedTileCount ?? 0,
          theoreticalClearableTileCount: result.metrics?.theoreticalClearableTileCount ?? 0,
          peakTrayOccupancy: result.metrics?.peakTrayOccupancy ?? 0,
          finalStateHash: result.finalStateHash ?? '',
        });
      }
    }
  }
  const timings = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  const report = {
    generatedAt: new Date().toISOString(),
    rounds,
    sampleCount: samples.length,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    summary: {
      meanMs: timings.reduce((sum, value) => sum + value, 0) / timings.length,
      medianMs: timings[Math.floor(timings.length / 2)],
      p95Ms: timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))],
      maxMs: timings.at(-1),
      totalExpandedStates: samples.reduce((sum, sample) => sum + sample.expandedStates, 0),
      allReplayable: samples.every((sample) => sample.clearedTileCount > 0 && sample.actionCount > 0),
      allReachedBound: samples.every((sample) => sample.clearedTileCount === sample.theoreticalClearableTileCount),
    },
    byTemplate: Object.fromEntries(templates.map((template) => {
      const entries = samples.filter((sample) => sample.template === template);
      return [template, {
        meanMs: entries.reduce((sum, sample) => sum + sample.elapsedMs, 0) / entries.length,
        maxMs: Math.max(...entries.map((sample) => sample.elapsedMs)),
        meanExpandedStates: entries.reduce((sum, sample) => sum + sample.expandedStates, 0) / entries.length,
        minCleared: Math.min(...entries.map((sample) => sample.clearedTileCount)),
      }];
    })),
    samples,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output, ...report.summary, byTemplate: report.byTemplate }, null, 2)}\n`);
} finally {
  await server.close();
}
