import { describe, expect, it } from 'vitest';
import { RHYTHM_PRESETS } from '../src/director/rhythmPresets';
import { createCrossClearBoard } from '../src/domain/boardPresets';
import { createGame, createPieceSet, makeAgentTake } from '../src/domain/gameEngine';
import { parseStudioBundle, type StudioBundle } from '../src/domain/projectValidation';
import type { ProjectSpec } from '../src/domain/types';
import { DEFAULT_STYLE } from '../src/renderer/stylePresets';
import { compileMaterialRuntime } from '../src/headless/materialRuntime';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function bundle(): StudioBundle {
  const seed = 41782;
  const setupPieces = createPieceSet(seed, 0, ['single', 'tri-h', 'square-2']);
  const project: ProjectSpec = {
    schemaVersion: '1.0.0',
    id: 'validation-fixture',
    name: 'Validation Fixture',
    ruleProfile: 'block-placement-classic-v1',
    seed,
    setupBoard: createCrossClearBoard(),
    setupPieces,
    style: structuredClone(DEFAULT_STYLE),
    rhythm: { ...RHYTHM_PRESETS['human-natural'] },
    render: { width: 1080, height: 1920, fps: 30, quality: 'standard' },
  };
  const initial = createGame(project.setupBoard, seed, setupPieces);
  return {
    format: 'block-creative-studio-project',
    version: '1.0.0',
    project,
    takes: [makeAgentTake(initial, 2)],
  };
}

describe('project validation', () => {
  it('accepts a complete project bundle', () => {
    const parsed = parseStudioBundle(structuredClone(bundle()));
    expect(parsed.project.seed).toBe(41782);
    expect(parsed.takes).toHaveLength(1);
  });


  it('accepts per-cell colors and preserves the reference 2D renderer profile', () => {
    const payload = structuredClone(bundle());
    payload.project.setupPieces[1]!.cellColors = ['coral', 'lime', 'blue'];
    payload.takes[0]!.initial.pieces[1]!.cellColors = ['coral', 'lime', 'blue'];
    payload.project.style.renderer = 'reference-2d';
    payload.project.style.reference2d.bestScore = 22634;
    const parsed = parseStudioBundle(payload);
    expect(parsed.project.setupPieces[1]!.cellColors).toEqual(['coral', 'lime', 'blue']);
    expect(parsed.project.style.renderer).toBe('reference-2d');
  });

  it('rejects a per-cell color array that does not match the selected shape', () => {
    const payload = structuredClone(bundle());
    payload.project.setupPieces[1]!.cellColors = ['coral'];
    expect(() => parseStudioBundle(payload)).toThrow(/形状单元数量/);
  });

  it('rejects unknown colors in a per-cell color array', () => {
    const payload = structuredClone(bundle()) as unknown as {
      project: { setupPieces: Array<{ cellColors?: string[] }> };
    };
    payload.project.setupPieces[1]!.cellColors = ['coral', 'unknown', 'blue'];
    expect(() => parseStudioBundle(payload)).toThrow(/cellColors/);
  });

  it('loads legacy v0.1 style payloads with the original 3D renderer', () => {
    const payload = structuredClone(bundle()) as unknown as {
      project: { style: Record<string, unknown> };
    };
    delete payload.project.style.renderer;
    delete payload.project.style.reference2d;
    delete payload.project.style.lookDev;
    const parsed = parseStudioBundle(payload);
    expect(parsed.project.style.renderer).toBe('three-3d');
    expect(parsed.project.style.reference2d.profile).toBe('block-garden-reference-v1');
    expect(parsed.project.style.lookDev.id).toBe('balanced-cinematic');
    expect(parsed.project.style.lookDev.bloomStrength).toBeLessThan(0.2);
  });

  it('rejects a take whose initial candidate tray no longer matches the project', () => {
    const payload = structuredClone(bundle());
    payload.takes[0]!.initial.pieces[0]!.color = 'violet';
    expect(() => parseStudioBundle(payload)).toThrow(/初始牌面、候选块/);
  });

  it('rejects malformed pointer coordinates before they reach the renderer', () => {
    const payload = structuredClone(bundle());
    payload.takes[0]!.actions[0]!.pointerPath[0]!.x = 2;
    expect(() => parseStudioBundle(payload)).toThrow(/pointerPath/);
  });

  it('rejects a pointer sample outside its action duration', () => {
    const payload = structuredClone(bundle());
    const action = payload.takes[0]!.actions[0]!;
    action.pointerPath[action.pointerPath.length - 1]!.frameOffset = action.durationFrames + 1;
    expect(() => parseStudioBundle(payload)).toThrow(/durationFrames/);
  });

  it('rejects odd H.264 output dimensions', () => {
    const payload = structuredClone(bundle());
    payload.project.render.width = 1079;
    expect(() => parseStudioBundle(payload)).toThrow(/偶数/);
  });

  it('rejects duplicate take ids', () => {
    const payload = structuredClone(bundle());
    payload.takes.push(structuredClone(payload.takes[0]!));
    expect(() => parseStudioBundle(payload)).toThrow(/take id/);
  });

  it('accepts a compiled material runtime and rejects a forged one on import', () => {
    const pack = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/headless/materials/material.stainless-steel.json'), 'utf8'));
    const runtime = compileMaterialRuntime({ pack });
    const accepted = structuredClone(bundle());
    accepted.project.style.materialRuntime = runtime;
    expect(parseStudioBundle(accepted).project.style.materialRuntime?.maps).toHaveLength(5);

    const forged = structuredClone(bundle());
    forged.project.style.materialRuntime = {
      ...runtime,
      maps: [{ ...runtime.maps[0]!, uri: 'javascript:alert(1)' }],
    };
    expect(() => parseStudioBundle(forged)).toThrow(/材质运行时无效/);
  });
});
