import { describe, expect, it } from 'vitest';
import { designToVideoMapping, mapDesignPointToVideo, boardScreenRectInSpace, DESIGN_RESOLUTION, VIDEO_RESOLUTION } from '../src/headless/coordinateMapping';
import { createFrameRenderRequest, validateFrameRenderRequest, presentationSeconds } from '../src/headless/frameRequest';
import { compileMaterialRuntime, sampleOrmChannel, combineFactorAndSample, parseMaterialRuntimeDescriptor, remapChannelsForThreeJsSlot, needsThreeJsChannelSwizzle } from '../src/headless/materialRuntime';
import { expandGoldenSceneCases, summarizeCalibrationCases, mapSourceFrameToTarget } from '../src/headless/calibration';
import { compareCalibrationFrames, calibrationScore } from '../src/reference2d/calibrationMetrics';
import { makeFixture } from './headlessFixtures';
import {
  consecutiveTake,
  crossClearTake,
  endgameSnapshot,
  idleSnapshot,
  illegalPreviewAnchor,
  illegalPreviewFrame,
  illegalPreviewSnapshot,
  legalPreviewCells,
  publicSceneCatalog,
  singleClearTake,
  takeStateIdentity,
} from '../src/domain/publicFixtures';
import { applyPlacement, canPlace, hasAnyLegalMove } from '../src/domain/gameEngine';
import { compileTake, evaluateCompiledTake } from '../src/director/presentationCompiler';
import { RHYTHM_PRESETS } from '../src/director/rhythmPresets';
import {
  containedCompositionViewport,
  lockedCameraDistance,
  mapClientPointToComposition,
  webglViewportFromCss,
  FIXED_SHOT_PROFILE,
} from '../src/renderer/shotProfile';
import { REFERENCE_PASS_ORDER } from '../src/headless/contracts';
import { compileRegisteredMaterialPlan, compileRuntimeFromRegisteredPlan, rewriteMaterialMapUriForBrowser } from '../src/capture/materialVariants';
import { PRAISE_PASS, PASS_RESPONSIBILITIES, isPassEnabled } from '../src/reference2d/passes';
import { createPbrTileMaterial, normalScaleForConvention } from '../src/renderer/pbrMaterialFactory';
import { resolveTakeAnchor, STILL_SPECS } from '../src/capture/capturePlan';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const goldenIndex = JSON.parse(
  readFileSync(resolve(process.cwd(), 'docs/reference/v2/GOLDEN_SCENE_INDEX_V1.json'), 'utf8'),
) as {
  sourceVideoSha256: string;
  scenes: Array<{ id: string; startFrame: number; peakFrame: number; endFrame: number; purpose: string }>;
};

describe('coordinate mapping', () => {
  it('letterboxes 1064×1788 into 1080×1920 without stretch', () => {
    const mapping = designToVideoMapping();
    expect(mapping.scale).toBeCloseTo(1080 / 1064, 8);
    expect(mapping.drawWidth).toBeCloseTo(1080, 6);
    expect(mapping.drawHeight).toBeLessThan(1920);
    expect(mapping.offsetX).toBeCloseTo(0, 6);
    expect(mapping.offsetY).toBeGreaterThan(0);
    const board = boardScreenRectInSpace('video');
    const designBoard = boardScreenRectInSpace('design');
    expect(board.width / designBoard.width).toBeCloseTo(mapping.scale, 8);
  });

  it('maps the score center through the same contain transform', () => {
    const mapped = mapDesignPointToVideo(532, 213);
    const mapping = designToVideoMapping();
    expect(mapped.x).toBeCloseTo(mapping.offsetX + 532 * mapping.scale, 8);
  });
});

