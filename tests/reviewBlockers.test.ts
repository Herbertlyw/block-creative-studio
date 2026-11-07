import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeFixture } from './headlessFixtures';
import {
  compileMaterialRuntime,
  defaultCombineForMaps,
  materialDescriptorKey,
  materialMapsPublicBase,
  parseMaterialRuntimeDescriptor,
  remapChannelsForThreeJsSlot,
  rewriteMaterialMapUriForBrowser,
} from '../src/headless/materialRuntime';
import { omitContentHash, stableStringify } from '../src/headless/stableHash';
import { compileVariant } from '../src/headless/variantCompiler';
import { AssetRegistry } from '../src/headless/assetRegistry';
import { createPbrTileMaterial } from '../src/renderer/pbrMaterialFactory';
import {
  assertSha256ContentHash,
  resolveMaterialMapFetchUrl,
  runtimeTextureResourceKey,
} from '../src/renderer/runtimeTextures';
import {
  containedCompositionViewport,
  mapClientPointToComposition,
  viewportPolicyForRenderer,
  webglViewportFromCss,
} from '../src/renderer/shotProfile';
import { createStudioVariantMatrix, studioPreviewStyle } from '../src/integration/studioVariantBridge';
import { overlayPlanMaterialOnStyle, planRenderEvidence, resolveStyleFromRenderPlan } from '../src/integration/studioAssetCatalog';
import { MaterialRuntimeLoadGate } from '../src/renderer/materialRuntimeLoadGate';
import { materialRuntimeBlocksExport, materialRuntimeReadyFor } from '../src/renderer/materialRuntimeStatus';
import { createUniversalClearEffect } from '../src/headless/universalClearEffect';
import { DEFAULT_STYLE } from '../src/renderer/stylePresets';
import { createCrossClearBoard } from '../src/domain/boardPresets';
import { createGame, createPieceSet } from '../src/domain/gameEngine';
import { RHYTHM_PRESETS } from '../src/director/rhythmPresets';
import type { MaterialPackManifest } from '../src/headless/contracts';
import type { ProjectSpec } from '../src/domain/types';
import { compileRegisteredMaterialPlan } from '../src/capture/materialVariants';
import { STILL_SPECS } from '../src/capture/capturePlan';
import { collectRuntimeAssetRequests } from '../src/assets/runtimeAssetBindings';

function packPath(name: string): string {
  return resolve(process.cwd(), `examples/headless/materials/${name}`);
}

function canonicalSha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

