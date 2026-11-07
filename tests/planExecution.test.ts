import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeFixture } from './headlessFixtures';
import type { MaterialPackManifest, ResolvedRenderPlan } from '../src/headless/contracts';
import { compileRegisteredMaterialPlan } from '../src/capture/materialVariants';
import {
  overlayPlanMaterialOnStyle,
  planRenderEvidence,
  resolveStyleFromRenderPlan,
} from '../src/integration/studioAssetCatalog';
import { DEFAULT_STYLE } from '../src/renderer/stylePresets';
import {
  shotExecutionFromPlan,
  shotDrivesCameraPixels,
  shotDrivesLayoutPixels,
} from '../src/renderer/planShotAdapter';
import {
  containedCompositionViewport,
  lockedCameraDistance,
  viewportPolicyForRenderer,
  FIXED_SHOT_PROFILE,
} from '../src/renderer/shotProfile';
import { cellUvJitter, createPbrTileMaterial } from '../src/renderer/pbrMaterialFactory';
import {
  defaultMaterialBehavior,
  shardMotionForBehavior,
  shardScaleForBehavior,
} from '../src/renderer/materialFracture';

function packPath(name: string): string {
  return resolve(process.cwd(), `examples/headless/materials/${name}`);
}

function exampleAsset(name: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), `examples/headless/assets/${name}`), 'utf8'));
}

function compileSteel() {
  const fixture = makeFixture();
  const steel = JSON.parse(readFileSync(packPath('material.stainless-steel.json'), 'utf8')) as MaterialPackManifest;
  return compileRegisteredMaterialPlan(steel, {
    master: fixture.master,
    recipe: fixture.recipe,
    assets: fixture.assets,
  });
}