describe('frame render request', () => {
  it('defaults to native design pixels and presentation-frame time', () => {
    const request = createFrameRenderRequest({
      planId: 'plan',
      planHash: 'fnv1a32:1',
      takeId: 'take',
      takeHash: 'fnv1a32:2',
      frameIndex: 12,
      fps: 30,
      renderer: 'reference-2d',
    });
    expect(request.targetPixels).toEqual(DESIGN_RESOLUTION);
    expect(request.timeBase).toBe('presentation-frame');
    expect(validateFrameRenderRequest(request)).toEqual([]);
    expect(presentationSeconds(30, 30)).toBe(1);
  });

  it('rejects a video-space request that still uses design pixels', () => {
    const request = createFrameRenderRequest({
      planId: 'plan',
      planHash: 'h',
      takeId: 't',
      takeHash: 'h',
      frameIndex: 0,
      fps: 30,
      renderer: 'reference-2d',
      coordinateSpace: 'video',
    });
    request.targetPixels = { ...DESIGN_RESOLUTION };
    expect(validateFrameRenderRequest(request).some((issue) => issue.code === 'FRAME_PIXEL_SIZE_MISMATCH')).toBe(true);
  });
});

describe('public fixtures', () => {
  it('covers the required baseline scenes', () => {
    expect(publicSceneCatalog().map((scene) => scene.id)).toEqual([
      'idle',
      'pickup',
      'legal-preview',
      'illegal-preview',
      'single-clear',
      'cross-clear',
      'consecutive',
      'endgame',
    ]);
    expect(idleSnapshot().status).toBe('playing');
    expect(endgameSnapshot().status).toBe('game-over');
    expect(endgameSnapshot().combo).toBe(0);
    const illegal = illegalPreviewSnapshot();
    expect(illegal.status).toBe('playing');
    expect(hasAnyLegalMove(illegal)).toBe(true);
    const dragged = illegal.pieces.find((piece) => piece.shapeId === 'square-3');
    expect(dragged).toBeDefined();
    expect(canPlace(illegal.board, dragged!, illegalPreviewAnchor())).toBe(false);
    const frame = illegalPreviewFrame();
    expect(frame.snapshot.status).toBe('playing');
    expect(frame.draggedPiece?.piece.shapeId).toBe('square-3');
    expect(frame.draggedPiece && canPlace(frame.board, frame.draggedPiece.piece, frame.draggedPiece.anchor)).toBe(false);
    expect(legalPreviewCells().rows).toEqual([6]);
  });

  it('keeps take identities stable and gameplay-valid', () => {
    const take = singleClearTake();
    const first = JSON.stringify(takeStateIdentity(take));
    const second = JSON.stringify(takeStateIdentity(singleClearTake()));
    expect(first).toBe(second);
    const move = take.actions[0];
    expect(move).toBeDefined();
    if (!move) throw new Error('missing action');
    expect(canPlace(take.initial.board, take.initial.pieces[0]!, move.anchor)).toBe(true);
    expect(applyPlacement(take.initial, move)?.clear.rows).toEqual([6]);
    expect(crossClearTake().actions).toHaveLength(1);
    expect(consecutiveTake().actions).toHaveLength(2);
  });

  it('compiles the slice take deterministically', () => {
    const take = singleClearTake();
    const compiled = compileTake(take, RHYTHM_PRESETS['human-natural'], 30);
    const a = evaluateCompiledTake(compiled, 40, RHYTHM_PRESETS['human-natural']);
    const b = evaluateCompiledTake(compiled, 40, RHYTHM_PRESETS['human-natural']);
    expect(a.snapshot.score).toBe(b.snapshot.score);
    expect(a.board.cells).toEqual(b.board.cells);
    const shuffled = evaluateCompiledTake(compiled, 90, RHYTHM_PRESETS['human-natural']);
    const back = evaluateCompiledTake(compiled, 40, RHYTHM_PRESETS['human-natural']);
    expect(back.snapshot.score).toBe(a.snapshot.score);
    expect(shuffled.frame).toBe(90);
  });

  it('keeps the consecutive public slice in the 6–8s review window', () => {
    const compiled = compileTake(consecutiveTake(), RHYTHM_PRESETS['human-natural'], 30);
    const seconds = compiled.totalFrames / compiled.fps;
    expect(seconds).toBeGreaterThanOrEqual(6);
    expect(seconds).toBeLessThanOrEqual(8);
  });
});