describe('review blockers', () => {
  it('rejects duplicate slots, packed ORM plus split maps, and illegal channel shapes', () => {
    const { material } = makeFixture();
    expect(() => compileMaterialRuntime({
      pack: material,
      maps: [
        { slot: 'orm', uri: 'maps/orm.png', contentHash: `sha256:${'a'.repeat(64)}`, channels: 'r', colorSpace: 'linear' },
      ],
    })).toThrow(/channels|CHANNEL/i);

    expect(() => compileMaterialRuntime({
      pack: material,
      maps: [
        { slot: 'normal', uri: 'maps/n.png', contentHash: `sha256:${'b'.repeat(64)}`, channels: 'r', colorSpace: 'linear', normalY: 'opengl' },
      ],
    })).toThrow(/channels|CHANNEL/i);

    expect(() => compileMaterialRuntime({
      pack: material,
      maps: [
        { slot: 'orm', uri: 'maps/orm.png', contentHash: `sha256:${'c'.repeat(64)}`, channels: 'rgb', colorSpace: 'linear' },
        { slot: 'roughness', uri: 'maps/r.png', contentHash: `sha256:${'d'.repeat(64)}`, channels: 'r', colorSpace: 'linear' },
      ],
    })).toThrow(/ORM|conflict/i);

    expect(() => compileMaterialRuntime({
      pack: material,
      maps: [
        { slot: 'baseColor', uri: 'maps/a.png', contentHash: `sha256:${'e'.repeat(64)}`, channels: 'rgb', colorSpace: 'srgb' },
        { slot: 'baseColor', uri: 'maps/b.png', contentHash: `sha256:${'f'.repeat(64)}`, channels: 'rgb', colorSpace: 'srgb' },
      ],
    })).toThrow(/duplicate|SLOT/i);

    const valid = compileMaterialRuntime({
      pack: material,
      maps: [
        { slot: 'orm', uri: 'maps/orm.png', contentHash: `sha256:${'c'.repeat(64)}`, channels: 'rgb', colorSpace: 'linear' },
      ],
    });
    const forged = structuredClone(valid);
    forged.maps.push({
      slot: 'roughness',
      uri: 'maps/r.png',
      contentHash: `sha256:${'d'.repeat(64)}`,
      channels: 'r',
      colorSpace: 'linear',
    });
    expect(() => parseMaterialRuntimeDescriptor(forged)).toThrow(/ORM|conflict/i);
  });

  it('separates texture resource identity from material descriptor identity', () => {
    const { material } = makeFixture();
    const maps = [{
      slot: 'baseColor' as const,
      uri: 'maps/shared.png',
      contentHash: `sha256:${'a'.repeat(64)}`,
      channels: 'rgb' as const,
      colorSpace: 'srgb' as const,
    }];
    const first = compileMaterialRuntime({ pack: material, maps, uv: { repeat: [1, 1], offset: [0, 0], rotationRadians: 0 } });
    const second = compileMaterialRuntime({
      pack: { ...material, appearance: { ...material.appearance, roughness: 0.91, baseColor: '#112233' } },
      maps,
      uv: { repeat: [2, 2], offset: [0.1, 0], rotationRadians: 0.2 },
    });
    expect(runtimeTextureResourceKey(first.maps)).toBe(runtimeTextureResourceKey(second.maps));
    expect(materialDescriptorKey(first)).not.toBe(materialDescriptorKey(second));

    const colorSpaceShift = runtimeTextureResourceKey([{
      slot: 'baseColor',
      uri: 'maps/shared.png',
      contentHash: `sha256:${'a'.repeat(64)}`,
      channels: 'rgb',
      colorSpace: 'linear',
    }]);
    expect(colorSpaceShift).not.toBe(runtimeTextureResourceKey(first.maps));

    const parameterOnlyA = compileMaterialRuntime({ pack: material });
    const parameterOnlyB = compileMaterialRuntime({
      pack: { ...material, appearance: { ...material.appearance, metalness: 0.11 } },
    });
    expect(runtimeTextureResourceKey(parameterOnlyA.maps)).toBe(runtimeTextureResourceKey(parameterOnlyB.maps));
    expect(materialDescriptorKey(parameterOnlyA)).not.toBe(materialDescriptorKey(parameterOnlyB));
  });

  it('implements replace vs multiply on the MeshPhysicalMaterial factory path', () => {
    const { material } = makeFixture();
    material.appearance.specular = 0.42;
    material.appearance.emission = 0;
    const maps = [
      { slot: 'baseColor' as const, uri: 'maps/c.png', contentHash: `sha256:${'a'.repeat(64)}`, channels: 'rgb' as const, colorSpace: 'srgb' as const },
      { slot: 'roughness' as const, uri: 'maps/r.png', contentHash: `sha256:${'b'.repeat(64)}`, channels: 'r' as const, colorSpace: 'linear' as const },
      { slot: 'metallic' as const, uri: 'maps/m.png', contentHash: `sha256:${'c'.repeat(64)}`, channels: 'r' as const, colorSpace: 'linear' as const },
      { slot: 'emission' as const, uri: 'maps/e.png', contentHash: `sha256:${'d'.repeat(64)}`, channels: 'rgb' as const, colorSpace: 'srgb' as const },
    ];
    const textures = {
      baseColor: new THREE.Texture(),
      roughness: new THREE.Texture(),
      metallic: new THREE.Texture(),
      emission: new THREE.Texture(),
    };
    const replace = createPbrTileMaterial({
      descriptor: compileMaterialRuntime({ pack: material, maps, combine: 'replace' }),
      color: 'coral',
      textures,
    });
    expect(replace.roughness).toBe(1);
    expect(replace.metalness).toBe(1);
    expect(replace.color.getHex()).toBe(0xffffff);
    expect(replace.emissive.r).toBe(0);
    expect(replace.emissive.g).toBe(0);
    expect(replace.emissive.b).toBe(0);
    expect(replace.emissiveMap).toBe(textures.emission);
    expect(replace.specularIntensity).toBeCloseTo(0.42);
    replace.dispose();

    const { emission: _explicitZero, ...appearanceWithoutEmission } = material.appearance;
    const mappedDefault = createPbrTileMaterial({
      descriptor: compileMaterialRuntime({
        pack: { ...material, appearance: { ...appearanceWithoutEmission, specular: 0.42 } },
        maps,
        combine: 'replace',
      }),
      color: 'coral',
      textures,
    });
    expect(mappedDefault.emissive.r).toBe(1);
    expect(mappedDefault.emissive.g).toBe(1);
    expect(mappedDefault.emissive.b).toBe(1);
    mappedDefault.dispose();

    const multiply = createPbrTileMaterial({
      descriptor: compileMaterialRuntime({ pack: material, maps, combine: 'multiply-factor' }),
      color: 'coral',
      textures,
    });
    expect(multiply.roughness).toBeCloseTo(material.appearance.roughness);
    expect(multiply.metalness).toBeCloseTo(material.appearance.metalness);
    expect(multiply.color.getHex()).not.toBe(0xffffff);
    multiply.dispose();
  });

  it('does not skip an uncommitted empty descriptor key', () => {
    const gate = new MaterialRuntimeLoadGate();
    expect(gate.shouldSkip('')).toBe(false);
    expect(gate.commit(gate.begin(), '')).toBe(true);
    expect(gate.shouldSkip('')).toBe(true);
  });

  it('rejects non-sha256 hashes and mismatched digests before GPU upload', () => {
    expect(() => assertSha256ContentHash('fnv1a32:deadbeef', 'a'.repeat(64))).toThrow(/Hash 不符/);
    expect(() => assertSha256ContentHash(`sha256:${'a'.repeat(64)}`, 'b'.repeat(64))).toThrow(/Hash 不符/);
    expect(() => assertSha256ContentHash(`sha256:${'a'.repeat(64)}`, 'a'.repeat(64))).not.toThrow();
  });

  it('applies a different viewport policy when switching to fixed-camera-cinematic', () => {
    const orbit = viewportPolicyForRenderer('three-3d', 1920, 1080);
    const locked = viewportPolicyForRenderer('fixed-camera-cinematic', 1920, 1080);
    expect(orbit.scissorTest).toBe(false);
    expect(orbit.viewport.x).toBe(0);
    expect(orbit.aspect).toBeCloseTo(1920 / 1080);
    expect(locked.scissorTest).toBe(true);
    expect(locked.aspect).not.toBe(orbit.aspect);
    expect(locked.viewport.width).toBeLessThan(1920);
    const gl = webglViewportFromCss(locked.viewport, 1080);
    expect(gl.y).toBeCloseTo(1080 - locked.viewport.y - locked.viewport.height, 8);
  });

  it('does not report a letterbox pick as a composition hit', () => {
    const viewport = containedCompositionViewport(1920, 1080);
    const miss = mapClientPointToComposition({
      clientX: viewport.x - 8,
      clientY: 540,
      rect: { left: 0, top: 0, width: 1920, height: 1080 },
      renderer: 'fixed-camera-cinematic',
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
    const hit = mapClientPointToComposition({
      clientX: viewport.x + viewport.width / 2,
      clientY: 540,
      rect: { left: 0, top: 0, width: 1920, height: 1080 },
      renderer: 'fixed-camera-cinematic',
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
    expect(miss.inside).toBe(false);
    expect(hit.inside).toBe(true);
    expect(hit.ndcX).toBeCloseTo(0, 8);
  });

  it('attaches Plan materialRuntime on the official Studio variant path', () => {
    const project: ProjectSpec = {
      schemaVersion: '1.0.0',
      id: 'review-style-adapter',
      name: 'Review adapter',
      ruleProfile: 'block-placement-classic-v1',
      seed: 41782,
      setupBoard: createCrossClearBoard(),
      setupPieces: createPieceSet(41782, 0, ['single', 'tri-h', 'square-2']),
      style: structuredClone(DEFAULT_STYLE),
      rhythm: { ...RHYTHM_PRESETS['human-natural'] },
      render: { width: 1080, height: 1920, fps: 30, quality: 'standard' },
    };
    const matrix = createStudioVariantMatrix({
      project,
      selectedTake: null,
      compiledTake: null,
      requestedLockMode: 'frame-exact',
      selectedLookKey: 'project-current',
      importedAssets: [],
      importedRecipes: [],
    });
    const row = matrix.rows[0];
    expect(row?.error).toBeNull();
    expect(row?.resolvedStyle.materialRuntime).toBeDefined();
    expect(row?.resolvedStyle.materialRuntime?.materialClass).toBeTruthy();
    expect(row?.resolvedStyle.renderer).toBe(project.style.renderer);
    expect(studioPreviewStyle(row, project.style).materialRuntime).toEqual(row?.resolvedStyle.materialRuntime);
    const unboundPreview = studioPreviewStyle(
      row ? { ...row, previewSupported: false } : null,
      project.style,
    );
    expect(unboundPreview.materialRuntime).toEqual(row?.resolvedStyle.materialRuntime);
    expect(unboundPreview.renderer).toBe('fixed-camera-cinematic');
  });

  it('stores canonical sha256 content hashes on the three fixture material packs', () => {
    for (const file of ['material.stainless-steel.json', 'material.oak-wood.json', 'material.aurora-shell.json']) {
      const pack = JSON.parse(readFileSync(packPath(file), 'utf8')) as Record<string, unknown>;
      expect(String(pack.contentHash)).toBe(canonicalSha256(omitContentHash(pack)));
      expect(String(pack.contentHash)).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(String(pack.contentHash)).not.toMatch(/^sha256:(.)\1+$/);
    }
  });

  it('stores canonical sha256 hashes on capture Effect/Look fixtures, not repeating placeholders', () => {
    const files = [
      'examples/headless/assets/effect.universal-clear.json',
      'examples/headless/assets/effect.copper-clear.json',
      'examples/headless/assets/material.copper.json',
      'examples/headless/assets/look.copper.json',
    ];
    for (const rel of files) {
      const pack = JSON.parse(readFileSync(resolve(process.cwd(), rel), 'utf8')) as Record<string, unknown>;
      expect(String(pack.contentHash)).toBe(canonicalSha256(omitContentHash(pack)));
      expect(String(pack.contentHash)).not.toMatch(/^sha256:(.)\1+$/);
    }
    const look = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/assets/look.copper.json'), 'utf8')) as {
      slots: Record<string, { id: string; contentHash: string }>;
    };
    const copper = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/assets/material.copper.json'), 'utf8')) as { contentHash: string };
    expect(look.slots['tile.material']?.contentHash).toBe(copper.contentHash);
    const recipe = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/variant.copper.demo.json'), 'utf8')) as {
      lookPackRef: { contentHash: string };
    };
    const lookPack = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/assets/look.copper.json'), 'utf8')) as { contentHash: string };
    expect(recipe.lookPackRef.contentHash).toBe(lookPack.contentHash);
    const master = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/master.demo.json'), 'utf8')) as {
      layoutProfileRef: { id: string; contentHash: string };
      cameraProfileRef: { id: string; contentHash: string };
    };
    const layout = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/assets/layout.vertical.json'), 'utf8')) as { contentHash: string };
    const camera = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/assets/camera.fixed.json'), 'utf8')) as { contentHash: string };
    expect(master.layoutProfileRef.contentHash).toBe(layout.contentHash);
    expect(master.cameraProfileRef.contentHash).toBe(camera.contentHash);
    expect(createUniversalClearEffect().contentHash).toBe(
      (JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/assets/effect.universal-clear.json'), 'utf8')) as { contentHash: string }).contentHash,
    );
  });

  it('defaults mapped packs to replace combine so albedo is not multiplied by tile color', () => {
    expect(defaultCombineForMaps([{
      slot: 'baseColor',
      uri: 'maps/a.png',
      contentHash: `sha256:${'a'.repeat(64)}`,
      channels: 'rgb',
      colorSpace: 'srgb',
    }])).toBe('replace');
    expect(defaultCombineForMaps([])).toBe('multiply-factor');
    const steel = JSON.parse(readFileSync(packPath('material.stainless-steel.json'), 'utf8')) as MaterialPackManifest;
    expect(compileMaterialRuntime({ pack: steel }).combine).toBe('replace');
    const aurora = JSON.parse(readFileSync(packPath('material.aurora-shell.json'), 'utf8')) as MaterialPackManifest;
    expect(compileMaterialRuntime({ pack: aurora }).combine).toBe('multiply-factor');
  });

  it('blocks formal export unless the committed material is ready', () => {
    expect(materialRuntimeBlocksExport({
      state: 'stale',
      generation: 1,
      resourceKey: 'a',
      descriptorKey: 'b',
      error: null,
      showingPrevious: true,
    })).toBe(true);
    expect(materialRuntimeBlocksExport({
      state: 'ready',
      generation: 1,
      resourceKey: 'a',
      descriptorKey: 'b',
      error: null,
      showingPrevious: false,
    })).toBe(false);
  });

  it('captures material diagnostics on idle with Neutral LookDev, not clear peak', () => {
    const diagnostics = STILL_SPECS.filter((item) => item.role === 'diagnostic');
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const spec of diagnostics) {
      expect(spec.anchor).toBe('idle');
      expect(spec.lookDevId).toBe('neutral-lookdev');
    }
    expect(STILL_SPECS.some((item) => item.id === '3d-steel-idle')).toBe(true);
  });

  it('fails wood against metal-only copper-clear unless a compatible effect is selected', () => {
    const wood = JSON.parse(readFileSync(packPath('material.oak-wood.json'), 'utf8')) as MaterialPackManifest;
    const fixture = makeFixture();
    const registry = new AssetRegistry();
    for (const asset of fixture.assets) registry.register(asset, { replace: true });
    registry.register(wood, { replace: true });
    expect(() => compileVariant(fixture.master, {
      ...fixture.recipe,
      slotOverrides: {
        'tile.material': {
          id: wood.id,
          version: wood.version,
          kind: 'material-pack',
          ...(wood.contentHash ? { contentHash: wood.contentHash } : {}),
        },
      },
    }, registry, { renderer: 'fixed-camera-cinematic', requireHashes: true })).toThrow(/does not support material class wood/i);
  });

  it('does not declare Reference 2D support on PBR fixture packs', () => {
    for (const file of ['material.stainless-steel.json', 'material.oak-wood.json', 'material.aurora-shell.json']) {
      const pack = JSON.parse(readFileSync(packPath(file), 'utf8')) as { runtime: { renderers: string[] } };
      expect(pack.runtime.renderers).not.toContain('reference-2d');
      expect(pack.runtime.renderers).toContain('fixed-camera-cinematic');
    }
  });

  it('prefixes public PBR map URIs with the Vite/Pages BASE_URL', () => {
    const pages = materialMapsPublicBase('/block-creative-studio/');
    expect(rewriteMaterialMapUriForBrowser('examples/headless/materials/maps/steel-basecolor.png', pages))
      .toBe('/block-creative-studio/materials/maps/steel-basecolor.png');
    expect(rewriteMaterialMapUriForBrowser('/materials/maps/wood-basecolor.png', pages))
      .toBe('/block-creative-studio/materials/maps/wood-basecolor.png');
    expect(pages).not.toBe('/materials/maps');
  });

  it('resolves bcs-asset PBR maps from PreparedResources instead of fetching the custom scheme', () => {
    const map = {
      slot: 'baseColor' as const,
      uri: `bcs-asset://sha256/${'a'.repeat(64)}`,
      contentHash: `sha256:${'a'.repeat(64)}`,
      channels: 'rgb' as const,
      colorSpace: 'srgb' as const,
    };
    expect(() => resolveMaterialMapFetchUrl(map)).toThrow(/PreparedResources/);
    const url = resolveMaterialMapFetchUrl(map, {
      revision: 'test',
      background: null,
      tileFace: null,
      particleSprites: [],
      binary: [],
      missing: [],
      textureMaps: [{
        slotId: 'tile.material',
        role: 'texture-map',
        contentHash: map.contentHash,
        sourceUri: map.uri,
        objectUrl: 'blob:prepared-albedo',
        fileName: 'albedo.png',
        mimeType: 'image/png',
        fit: 'contain',
        opacity: 1,
        blendMode: 'source-over',
        inset: 0,
      }],
    });
    expect(url).toBe('blob:prepared-albedo');
  });

  it('requires the committed descriptor key before formal 3D export', () => {
    const readyA = {
      state: 'ready' as const,
      generation: 1,
      resourceKey: 'a',
      descriptorKey: 'steel',
      error: null,
      showingPrevious: false,
    };
    expect(materialRuntimeReadyFor(readyA, { descriptorKey: 'steel' })).toBe(true);
    expect(materialRuntimeReadyFor(readyA, { descriptorKey: 'wood' })).toBe(false);
    expect(materialRuntimeBlocksExport(readyA, { descriptorKey: 'wood' })).toBe(true);
  });

  it('copies emission R into RGB and does not keep a 2D fallback when overlaying Plan material', () => {
    expect(remapChannelsForThreeJsSlot({ r: 40, g: 1, b: 2, a: 255 }, 'emission', 'r')).toEqual({
      r: 40, g: 40, b: 40, a: 255,
    });
    const style = overlayPlanMaterialOnStyle(structuredClone(DEFAULT_STYLE), {
      contract: 'bcs.material-runtime',
      contractVersion: '1.0.0',
      id: 'material.overlay',
      version: '1.0.0',
      contentHash: `sha256:${'a'.repeat(64)}`,
      materialClass: 'metal',
      baseColor: '#ffffff',
      roughness: 0.2,
      metalness: 0.8,
      maps: [],
      uv: { repeat: [1, 1], offset: [0, 0], rotationRadians: 0 },
      combine: 'replace',
      capabilities: {
        heightDisplacement: 'unsupported',
        anisotropy: 'unsupported',
        subsurface: 'unsupported',
        complexTransmission: 'unsupported',
        materialAwareFracture: 'pending',
      },
      unsupportedFields: [],
      behaviorPending: true,
    });
    expect(DEFAULT_STYLE.renderer).toBe('reference-2d');
    expect(style.renderer).toBe('fixed-camera-cinematic');
  });

  it('records validated Plan effect/camera separately from the rendered fx preset', () => {
    const fixture = makeFixture();
    const steel = JSON.parse(readFileSync(packPath('material.stainless-steel.json'), 'utf8')) as MaterialPackManifest;
    const compiled = compileRegisteredMaterialPlan(steel, {
      master: fixture.master,
      recipe: fixture.recipe,
      assets: fixture.assets,
    });
    const style = overlayPlanMaterialOnStyle(structuredClone(DEFAULT_STYLE), compiled.runtime);
    const evidence = planRenderEvidence(compiled.plan, { ...style, fx: 'crystal-shatter' });
    expect(evidence.validatedEffectId).toBe('effect.universal-clear');
    expect(evidence.renderedFxPreset).toBe('crystal-shatter');
    expect(evidence.effectDrivesPixels).toBe(true);
    expect(evidence.validatedCameraId).toBeTruthy();
    expect(evidence.cameraDrivesPixels).toBe(false);
    expect(evidence.layoutDrivesPixels).toBe(false);
    const resolved = resolveStyleFromRenderPlan(compiled.plan, structuredClone(DEFAULT_STYLE));
    const resolvedEvidence = planRenderEvidence(compiled.plan, resolved.style);
    expect(resolvedEvidence.cameraDrivesPixels).toBe(true);
    expect(resolvedEvidence.layoutDrivesPixels).toBe(true);
  });

  it('resolves MaterialPack bcs-asset texture refs through PreparedResources', () => {
    const fixture = makeFixture();
    const digest = '9'.repeat(64);
    const uri = `bcs-asset://sha256/${digest}`;
    const contentHash = `sha256:${digest}`;
    fixture.material.appearance.textureRefs = {
      baseColor: {
        id: 'tex.review.base',
        version: '1.0.0',
        kind: 'bitmap',
        uri,
        contentHash,
        channels: 'rgb',
        colorSpace: 'srgb',
      },
    };
    const compiled = compileRegisteredMaterialPlan(fixture.material, {
      master: fixture.master,
      recipe: fixture.recipe,
      assets: fixture.assets,
    });
    const requests = collectRuntimeAssetRequests(compiled.plan);
    expect(requests.some((request) => request.contentHash === contentHash && request.role === 'texture-map')).toBe(true);
    const map = compiled.runtime.maps.find((item) => item.slot === 'baseColor');
    expect(map?.uri).toBe(uri);
    expect(() => resolveMaterialMapFetchUrl(map!)).toThrow(/PreparedResources/);
    expect(resolveMaterialMapFetchUrl(map!, {
      revision: 'test',
      background: null,
      tileFace: null,
      particleSprites: [],
      binary: [],
      missing: [],
      textureMaps: [{
        slotId: 'tile.material.baseColor',
        role: 'texture-map',
        contentHash,
        sourceUri: uri,
        objectUrl: 'blob:review-pbr',
        fileName: 'tex.review.base.png',
        mimeType: 'image/png',
        fit: 'contain',
        opacity: 1,
        blendMode: 'source-over',
        inset: 0,
      }],
    })).toBe('blob:review-pbr');
  });
});