describe('plan shot execution', () => {
  it('reads camera.fixed and layout.vertical fields from the example manifests', () => {
    const camera = exampleAsset('camera.fixed.json') as {
      id: string;
      metadata: { designResolution: { width: number; height: number }; boardScreenRect: object; maximumScreenZoom: number };
    };
    const layout = exampleAsset('layout.vertical.json') as {
      id: string;
      metadata: { designResolution: { width: number; height: number } };
    };
    expect(camera.metadata.designResolution).toEqual({ width: 1080, height: 1920 });
    expect(camera.metadata.boardScreenRect).toEqual({ x: 78, y: 332, width: 924, height: 924 });
    expect(camera.metadata.maximumScreenZoom).toBe(1.025);
    expect(layout.metadata.designResolution).toEqual({ width: 1080, height: 1920 });
  });

  it('builds a shot from the compiled Plan and keeps pose/FOV as fallback', () => {
    const compiled = compileSteel();
    const shot = shotExecutionFromPlan(compiled.plan);
    expect(shot.cameraProfileId).toBe('camera.fixed');
    expect(shot.layoutProfileId).toBe('layout.vertical');
    expect(shot.designResolution).toEqual({ width: 1080, height: 1920 });
    expect(shot.boardScreenRect).toEqual({ x: 78, y: 332, width: 924, height: 924 });
    expect(shot.maximumScreenZoom).toBe(1.025);
    expect(shot.compositionAspect).toBeCloseTo(1080 / 1920, 8);
    expect(shot.poseSource).toBe('fallback-fixed-shot');
    expect(shot.fovSource).toBe('fallback-fixed-shot');
    expect(shot.verticalFovDegrees).toBe(FIXED_SHOT_PROFILE.verticalFovDegrees);
    expect(shot.cameraFieldsFromPlan).toEqual({
      designResolution: true,
      boardScreenRect: true,
      maximumScreenZoom: true,
    });
    expect(shot.layoutFieldsFromPlan.designResolution).toBe(true);
  });

  it('does not claim camera/layout pixels when only the material overlay is applied', () => {
    const compiled = compileSteel();
    const style = overlayPlanMaterialOnStyle(structuredClone(DEFAULT_STYLE), compiled.runtime);
    const evidence = planRenderEvidence(compiled.plan, { ...style, fx: 'crystal-shatter' });
    expect(style.shotExecution).toBeUndefined();
    expect(evidence.cameraDrivesPixels).toBe(false);
    expect(evidence.layoutDrivesPixels).toBe(false);
    expect(evidence.effectDrivesPixels).toBe(true);
  });

  it('marks camera/layout as driving pixels only after resolveStyleFromRenderPlan attaches the shot', () => {
    const compiled = compileSteel();
    const { style } = resolveStyleFromRenderPlan(compiled.plan, structuredClone(DEFAULT_STYLE));
    expect(style.renderer).toBe('fixed-camera-cinematic');
    expect(style.shotExecution?.maximumScreenZoom).toBe(1.025);
    expect(style.materialBehavior?.fractureMode).toBe('chips');
    expect(shotDrivesCameraPixels(compiled.plan, style)).toBe(true);
    expect(shotDrivesLayoutPixels(compiled.plan, style)).toBe(true);
    const evidence = planRenderEvidence(compiled.plan, style);
    expect(evidence.cameraDrivesPixels).toBe(true);
    expect(evidence.layoutDrivesPixels).toBe(true);
    expect(evidence.renderedCameraProfile).toBe('camera.fixed');
    expect(evidence.renderedLayoutProfile).toBe('1080x1920');
    expect(evidence.validatedCameraId).toBe('camera.fixed');
    expect(evidence.validatedLayoutId).toBe('layout.vertical');
  });

  it('changes cinematic letterbox when the Plan layout design aspect is not 9:16', () => {
    const fixture = makeFixture();
    const layout = fixture.assets.find((asset) => asset.id === 'layout.vertical');
    if (!layout) throw new Error('missing layout.vertical');
    layout.metadata = {
      ...(layout.metadata ?? {}),
      designResolution: { width: 1000, height: 2000 },
    };
    const steel = JSON.parse(readFileSync(packPath('material.stainless-steel.json'), 'utf8')) as MaterialPackManifest;
    const compiled = compileRegisteredMaterialPlan(steel, {
      master: fixture.master,
      recipe: fixture.recipe,
      assets: fixture.assets,
    });
    const shot = shotExecutionFromPlan(compiled.plan);
    expect(shot.compositionAspect).toBeCloseTo(0.5, 8);
    const planViewport = containedCompositionViewport(800, 800, shot.compositionAspect);
    const fixedViewport = containedCompositionViewport(800, 800);
    expect(planViewport.width / planViewport.height).toBeCloseTo(0.5, 8);
    expect(fixedViewport.width / fixedViewport.height).toBeCloseTo(FIXED_SHOT_PROFILE.compositionAspect, 8);
    expect(planViewport.width).not.toBeCloseTo(fixedViewport.width, 4);
    const policy = viewportPolicyForRenderer('fixed-camera-cinematic', 800, 800, shot);
    expect(policy.aspect).toBeCloseTo(0.5, 8);
  });

  it('uses Plan maximumScreenZoom in locked camera distance when punch exceeds the cap', () => {
    const compiled = compileSteel();
    const shot = shotExecutionFromPlan(compiled.plan);
    const rest = lockedCameraDistance(0, shot);
    const punched = lockedCameraDistance(8, shot);
    const fixedPunched = lockedCameraDistance(8);
    expect(rest).toBeGreaterThan(punched);
    expect(shot.maximumScreenZoom).toBeLessThan(FIXED_SHOT_PROFILE.maximumScreenZoom);
    expect(punched).not.toBeCloseTo(fixedPunched, 6);
  });
});