describe('material runtime', () => {
  it('compiles packs without requiring preset names', () => {
    const { material } = makeFixture();
    material.id = 'material.aurora-shell';
    material.behavior.materialClass = 'custom';
    const runtime = compileMaterialRuntime({
      pack: material,
      maps: [
        { slot: 'baseColor', uri: 'bcs-asset://sha256/aa', contentHash: 'sha256:aa', colorSpace: 'srgb' },
        { slot: 'orm', uri: 'bcs-asset://sha256/bb', contentHash: 'sha256:bb', channels: 'rgb', colorSpace: 'linear' },
        { slot: 'normal', uri: 'bcs-asset://sha256/cc', contentHash: 'sha256:cc', colorSpace: 'linear', normalY: 'opengl' },
      ],
    });
    expect(runtime.id).toBe('material.aurora-shell');
    expect(runtime.behaviorPending).toBe(true);
    expect(runtime.capabilities.materialAwareFracture).toBe('pending');
    expect(sampleOrmChannel({ r: 0.2, g: 0.4, b: 0.8 }, 'roughness')).toBe(0.4);
    expect(sampleOrmChannel({ r: 0.2, g: 0.4, b: 0.8 }, 'metallic')).toBe(0.8);
    expect(combineFactorAndSample(0.5, 0.4, 'multiply-factor')).toBeCloseTo(0.2);
    expect(combineFactorAndSample(0.5, 0.4, 'replace')).toBeCloseTo(0.4);
  });

  it('binds independent steel/wood maps and leaves aurora parameter-only', () => {
    const steel = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/materials/material.stainless-steel.json'), 'utf8'));
    const wood = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/materials/material.oak-wood.json'), 'utf8'));
    const aurora = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/materials/material.aurora-shell.json'), 'utf8'));
    const fixture = makeFixture();
    const steelRuntime = compileRuntimeFromRegisteredPlan(steel, {
      master: fixture.master,
      recipe: fixture.recipe,
      assets: fixture.assets,
      rewriteUri: rewriteMaterialMapUriForBrowser,
    });
    const woodRuntime = compileRuntimeFromRegisteredPlan(wood, {
      master: fixture.master,
      recipe: fixture.recipe,
      assets: fixture.assets,
      rewriteUri: rewriteMaterialMapUriForBrowser,
    });
    const auroraRuntime = compileRuntimeFromRegisteredPlan(aurora, {
      master: fixture.master,
      recipe: fixture.recipe,
      assets: fixture.assets,
      rewriteUri: rewriteMaterialMapUriForBrowser,
    });
    expect(steelRuntime.maps).toHaveLength(5);
    expect(woodRuntime.maps).toHaveLength(5);
    expect(auroraRuntime.maps).toHaveLength(0);
    expect(steelRuntime.maps[0]?.contentHash).not.toBe(woodRuntime.maps[0]?.contentHash);
    expect(steelRuntime.combine).toBe('replace');
    expect(woodRuntime.combine).toBe('replace');
    expect(auroraRuntime.combine).toBe('multiply-factor');
    expect(steelRuntime.metalness).toBeGreaterThan(woodRuntime.metalness);
    const steelColor = new THREE.Texture();
    const woodColor = new THREE.Texture();
    const steelMat = createPbrTileMaterial({
      descriptor: steelRuntime,
      color: 'coral',
      textures: { baseColor: steelColor, metallic: steelColor, roughness: steelColor },
    });
    const woodMat = createPbrTileMaterial({
      descriptor: woodRuntime,
      color: 'coral',
      textures: { baseColor: woodColor, metallic: woodColor, roughness: woodColor },
    });
    expect(steelMat.map).toBe(steelColor);
    expect(woodMat.map).toBe(woodColor);
    expect(steelMat.metalness).toBe(1);
    expect(woodMat.metalness).toBe(1);
    expect(steelMat.color.getHex()).toBe(0xffffff);
    expect(woodMat.color.getHex()).toBe(0xffffff);
    steelMat.dispose();
    woodMat.dispose();
  });

  it('keeps frame-exact lock mode and does not rewrite copper-clear compatibility', () => {
    const wood = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/materials/material.oak-wood.json'), 'utf8'));
    const fixture = makeFixture();
    const copperClear = fixture.assets.find((asset) => asset.id === 'effect.copper-clear');
    expect(copperClear && 'compatibleMaterialClasses' in copperClear && copperClear.compatibleMaterialClasses).toEqual(['metal']);
    const compiled = compileRegisteredMaterialPlan(wood, {
      master: fixture.master,
      recipe: fixture.recipe,
      assets: fixture.assets,
    });
    expect(fixture.recipe.lockMode).toBe('frame-exact');
    expect(compiled.plan.lockMode).toBe('frame-exact');
    expect(compiled.plan.planHash).toMatch(/^fnv1a32:/);
    expect(compiled.plan.slots['clear.primary']?.manifest.id).toBe('effect.universal-clear');
    expect((compiled.plan.slots['clear.primary']?.manifest as { compatibleMaterialClasses: string[] }).compatibleMaterialClasses).toEqual(['*']);
    expect(copperClear && 'compatibleMaterialClasses' in copperClear && copperClear.compatibleMaterialClasses).toEqual(['metal']);
  });

  it('still compiles maps after a textured pack is renamed to an unknown user id via ResolvedRenderPlan', () => {
    const steel = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/materials/material.stainless-steel.json'), 'utf8'));
    steel.id = 'material.user.blue-forged-alloy-v7';
    const fixture = makeFixture();
    const runtime = compileRuntimeFromRegisteredPlan(steel, {
      master: fixture.master,
      recipe: fixture.recipe,
      assets: fixture.assets,
    });
    expect(runtime.id).toBe('material.user.blue-forged-alloy-v7');
    expect(runtime.maps).toHaveLength(5);
    expect(runtime.maps.every((map) => map.uri.includes('steel-'))).toBe(true);
    expect(runtime.maps.map((map) => map.slot).sort()).toEqual([
      'ao',
      'baseColor',
      'metallic',
      'normal',
      'roughness',
    ]);
  });

  it('resolves texture URIs from the asset registry when the pack ref has no uri', () => {
    const { material } = makeFixture();
    const textureUri = 'bcs-asset://sha256/' + 'c'.repeat(64);
    const textureHash = `sha256:${'c'.repeat(64)}`;
    material.appearance.textureRefs = {
      baseColor: {
        id: 'texture.copper.base-color',
        version: '1.0.0',
        kind: 'bitmap',
        contentHash: textureHash,
      },
    };
    const runtime = compileMaterialRuntime({
      pack: material,
      registry: {
        resolve: () => ({ uri: textureUri, contentHash: textureHash }),
      },
    });
    expect(runtime.maps).toEqual([
      expect.objectContaining({ slot: 'baseColor', uri: textureUri, contentHash: textureHash }),
    ]);
  });

  it('maps split grayscale channels onto the Three.js ORM layout equivalently to a packed map', () => {
    const packed = { r: 51, g: 102, b: 204 };
    expect(sampleOrmChannel(packed, 'ao')).toBe(51);
    expect(sampleOrmChannel(packed, 'roughness')).toBe(102);
    expect(sampleOrmChannel(packed, 'metallic')).toBe(204);
    expect(needsThreeJsChannelSwizzle('roughness', 'r')).toBe(true);
    expect(needsThreeJsChannelSwizzle('metallic', 'r')).toBe(true);
    expect(needsThreeJsChannelSwizzle('ao', 'r')).toBe(false);
    expect(needsThreeJsChannelSwizzle('orm', 'rgb')).toBe(false);
    expect(needsThreeJsChannelSwizzle('emission', 'r')).toBe(true);
    expect(needsThreeJsChannelSwizzle('emission', 'rgb')).toBe(false);
    const splitAo = remapChannelsForThreeJsSlot({ r: 51, g: 0, b: 0 }, 'ao', 'r');
    const splitRough = remapChannelsForThreeJsSlot({ r: 102, g: 0, b: 0 }, 'roughness', 'r');
    const splitMetal = remapChannelsForThreeJsSlot({ r: 204, g: 0, b: 0 }, 'metallic', 'r');
    expect(sampleOrmChannel({ r: splitAo.r, g: splitRough.g, b: splitMetal.b }, 'ao')).toBe(sampleOrmChannel(packed, 'ao'));
    expect(sampleOrmChannel({ r: splitAo.r, g: splitRough.g, b: splitMetal.b }, 'roughness')).toBe(sampleOrmChannel(packed, 'roughness'));
    expect(sampleOrmChannel({ r: splitAo.r, g: splitRough.g, b: splitMetal.b }, 'metallic')).toBe(sampleOrmChannel(packed, 'metallic'));
  });

  it('flips DirectX normal Y once and opposite to OpenGL', () => {
    const openGl = normalScaleForConvention(0.4, 'opengl');
    const directX = normalScaleForConvention(0.4, 'directx');
    expect(openGl.x).toBe(0.4);
    expect(openGl.y).toBe(0.4);
    expect(directX.x).toBe(0.4);
    expect(directX.y).toBe(-0.4);
    expect(openGl.y).not.toBe(directX.y);
    const descriptor = compileMaterialRuntime({
      pack: makeFixture().material,
      maps: [{
        slot: 'normal',
        uri: 'examples/headless/materials/maps/steel-normal.png',
        contentHash: `sha256:${'d'.repeat(64)}`,
        colorSpace: 'linear',
        normalY: 'directx',
      }],
    });
    descriptor.normalStrength = 0.4;
    const texture = new THREE.Texture();
    const material = createPbrTileMaterial({
      descriptor,
      color: 'coral',
      textures: { normal: texture },
    });
    expect(material.normalScale.x).toBeCloseTo(0.4);
    expect(material.normalScale.y).toBeCloseTo(-0.4);
    material.dispose();
  });

  it('rejects a forged persisted runtime with path traversal or a short hash', () => {
    const steel = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/materials/material.stainless-steel.json'), 'utf8'));
    const runtime = compileMaterialRuntime({ pack: steel });
    expect(parseMaterialRuntimeDescriptor(runtime).maps).toHaveLength(5);
    const forgedUri = structuredClone(runtime);
    forgedUri.maps[0]!.uri = '../secret.png';
    expect(() => parseMaterialRuntimeDescriptor(forgedUri)).toThrow(/URI/);
    const forgedHash = structuredClone(runtime);
    forgedHash.maps[0]!.contentHash = 'sha256:aa';
    expect(() => parseMaterialRuntimeDescriptor(forgedHash)).toThrow(/contentHash|HASH/i);
  });

  it('rejects unspecified normal Y instead of flipping silently', () => {
    const { material } = makeFixture();
    try {
      compileMaterialRuntime({
        pack: material,
        maps: [{ slot: 'normal', uri: 'x', contentHash: 'sha256:n', colorSpace: 'linear' }],
      });
      throw new Error('expected compile to fail');
    } catch (error) {
      expect(String(error)).toMatch(/Material runtime compile failed/);
      expect(JSON.stringify((error as { details?: unknown }).details ?? error)).toMatch(/NORMAL_Y/i);
    }
  });
});

