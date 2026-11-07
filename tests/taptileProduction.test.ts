import { describe, expect, it } from 'vitest';
import type { FixedFrameExportResult } from '../src/exporter/fixedFrameExporter';
import { compileTapTileTake } from '../src/taptile/director';
import { applyTapAction, compileTapTileLevel, createInitialTapTileGameState, solveTapTileTake } from '../src/taptile/gameplay';
import { createTapTileTake } from '../src/taptile/gameplay/take';
import { createDefaultTapTileProject, stableStringify, type TapTileTakeAction } from '../src/taptile/project';
import {
  compileTapTileAudioMix,
  compileTapTileCut,
  createTapTileRenderManifest,
  createTapTileProductionRenderJob,
  decodeStoredZip,
  encodeStoredZip,
  expandTapTileBatchMatrix,
  exportTapTileProjectBundle,
  importTapTileProjectBundle,
  runTapTileBatch,
  selectTapTileProductionVerificationFrames,
  validateTapTileVariantDependencies,
  type TapTileBatchTask,
  type TapTileVariantSpec,
} from '../src/taptile/production';
import { createTapTileBlenderVfxAsset } from '../src/taptile/blender';
import { createMinimalGlb } from './glbFixture';

const ACTION_IDS = ['hourglass-43', 'hourglass-44', 'hourglass-45', 'hourglass-46', 'hourglass-47', 'hourglass-48'];

function productionFixture() {
  const project = createDefaultTapTileProject('hourglass');
  const level = compileTapTileLevel(project);
  let state = createInitialTapTileGameState(level);
  const actions: TapTileTakeAction[] = [];
  for (const [index, tileId] of ACTION_IDS.entries()) {
    const action = { id: `production-${index}`, type: 'tap' as const, actor: 'script' as const, tileId };
    const transition = applyTapAction(level, state, action);
    expect(transition.accepted).toBe(true);
    state = transition.after;
    actions.push({ ...action, startedAtFrame: index * 2, durationFrames: 1 });
  }
  const take = createTapTileTake(level, actions, state, { id: 'production-take-a', name: 'Production Take A', createdAt: '1970-01-01T00:00:00.000Z' });
  const secondTake = { ...structuredClone(take), id: 'production-take-b', name: 'Production Take B' };
  project.takes = [take, secondTake];
  project.selectedTakeId = take.id;
  const compiled = compileTapTileTake(level, take, project.director.profiles['combo-rush']!, { seed: project.director.seed });
  return { project, level, take, compiled };
}

function variantSpec(project: ReturnType<typeof productionFixture>['project']): TapTileVariantSpec {
  return {
    levelId: project.level.id,
    takeId: 'production-take-a',
    skinPackId: 'animals-v1',
    directorProfileId: 'combo-rush',
    audioPackId: 'bright-pop-v1',
    cutSpecId: 'opening-six',
    outroPackId: 'play-now-v1',
    renderSpec: project.render,
  };
}