describe('per-cell UV and fracture profiles', () => {
  it('gives neighboring cells different deterministic UV jitter', () => {
    const a = cellUvJitter(0, 0);
    const b = cellUvJitter(0, 1);
    const again = cellUvJitter(0, 0);
    expect(a).toEqual(again);
    expect(a.offset[0]).not.toBeCloseTo(b.offset[0], 8);
    expect(a.rotationRadians).not.toBeCloseTo(b.rotationRadians, 8);
  });

  it('clones shared textures per cell so UV writes do not collide', () => {
    const fixture = makeFixture();
    const steel = JSON.parse(readFileSync(packPath('material.stainless-steel.json'), 'utf8')) as MaterialPackManifest;
    const compiled = compileRegisteredMaterialPlan(steel, {
      master: fixture.master,
      recipe: fixture.recipe,
      assets: fixture.assets,
    });
    const source = new THREE.Texture();
    source.image = { width: 8, height: 8 };
    const first = createPbrTileMaterial({
      descriptor: compiled.runtime,
      color: 'coral',
      textures: { baseColor: source },
      cell: { row: 0, col: 0 },
    });
    const second = createPbrTileMaterial({
      descriptor: compiled.runtime,
      color: 'coral',
      textures: { baseColor: source },
      cell: { row: 3, col: 5 },
    });
    const shared = createPbrTileMaterial({
      descriptor: compiled.runtime,
      color: 'coral',
      textures: { baseColor: source },
    });
    expect(shared.map).toBe(source);
    expect(first.map).not.toBe(source);
    expect(second.map).not.toBe(source);
    expect(first.map).not.toBe(second.map);
    expect(first.map?.image).toBe(source.image);
    expect(second.map?.image).toBe(source.image);
    expect(first.map?.offset.equals(second.map!.offset)).toBe(false);
    first.dispose();
    second.dispose();
    shared.dispose();
  });

  it('gives wood splinters, metal chips and glass shards different scale and motion', () => {
    const wood = defaultMaterialBehavior('wood');
    const metal = defaultMaterialBehavior('metal');
    const glass = defaultMaterialBehavior('glass');
    const jelly = defaultMaterialBehavior('jelly');
    expect(wood.fractureMode).toBe('splinters');
    expect(metal.fractureMode).toBe('chips');
    expect(glass.fractureMode).toBe('radial-shards');
    expect(jelly.fractureMode).toBe('soft-tear');
    const woodScale = shardScaleForBehavior(wood, 1, 0.1);
    const metalScale = shardScaleForBehavior(metal, 1, 0.1);
    const glassScale = shardScaleForBehavior(glass, 1, 0.1);
    expect(woodScale.y / woodScale.x).toBeGreaterThan(metalScale.y / metalScale.x);
    expect(glassScale.y / glassScale.x).toBeGreaterThan(metalScale.y / metalScale.x);
    const woodMotion = shardMotionForBehavior(wood, 2, 2);
    const jellyMotion = shardMotionForBehavior(jelly, 2, 2);
    expect(jellyMotion.gravity).toBeLessThan(woodMotion.gravity);
    expect(jellyMotion.drag).toBeGreaterThan(woodMotion.drag);
  });

  it('attaches oak-wood pack behavior when resolving a wood Plan', () => {
    const fixture = makeFixture();
    const wood = JSON.parse(readFileSync(packPath('material.oak-wood.json'), 'utf8')) as MaterialPackManifest;
    const compiled = compileRegisteredMaterialPlan(wood, {
      master: fixture.master,
      recipe: fixture.recipe,
      assets: fixture.assets,
    });
    const { style } = resolveStyleFromRenderPlan(compiled.plan, structuredClone(DEFAULT_STYLE));
    expect(style.materialBehavior?.materialClass).toBe('wood');
    expect(style.materialBehavior?.fractureMode).toBe('splinters');
    expect(style.shotExecution?.cameraFieldsFromPlan.maximumScreenZoom).toBe(true);
  });
});

describe('plan identity typing', () => {
  it('keeps ResolvedRenderPlan renderer on the compiled steel plan', () => {
    const compiled = compileSteel();
    const plan: ResolvedRenderPlan = compiled.plan;
    expect(plan.renderer).toBe('fixed-camera-cinematic');
  });
});