describe('golden batch', () => {
  it('maps 60 fps source frames onto 30 fps target time and does not default exact-replay', () => {
    expect(mapSourceFrameToTarget(60, 60, 30)).toBe(30);
    expect(mapSourceFrameToTarget(20, 60, 30)).toBe(10);
    expect(mapSourceFrameToTarget(0, 60, 30)).toBe(0);
    expect(() => expandGoldenSceneCases(goldenIndex.scenes, {
      correspondence: 'exact-replay',
      reviewStatus: 'BLOCKED',
      unresolvedReasons: ['missing take'],
      sourceFps: 60,
      targetFps: 30,
    })).toThrow(/targetTakeHash/);

    const cases = expandGoldenSceneCases(goldenIndex.scenes, {
      correspondence: 'isolated-presentation',
      reviewStatus: 'BLOCKED',
      unresolvedReasons: ['Reference source video is not in the public repository.'],
      referenceMediaHash: `sha256:${goldenIndex.sourceVideoSha256}`,
      sourceFps: 60,
      targetFps: 30,
    });
    expect(goldenIndex.scenes).toHaveLength(13);
    expect(cases).toHaveLength(39);
    expect(summarizeCalibrationCases(cases).BLOCKED).toBe(39);
    expect(cases[0]?.targetFps).toBe(30);
    expect(cases[0]?.sourcePtsSeconds).toBeTypeOf('number');
    expect(cases.every((item) => item.reviewStatus === 'BLOCKED')).toBe(true);
    expect(cases.every((item) => item.correspondence === 'isolated-presentation')).toBe(true);
    const idleEnd = cases.find((item) => item.id === 'idle-start:end');
    expect(idleEnd?.sourceFrameIndex).toBe(60);
    expect(idleEnd?.sourcePtsSeconds).toBeCloseTo(1);
    expect(idleEnd?.targetFrame).toBe(30);
    const pickupStart = cases.find((item) => item.id === 'first-pickup-drag:start');
    expect(pickupStart?.sourceFrameIndex).toBe(60);
    expect(pickupStart?.targetFrame).toBe(30);
  });

  it('fails a deliberately shifted board comparison', () => {
    const width = 32;
    const height = 32;
    const reference = { width, height, data: new Uint8ClampedArray(width * height * 4) };
    const candidate = { width, height, data: new Uint8ClampedArray(width * height * 4) };
    for (let i = 0; i < reference.data.length; i += 4) {
      reference.data[i] = 10;
      reference.data[i + 1] = 80;
      reference.data[i + 2] = 20;
      reference.data[i + 3] = 255;
    }
    for (let i = 0; i < candidate.data.length; i += 4) {
      candidate.data[i] = 200;
      candidate.data[i + 1] = 10;
      candidate.data[i + 2] = 10;
      candidate.data[i + 3] = 255;
    }
    const comparison = compareCalibrationFrames(reference, candidate);
    expect(calibrationScore(comparison.metrics)).toBeLessThan(80);
    expect(comparison.metrics.changedPixelRatio).toBeGreaterThan(0.9);
  });
});