describe('TapTile production timeline and semantic audio', () => {
  it('ships the Gate D minimum inventory with every cue asset declared', () => {
    const { project } = productionFixture();
    expect(Object.keys(project.production.audioPacks)).toHaveLength(2);
    expect(Object.keys(project.production.cuts)).toHaveLength(2);
    expect(Object.keys(project.production.outros)).toHaveLength(1);
    for (const pack of Object.values(project.production.audioPacks)) {
      for (const cue of [pack.tap, pack.pickup, pack.traySettle, pack.match, pack.shatter, pack.warning, pack.win, pack.outro]) {
        for (const assetId of cue?.assetIds ?? []) expect(project.assets.entries[assetId]?.kind).toBe('audio');
      }
    }
  });

  it('keeps source time separate from final Cut time and seeks deterministically through intro/gameplay/outro', () => {
    const { project, compiled, take } = productionFixture();
    const originalTake = structuredClone(take);
    const cut = compileTapTileCut(compiled, project.production.cuts['opening-six']!, project.production.outros);
    expect(cut.introFrames).toBe(8);
    expect(cut.outroFrames).toBe(60);
    expect(cut.totalFrames).toBe(compiled.totalFrames + 68);
    expect(cut.evaluate(0).phase).toBe('intro');
    expect(cut.evaluate(8).phase).toBe('gameplay');
    expect(cut.evaluate(cut.totalFrames - 1).phase).toBe('outro');
    expect(cut.evaluate(cut.totalFrames - 1).outroProgress).toBe(1);
    expect(cut.evaluate(27)).toEqual(cut.evaluate(27));
    expect(take).toEqual(originalTake);
  });

  it('selects variants by seed, binds semantic events, applies fades and limits peaks deterministically', () => {
    const { project, compiled } = productionFixture();
    const cut = compileTapTileCut(compiled, project.production.cuts['opening-six']!, project.production.outros);
    const brightA = compileTapTileAudioMix(project, compiled, cut, project.production.audioPacks['bright-pop-v1']!);
    const brightB = compileTapTileAudioMix(project, compiled, cut, project.production.audioPacks['bright-pop-v1']!);
    const wood = compileTapTileAudioMix(project, compiled, cut, project.production.audioPacks['soft-wood-v1']!);
    expect(brightB.pcmHash).toBe(brightA.pcmHash);
    expect(brightB.scheduledCues).toEqual(brightA.scheduledCues);
    expect(wood.pcmHash).not.toBe(brightA.pcmHash);
    expect(new Set(brightA.scheduledCues.map((cue) => cue.kind))).toEqual(new Set(['tap', 'pickup', 'traySettle', 'match', 'shatter', 'outro']));
    expect(brightA.peakAfterLimit).toBeLessThanOrEqual(brightA.peakLimit + 0.0001);
    expect(brightA.data.length).toBe(Math.ceil(cut.totalFrames / compiled.fps * brightA.sampleRate) * 2);

    const delayedPack = structuredClone(project.production.audioPacks['bright-pop-v1']!);
    delayedPack.tap.delayFrames = 3;
    delayedPack.tap.startOffsetMs = 20;
    delayedPack.tap.fadeInMs = 18;
    const delayed = compileTapTileAudioMix(project, compiled, cut, delayedPack);
    const firstTap = brightA.scheduledCues.find((cue) => cue.kind === 'tap')!;
    const delayedTap = delayed.scheduledCues.find((cue) => cue.kind === 'tap')!;
    expect(delayedTap.startSample - firstTap.startSample).toBe(4_800);
    expect(delayedTap.durationSamples).toBeLessThan(firstTap.durationSamples);
    expect(delayed.pcmHash).not.toBe(brightA.pcmHash);
  });

  it('applies TimeWarp and target duration without rewriting the full semantic Take', () => {
    const project = createDefaultTapTileProject('hourglass');
    const level = compileTapTileLevel(project);
    const solved = solveTapTileTake(level, { profile: 'safe-win', seed: 20260902, beamWidth: 80 });
    expect(solved.status).toBe('solved');
    const take = solved.take!;
    const compiled = compileTapTileTake(level, take, project.director.profiles['human-natural']!, { seed: project.director.seed });
    const cut = compileTapTileCut(compiled, project.production.cuts['full-performance-15s']!, project.production.outros);
    expect(cut.totalFrames).toBe(450);
    expect(cut.gameplaySourceFrames.length).toBe(378);
    expect(cut.gameplaySourceFrames.at(-1)).toBe(compiled.totalFrames - 1);
    expect(take.actions).toHaveLength(48);
    expect(take.actions.every((action) => action.type === 'tap')).toBe(true);
  });

  it('freezes cut/audio/outro identities into a deterministic production RenderJob', () => {
    const { project, level, compiled } = productionFixture();
    const first = createTapTileProductionRenderJob(project, level, compiled, project.production.cuts['opening-six']!, project.production.audioPacks['bright-pop-v1']!);
    const second = createTapTileProductionRenderJob(project, level, compiled, project.production.cuts['opening-six']!, project.production.audioPacks['bright-pop-v1']!);
    expect(second.identity).toEqual(first.identity);
    expect(second.audioMix.pcmHash).toBe(first.audioMix.pcmHash);
    expect(first.evaluate(first.totalFrames - 1).outro?.id).toBe('play-now-v1');
    project.production.audioPacks['bright-pop-v1']!.tap.volume = 0.1;
    const changed = createTapTileProductionRenderJob(project, level, compiled, project.production.cuts['opening-six']!, project.production.audioPacks['bright-pop-v1']!);
    expect(changed.identity.combinationHash).not.toBe(first.identity.combinationHash);
  });

  it('forces visual verification to sample actual match feedback beats', () => {
    const { project, level, compiled } = productionFixture();
    const job = createTapTileProductionRenderJob(
      project,
      level,
      compiled,
      project.production.cuts['opening-six']!,
      project.production.audioPacks['bright-pop-v1']!,
    );
    const frames = selectTapTileProductionVerificationFrames(job);
    const match = compiled.actions.find((action) => action.transition.matchedTileIds.length > 0)!;
    const expectedSource = Math.round(match.timing.matchStartFrame
      + (match.timing.matchVfxEndFrame - match.timing.matchStartFrame) * 0.48);
    const expectedFinal = job.cut.sourceFrameToFinalFrame(expectedSource)!;
    expect(frames).toContain(expectedFinal);
    expect(frames).toEqual([...frames].sort((left, right) => left - right));
    expect(frames[0]).toBe(0);
    expect(frames.at(-1)).toBe(job.totalFrames - 1);
  });
});

