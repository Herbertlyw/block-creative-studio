import { syntheticLookProject } from './fixtures/syntheticLookProject';
import { saveWorkbenchVariant } from '../src/contracts/workbenchVariant';
import { expect, it, vi } from 'vitest';
import {
  parseWorkbenchView,
  cameraAt,
  designToOutput,
  outputToDesign,
  hitWorkbenchView,
  saveWorkbenchView,
  paintWorkbenchView,
} from '../src/contracts/reference2dView';
import { retimeNativeFpsAbsolute, deleteNativeAction } from '../src/contracts/editNativeDocument';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import { readBBFrame } from '../src/games/block-placement/planning/timelineFrameSource';
import { resolveSavedWorkbenchVariant } from '../src/contracts/workbenchVariant';
const saved = await saveWorkbenchVariant(
  JSON.stringify(syntheticLookProject()),
  'builtin.reference-clean.look@1.0.0',
  'builtin.reference-garden.look@1.0.0',
);
const src = () => saved;
const raw = () => ({
  contract: 'bcs.workbench.reference2d-view',
  version: '1.0.0',
  design: { width: 1064, height: 1788 },
  fps: 30,
  layout: { scale: 0.9, x: 30, y: 60 },
  camera: {
    mode: 'keyframed',
    keyframes: [
      { frame: 0, scale: 1, x: 0, y: 0 },
      { frame: 100, scale: 1.15, x: -30, y: 40 },
    ],
  },
});
it('fits a supersampled source into the same output geometry before applying the view', () => {
  const drawImage = vi.fn(),
    context = {
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      drawImage,
    };
  const source = { width: 691, height: 1166 } as HTMLCanvasElement;
  const target = {
    width: 512,
    height: 864,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  paintWorkbenchView(source, target, parseWorkbenchView(raw(), 30)!, 0);
  expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 512, 864);
});
it('round trips board edges and candidate hit tests through layout and camera at multiple resolutions', () => {
  const view = parseWorkbenchView(raw(), 30)!;
  expect(cameraAt(view, 50)).toMatchObject({ scale: 1.075, x: -15, y: 20 });
  const doc = JSON.parse(src()),
    compiled = compileNativeTake(doc, 'synthetic-take'),
    frame = readBBFrame(compiled.frameSource.evaluate(0));
  for (const [w, h] of [
    [512, 864],
    [320, 560],
    [1080, 1920],
  ])
    for (const t of [0, 50, 100])
      for (const [row, col] of [
        [0, 0],
        [7, 7],
      ]) {
        const p = { x: 91 + col * 112 + 55, y: 321 + row * 112 + 55 },
          out = designToOutput(view, t, w, h, p),
          back = outputToDesign(view, t, w, h, out)!;
        expect(back.x).toBeCloseTo(p.x, 8);
        expect(back.y).toBeCloseTo(p.y, 8);
        expect(
          hitWorkbenchView(view, t, w, h, out, readBBFrame(compiled.frameSource.evaluate(t))),
        ).toEqual({ kind: 'cell', row, col });
      }
  const rack = designToOutput(view, 0, 512, 864, { x: 238, y: 1470 });
  expect(hitWorkbenchView(view, 0, 512, 864, rack, frame)).toEqual({
    kind: 'piece',
    pieceId: 'piece-0-0-single',
  });
  expect(() => hitWorkbenchView(view, 50, 512, 864, rack, frame)).toThrow(/BB_VIEW_FRAME_MISMATCH/);
  expect(outputToDesign(view, 0, 512, 864, { x: -1, y: 10 })).toBeNull();
});
it('preserves unrelated tokens, applies strict clock/version checks and retains saved effect binding', async () => {
  const text = src(),
    before = JSON.parse(text),
    edited = await saveWorkbenchView(text, raw()),
    after = JSON.parse(edited);
  expect(resolveSavedWorkbenchVariant(after, 'synthetic-take')?.referenceEffect.preset).toBe(
    'sweep-score-spark',
  );
  expect(() => retimeNativeFpsAbsolute(edited, 60)).toThrow(/镜头包含帧时钟/);
  delete after.direction.style.workbenchView2D;
  expect(after).toEqual(before);
  const invalid = { ...raw(), rotation: 1 };
  await expect(saveWorkbenchView(text, invalid)).rejects.toThrow(/合同无效/);
  const oldUnknown = JSON.parse(edited);
  oldUnknown.direction.style.workbenchView2D.rotation = 1;
  await expect(saveWorkbenchView(JSON.stringify(oldUnknown), raw())).rejects.toThrow(/合同无效/);
  const wrong = raw();
  wrong.fps = 60;
  await expect(saveWorkbenchView(text, wrong)).rejects.toThrow(/帧率/);
  const frames = raw();
  frames.camera.keyframes[1]!.frame = 0;
  await expect(saveWorkbenchView(text, frames)).rejects.toThrow(/关键帧/);
  expect(JSON.parse(text)).toEqual(before);
  const beyond = raw();
  beyond.camera.keyframes[1]!.frame = 999;
  await expect(saveWorkbenchView(text, beyond)).rejects.toThrow(/超出 Take 时长/);
  const stale = JSON.parse(text);
  stale.direction.style.workbenchVariantV1.clearRef.contentHash = 'fnv1a32:00000000';
  await expect(saveWorkbenchView(JSON.stringify(stale), raw())).rejects.toThrow(/哈希不匹配/);
  const damaged = JSON.parse(text);
  damaged.direction.style.agentAssets.entries['synthetic-background'].sha256 = '0'.repeat(64);
  await expect(saveWorkbenchView(JSON.stringify(damaged), raw())).rejects.toThrow(/哈希/);
  const late = raw();
  late.camera.keyframes[1]!.frame = 149;
  const editedLate = await saveWorkbenchView(text, late);
  expect(() => deleteNativeAction(editedLate, 0, 1)).toThrow(/关键帧超出 Take 时长/);
});