describe('shot profile', () => {
  it('keeps 9:16 composition when the DOM canvas changes', () => {
    const a = containedCompositionViewport(540, 960);
    const b = containedCompositionViewport(1080, 1920);
    const c = containedCompositionViewport(800, 800);
    expect(a.width / a.height).toBeCloseTo(FIXED_SHOT_PROFILE.compositionAspect, 8);
    expect(b.width / b.height).toBeCloseTo(FIXED_SHOT_PROFILE.compositionAspect, 8);
    expect(c.width / c.height).toBeCloseTo(FIXED_SHOT_PROFILE.compositionAspect, 8);
    expect(lockedCameraDistance(0)).toBeGreaterThan(17);
    expect(REFERENCE_PASS_ORDER).toHaveLength(9);
    expect(VIDEO_RESOLUTION).toEqual({ width: 1080, height: 1920 });
  });

  it('maps pick/pointer into the letterboxed composition, not the full canvas', () => {
    const rect = { left: 0, top: 0, width: 1920, height: 1080 };
    const canvas = { canvasWidth: 1920, canvasHeight: 1080, rect };
    const viewport = containedCompositionViewport(1920, 1080);
    const leftBar = mapClientPointToComposition({
      ...canvas,
      renderer: 'fixed-camera-cinematic',
      clientX: 10,
      clientY: 540,
    });
    expect(leftBar.inside).toBe(false);

    const compositionLeft = mapClientPointToComposition({
      ...canvas,
      renderer: 'fixed-camera-cinematic',
      clientX: viewport.x,
      clientY: 540,
    });
    expect(compositionLeft.inside).toBe(true);
    expect(compositionLeft.compositionX).toBeCloseTo(0, 8);
    expect(compositionLeft.compositionY).toBeCloseTo(0.5, 8);
    expect(compositionLeft.ndcX).toBeCloseTo(-1, 8);
    expect(compositionLeft.ndcY).toBeCloseTo(0, 8);
    const fullCanvasNdcX = (viewport.x / 1920) * 2 - 1;
    expect(Math.abs(compositionLeft.ndcX - fullCanvasNdcX)).toBeGreaterThan(0.5);

    const center = mapClientPointToComposition({
      ...canvas,
      renderer: 'fixed-camera-cinematic',
      clientX: 960,
      clientY: 540,
    });
    expect(center.inside).toBe(true);
    expect(center.compositionX).toBeCloseTo(0.5, 8);
    expect(center.ndcX).toBeCloseTo(0, 8);
    expect(center.ndcY).toBeCloseTo(0, 8);

    const orbitLeft = mapClientPointToComposition({
      ...canvas,
      renderer: 'three-3d',
      clientX: 10,
      clientY: 540,
    });
    expect(orbitLeft.inside).toBe(true);
    expect(orbitLeft.compositionX).toBeCloseTo(10 / 1920, 8);
  });

  it('rejects the vertical letterbox and converts CSS y to WebGL y from the bottom', () => {
    const tall = { left: 0, top: 40, width: 800, height: 1600 };
    const viewport = containedCompositionViewport(800, 1600);
    const above = mapClientPointToComposition({
      clientX: 400,
      clientY: tall.top + 10,
      rect: tall,
      renderer: 'fixed-camera-cinematic',
      canvasWidth: 800,
      canvasHeight: 1600,
    });
    expect(above.inside).toBe(false);

    const topOfFrame = mapClientPointToComposition({
      clientX: 400,
      clientY: tall.top + viewport.y,
      rect: tall,
      renderer: 'fixed-camera-cinematic',
      canvasWidth: 800,
      canvasHeight: 1600,
    });
    expect(topOfFrame.inside).toBe(true);
    expect(topOfFrame.compositionY).toBeCloseTo(0, 8);
    expect(topOfFrame.ndcY).toBeCloseTo(1, 8);
    const fullCanvasNdcY = -((viewport.y / 1600) * 2 - 1);
    expect(Math.abs(topOfFrame.ndcY - fullCanvasNdcY)).toBeGreaterThan(0.05);

    const centered = webglViewportFromCss(viewport, 1600);
    expect(centered.y).toBeCloseTo(viewport.y, 8);

    const offset = webglViewportFromCss({ x: 12, y: 40, width: 200, height: 300 }, 500);
    expect(offset).toEqual({ x: 12, y: 160, width: 200, height: 300 });
    expect(offset.y).not.toBe(40);
  });

  it('maps in CSS pixels; device pixel ratio is not a mapping input', () => {
    const css = mapClientPointToComposition({
      clientX: 980,
      clientY: 590,
      rect: { left: 20, top: 50, width: 1920, height: 1080 },
      renderer: 'fixed-camera-cinematic',
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
    const origin = mapClientPointToComposition({
      clientX: 960,
      clientY: 540,
      rect: { left: 0, top: 0, width: 1920, height: 1080 },
      renderer: 'fixed-camera-cinematic',
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
    expect(css.inside).toBe(origin.inside);
    expect(css.compositionX).toBeCloseTo(origin.compositionX, 8);
    expect(css.ndcX).toBeCloseTo(origin.ndcX, 8);
    expect(css).not.toHaveProperty('dpr');
  });
});

describe('capture plan', () => {
  it('resolves consecutive peak inside the compiled timeline', () => {
    const resolved = resolveTakeAnchor(consecutiveTake());
    expect(resolved.frames.peak).toBeGreaterThan(resolved.frames.pickup);
    expect(resolved.frames.peak).toBeLessThan(resolved.frames.end);
    expect(STILL_SPECS.some((item) => item.id === '2d-idle')).toBe(true);
    expect(STILL_SPECS.filter((item) => item.renderer === 'fixed-camera-cinematic').length).toBeGreaterThanOrEqual(3);
  });
});

describe('reference passes', () => {
  it('gates praise on the feedback pass rather than clear', () => {
    expect(PRAISE_PASS).toBe('feedback');
    expect(PASS_RESPONSIBILITIES.feedback).toMatch(/praise/i);
    expect(PASS_RESPONSIBILITIES.clear).not.toMatch(/praise/i);
    expect(isPassEnabled(['clear'], PRAISE_PASS)).toBe(false);
    expect(isPassEnabled(['feedback'], PRAISE_PASS)).toBe(true);
  });
});