describe('TapTile batch matrix and manifests', () => {
  it('freezes the isolated Blender VFX identity and exact timeline into the render manifest', async () => {
    const { project, level, compiled } = productionFixture();
    const matchEventIds = compiled.actions
      .filter((action) => action.transition.matchedTileIds.length === 3)
      .map((action) => `${action.actionId}:match`);
    const semanticRoles = matchEventIds.flatMap(() => ['match-core', 'match-fragment']);
    const semanticIds = matchEventIds.flatMap((id) => [`${id}::core`, `${id}::dense-shards`]);
    const buffer = createMinimalGlb({
      triangleCount: 2,
      nodeInstances: semanticRoles.length,
      semanticExtras: true,
      semanticRoles,
      semanticIds,
      vfxStyle: 'shatter',
      vfxFragmentCount: 96,
      fixedCamera: true,
      timeline: { frameStart: 1, frameEnd: compiled.totalFrames, frameCount: compiled.totalFrames, fps: compiled.fps },
    });
    const asset = await createTapTileBlenderVfxAsset(buffer, 'scene.vfx.glb');
    const job = createTapTileProductionRenderJob(
      project,
      level,
      compiled,
      project.production.cuts['opening-six']!,
      project.production.audioPacks['bright-pop-v1']!,
      { blenderVfxAsset: asset },
    );
    const result: FixedFrameExportResult = {
      blob: new Blob(['deterministic-mp4'], { type: 'video/mp4' }),
      fileName: 'production.mp4',
      frameCount: job.totalFrames,
      durationSeconds: job.totalFrames / job.fps,
      width: job.width,
      height: job.height,
      fps: job.fps,
      renderScale: 1.5,
      codec: 'avc',
      audioCodec: 'aac',
      verification: {
        containerReadable: true,
        videoTrackCount: 1,
        audioTrackCount: 1,
        width: job.width,
        height: job.height,
        frameCount: job.totalFrames,
        durationSeconds: job.totalFrames / job.fps,
        averageFrameRate: job.fps,
        averageVideoBitrate: 14_000_000,
        videoCodec: 'avc',
        audioCodec: 'aac',
      },
    };
    const manifest = await createTapTileRenderManifest(project, level, job, result);
    expect(job.identity.blenderVfxHash).toBe(asset.sha256);
    expect(manifest.source.blenderVfx).toEqual({
      fileName: 'scene.vfx.glb',
      sha256: asset.sha256,
      byteLength: asset.byteLength,
      fragmentCount: matchEventIds.length * 96,
      matchEventIds: [...matchEventIds].sort(),
      isolated: true,
      timeline: { frameStart: 1, frameEnd: compiled.totalFrames, frameCount: compiled.totalFrames, fps: compiled.fps },
    });
  });

  it('expands and hash-deduplicates the full matrix while exposing invalid Cut dependencies', () => {
    const { project, level } = productionFixture();
    const skinPackCount = Object.keys(project.visuals.themes).length;
    const tasks = expandTapTileBatchMatrix(project, level, {
      takeIds: project.takes.map((take) => take.id),
      skinPackIds: Object.keys(project.visuals.themes),
      directorProfileIds: Object.keys(project.director.profiles).slice(0, 3),
      audioPackIds: Object.keys(project.production.audioPacks),
      cutSpecIds: Object.keys(project.production.cuts),
      outroPackIds: Object.keys(project.production.outros),
      renderSpecs: [project.render, structuredClone(project.render)],
    });
    expect(tasks).toHaveLength(skinPackCount * 24);
    expect(new Set(tasks.map((task) => task.combinationHash)).size).toBe(tasks.length);
    const invalid = tasks.filter((task) => !validateTapTileVariantDependencies(project, level, task.spec).valid);
    expect(invalid).toHaveLength(skinPackCount * 12);
    expect(validateTapTileVariantDependencies(project, level, invalid[0]!.spec).reasons[0]).toContain('CUT_ACTION_MISSING');
  });

  it('records completed and failed tasks independently and emits an inspectable manifest', async () => {
    const { project, level } = productionFixture();
    const valid = variantSpec(project);
    const invalid = { ...valid, audioPackId: 'missing-audio' };
    const tasks: TapTileBatchTask[] = [valid, invalid].map((spec, index) => ({ id: `queue-${index}`, combinationHash: `combo-${index}`, spec, status: 'queued', progress: 0 }));
    const finished = await runTapTileBatch(project, level, tasks, async (prepared, _signal, onProgress) => {
      onProgress({ phase: 'rendering', currentFrame: prepared.job.totalFrames, totalFrames: prepared.job.totalFrames, ratio: 1, message: 'done' });
      const result: FixedFrameExportResult = {
        blob: new Blob(['deterministic-mp4'], { type: 'video/mp4' }),
        fileName: prepared.fileName,
        frameCount: prepared.job.totalFrames,
        durationSeconds: prepared.job.totalFrames / prepared.job.fps,
        width: prepared.job.width,
        height: prepared.job.height,
        fps: prepared.job.fps,
        renderScale: 1,
        codec: 'avc',
        audioCodec: 'aac',
        verification: {
          containerReadable: true,
          videoTrackCount: 1,
          audioTrackCount: 1,
          width: prepared.job.width,
          height: prepared.job.height,
          frameCount: prepared.job.totalFrames,
          durationSeconds: prepared.job.totalFrames / prepared.job.fps,
          averageFrameRate: prepared.job.fps,
          averageVideoBitrate: 14_000_000,
          videoCodec: 'avc',
          audioCodec: 'aac',
        },
      };
      await prepared.job.dispose?.();
      return result;
    });
    expect(finished.map((task) => task.status)).toEqual(['completed', 'failed']);
    expect(finished[1]?.failureReason).toContain('AUDIO_PACK_MISSING');
    expect(finished[0]?.result?.manifest.audio.codec).toBe('aac');
    expect(finished[0]?.result?.manifest.output.sha256).toHaveLength(64);
  });

  it('cancels queued batch tasks without invoking the renderer', async () => {
    const { project, level } = productionFixture();
    const spec = variantSpec(project);
    const tasks: TapTileBatchTask[] = [0, 1].map((index) => ({ id: `cancel-${index}`, combinationHash: `cancel-combo-${index}`, spec: structuredClone(spec), status: 'queued', progress: 0 }));
    const controller = new AbortController();
    controller.abort();
    let renders = 0;
    const finished = await runTapTileBatch(project, level, tasks, async () => {
      renders += 1;
      throw new Error('renderer should not run');
    }, { signal: controller.signal });
    expect(renders).toBe(0);
    expect(finished.every((task) => task.status === 'canceled')).toBe(true);
  });
});

describe('TapTile project bundles', () => {
  it('exports deterministic ZIP structure and round-trips with SHA-256 checks', async () => {
    const { project } = productionFixture();
    const first = await exportTapTileProjectBundle(project);
    const second = await exportTapTileProjectBundle(project);
    expect(new Uint8Array(await second.blob.arrayBuffer())).toEqual(new Uint8Array(await first.blob.arrayBuffer()));
    const files = decodeStoredZip(new Uint8Array(await first.blob.arrayBuffer()));
    expect(Object.keys(files)).toContain('project.json');
    expect(Object.keys(files)).toContain('assets/manifest.json');
    expect(Object.keys(files)).toContain('manifests/project-manifest.json');
    expect(Object.keys(files)).toContain('checksums.json');
    expect(Object.keys(files).filter((path) => path.startsWith('takes/'))).toHaveLength(2);
    const imported = await importTapTileProjectBundle(first.blob);
    expect(stableStringify(imported.project)).toBe(stableStringify(project));
    expect(imported.manifest.projectHash).toBe(first.manifest.projectHash);
  });

  it('rejects same-path changed content instead of silently importing it', async () => {
    const { project } = productionFixture();
    const bundle = await exportTapTileProjectBundle(project);
    const files = decodeStoredZip(new Uint8Array(await bundle.blob.arrayBuffer()));
    files['project.json'] = new TextEncoder().encode('{"tampered":true}\n');
    const tampered = new Blob([encodeStoredZip(files)], { type: 'application/zip' });
    await expect(importTapTileProjectBundle(tampered)).rejects.toThrow('BUNDLE_CHECKSUM_MISMATCH: project.json');
  });
});
