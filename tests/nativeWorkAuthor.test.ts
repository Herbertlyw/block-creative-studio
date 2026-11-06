import { syntheticWav, syntheticPng } from '../scripts/fixtures/syntheticMedia.mjs';
import { ordinaryProject } from './fixtures/ordinaryProject';
import { syntheticAuthoredFixture } from './fixtures/syntheticAuthored';
import { expect, it } from 'vitest';
import {
  appendNativeMove,
  createNativeTake,
  createNativeWork,
  deleteNativeTake,
  generateNativeMachineTake,
  nativeTakeState,
} from '../src/contracts/nativeWorkAuthor';
import { openBBWorkPackage } from '../src/contracts/bbWorkPackage';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
it('creates native work and records, replays, saves and deletes independent human and machine takes', async () => {
  const blank = await createNativeWork(41782),
    initial = JSON.stringify(blank);
  let work = await createNativeTake(blank, 'human');
  let state = nativeTakeState(work, 'human');
  const piece = state.pieces[0]!;
  work = await appendNativeMove(work, 'human', piece.id, 0, 0, 'human', [
    { frameOffset: 0, x: 0.27, y: 0.88 },
    { frameOffset: 15, x: 0.16, y: 0.18 },
  ]);
  state = nativeTakeState(work, 'human');
  expect(state.turn).toBe(1);
  await expect(
    appendNativeMove(work, 'human', piece.id, 0, 0, 'human', [
      { frameOffset: 0, x: 0.27, y: 0.88 },
      { frameOffset: 15, x: 0.16, y: 0.18 },
    ]),
  ).rejects.toThrow(/不能放/);
  work = await generateNativeMachineTake(work, 'machine', 3);
  expect(nativeTakeState(work, 'machine').turn).toBe(3);
  const reopened = await openBBWorkPackage(JSON.parse(JSON.stringify(work)));
  expect((reopened.project as any).takes).toHaveLength(2);
  expect(compileNativeTake(reopened.project, 'human').frameSource.totalFrames).toBeGreaterThan(0);
  expect(compileNativeTake(reopened.project, 'machine').frameSource.totalFrames).toBeGreaterThan(0);
  expect(JSON.stringify(blank)).toBe(initial);
  const removed = await deleteNativeTake(reopened, 'human');
  expect((removed.project as any).takes.map((t: any) => t.takeId)).toEqual(['machine']);
});
it('undoes only the selected take’s last move and leaves other takes intact', async () => {
  const { undoNativeMove } = await import('../src/contracts/nativeWorkAuthor');
  let work = await generateNativeMachineTake(await createNativeWork(), 'first', 2);
  work = await generateNativeMachineTake(work, 'second', 2);
  const before = structuredClone(work),
    updated = await undoNativeMove(work, 'first');
  expect(work).toEqual(before);
  expect(nativeTakeState(updated, 'first').turn).toBe(1);
  expect(nativeTakeState(updated, 'second').turn).toBe(2);
  expect((updated.project as any).takes[1]).toEqual((work.project as any).takes[1]);
  expect((await openBBWorkPackage(JSON.parse(JSON.stringify(updated)))).project).toEqual(
    updated.project,
  );
});
it('binds valid WAV to all native takes and rejects corrupt audio without changing the work', async () => {
  const { attachObservedAudio } = await import('../src/contracts/attachObservedAudio');
  const file = (id: string) =>
    new File(
      [new Uint8Array(syntheticWav(id === 'music' ? 220 : id === 'placement' ? 740 : 1120)).buffer],
      `${id}.wav`,
      { type: 'audio/wav' },
    );
  let work = await createNativeWork();
  work = await generateNativeMachineTake(work, 'machine-a', 3);
  work = await generateNativeMachineTake(work, 'machine-b', 2);
  const before = JSON.stringify(work),
    options = {
      bgm: file('music'),
      placement: file('placement'),
      clear: file('clear'),
      bgmStart: 0,
      bgmOffset: 0,
      bgmGain: 0.2,
      bgmLoop: true,
      cueGain: 0.5,
    };
  const result = await attachObservedAudio(work.project, options);
  expect(result.scheduledCues.length).toBeGreaterThanOrEqual(5);
  expect(JSON.stringify(work)).toBe(before);
  const bad = { ...options, placement: new File(['broken'], 'bad.wav') };
  await expect(attachObservedAudio(work.project, bad)).rejects.toThrow();
  expect(JSON.stringify(work)).toBe(before);
});
it('binds the selected clear WAV to ordinary line and cross events', async () => {
  const { attachObservedAudio } = await import('../src/contracts/attachObservedAudio');
  const source = JSON.parse(JSON.stringify(ordinaryProject()));
  delete source.direction.production;
  const clear = new File([new Uint8Array(syntheticWav(1120)).buffer], 'clear.wav', {
    type: 'audio/wav',
  });
  const result = await attachObservedAudio(source, {
    clear,
    bgmStart: 0,
    bgmOffset: 0,
    bgmGain: 0.2,
    bgmLoop: false,
    cueGain: 0.5,
  });
  expect(result.document.direction.production.audio.cues.map((cue: any) => cue.eventType)).toEqual([
    'block-placement.line-cleared',
    'block-placement.cross-cleared',
  ]);
  expect(
    result.scheduledCues.some((cue: any) => cue.eventType === 'block-placement.cross-cleared'),
  ).toBe(true);
});
it('binds and changes a single ordinary image role without changing gameplay or other images', async () => {
  const { setNativeWorkImage } = await import('../src/contracts/setNativeWorkImage');
  const { inspectImageBytes } = await import('../src/nativeReference/agent-assets/image');
  const file = (id: string) =>
    new File(
      [
        new Uint8Array(
          syntheticPng(
            id === 'synthetic-background'
              ? [30, 60, 90]
              : id === 'generated-tile'
                ? [180, 120, 40]
                : [90, 140, 190],
          ),
        ).buffer,
      ],
      `${id}.png`,
      { type: 'image/png' },
    );
  const decode = async (blob: Blob) => inspectImageBytes(new Uint8Array(await blob.arrayBuffer()));
  let work = await generateNativeMachineTake(await createNativeWork(), 'machine', 3);
  work = await setNativeWorkImage(work, 'background.base', file('synthetic-background'), decode);
  work = await setNativeWorkImage(work, 'tile.face', file('generated-tile'), decode);
  const original = JSON.stringify(work),
    changed = await setNativeWorkImage(work, 'tile.face', file('generated-atlas'), decode);
  expect(JSON.stringify(work)).toBe(original);
  expect((changed.project as any).takes).toEqual((work.project as any).takes);
  expect((changed.project as any).direction.style.agentAssets.bindings['background.base']).toEqual(
    (work.project as any).direction.style.agentAssets.bindings['background.base'],
  );
  await expect(
    setNativeWorkImage(work, 'tile.face', new File(['bad'], 'bad.png'), decode),
  ).rejects.toThrow(/损坏/);
});
it('edits a blank board and configures fixed rounds before creating a take, but preserves existing takes', async () => {
  const { editNativeBoardCell } = await import('../src/contracts/editNativeDocument');
  const { setNativeFixedSupply } = await import('../src/contracts/nativeWorkAuthor');
  const initial = await createNativeWork();
  const edited = JSON.parse(editNativeBoardCell(JSON.stringify(initial.project), 0, 0, 'coral'));
  const work = await createBBWorkPackageForTest(edited);
  const fixed = await setNativeFixedSupply(work, [
    [
      { shapeId: 'single', color: 'blue' },
      { shapeId: 'tri-h', color: 'cyan' },
      { shapeId: 'square-2', color: 'rose' },
    ],
  ]);
  expect((fixed.project as any).game.initialState.data.board.cells[0][0]).toBe('coral');
  expect((fixed.project as any).game.initialState.data.fixedPieceSupply).toHaveLength(1);
  const withTake = await createNativeTake(fixed, 'keep');
  await expect(setNativeFixedSupply(withTake, [])).rejects.toThrow();
  expect((withTake.project as any).takes).toHaveLength(1);
});
it('replays all takes after replacing fixed rounds and preserves the original on invalidation', async () => {
  const { setNativeFixedSupply } = await import('../src/contracts/nativeWorkAuthor');
  const rounds = [
    [
      { shapeId: 'single', color: 'blue' },
      { shapeId: 'tri-h', color: 'cyan' },
      { shapeId: 'square-2', color: 'rose' },
    ],
  ];
  let work = await setNativeFixedSupply(await createNativeWork(), rounds);
  work = await createNativeTake(work, 'human');
  const piece = nativeTakeState(work, 'human').pieces[0]!;
  work = await appendNativeMove(work, 'human', piece.id, 0, 0, 'human', [
    { frameOffset: 0, x: 0.3, y: 0.8 },
    { frameOffset: 15, x: 0.2, y: 0.2 },
  ]);
  work = await generateNativeMachineTake(work, 'machine', 2);
  const original = JSON.stringify(work),
    oldTakes = (work.project as any).takes;
  const updated = await setNativeFixedSupply(work, [
    [rounds[0]![0]!, rounds[0]![1]!, { shapeId: 'square-2', color: 'amber' }],
  ]);
  expect(JSON.stringify(work)).toBe(original);
  expect((updated.project as any).takes.map((t: any) => t.actions)).toEqual(
    oldTakes.map((t: any) => t.actions),
  );
  expect(nativeTakeState(updated, 'human').turn).toBe(1);
  expect(nativeTakeState(updated, 'machine').turn).toBe(2);
  expect((await openBBWorkPackage(JSON.parse(JSON.stringify(updated)))).project).toEqual(
    updated.project,
  );
  await expect(
    setNativeFixedSupply(work, [
      [{ shapeId: 'tri-h', color: 'blue' }, rounds[0]![1]!, rounds[0]![2]!],
    ]),
  ).rejects.toThrow(/Take human 第 1 步/);
  expect(JSON.stringify(work)).toBe(original);
});
async function createBBWorkPackageForTest(project: unknown) {
  const { createBBWorkPackage } = await import('../src/contracts/bbWorkPackage');
  return createBBWorkPackage(project, null, null);
}
it('edits fixed supply with monochrome candidates after recording when replay stays legal', async () => {
  const { setNativeFixedSupply } = await import('../src/contracts/nativeWorkAuthor');
  const { editNativeSupplyPiece } = await import('../src/contracts/editNativeDocument');
  let work = await setNativeFixedSupply(await createNativeWork(), [
    [
      { shapeId: 'single', color: 'blue' },
      { shapeId: 'tri-h', color: 'cyan' },
      { shapeId: 'square-2', color: 'rose' },
    ],
  ]);
  work = await createNativeTake(work, 'human');
  const edited = JSON.parse(
    editNativeSupplyPiece(JSON.stringify(work.project), 0, 1, 'tri-h', 'amber'),
  );
  expect(edited.game.initialState.data.fixedPieceSupply[0][1].cellColors).toEqual([
    'amber',
    'amber',
    'amber',
  ]);
  expect((await createBBWorkPackageForTest(edited)).project).toEqual(edited);
});
it('preserves explicitly authored per-cell colors in fixed rounds', async () => {
  const { setNativeFixedSupply } = await import('../src/contracts/nativeWorkAuthor');
  const fixed = await setNativeFixedSupply(await createNativeWork(), [
    [
      { shapeId: 'single', color: 'blue', cellColors: ['blue'] },
      { shapeId: 'tri-h', color: 'cyan', cellColors: ['cyan', 'rose', 'amber'] },
      { shapeId: 'square-2', color: 'rose' },
    ],
  ]);
  expect((fixed.project as any).game.initialState.data.fixedPieceSupply[0][1].cellColors).toEqual([
    'cyan',
    'rose',
    'amber',
  ]);
});
it('restores the seeded first rack and rejects changes that invalidate existing takes', async () => {
  const { setNativeFixedSupply, setNativeSeededSupply } = await import(
    '../src/contracts/nativeWorkAuthor'
  );
  const { createPieceSet } = await import(
    '../src/nativeReference/games/block-placement/runtime/gameEngine'
  );
  const fixed = await setNativeFixedSupply(await createNativeWork(41782), [
    [
      { shapeId: 'single', color: 'blue' },
      { shapeId: 'single', color: 'cyan' },
      { shapeId: 'single', color: 'rose' },
    ],
  ]);
  const before = JSON.stringify(fixed),
    seeded = await setNativeSeededSupply(fixed);
  expect(JSON.stringify(fixed)).toBe(before);
  expect((seeded.project as any).game.initialState.data.fixedPieceSupply).toBeUndefined();
  expect((seeded.project as any).game.initialState.data.pieces).toEqual(createPieceSet(41782, 0));
  expect((await openBBWorkPackage(JSON.parse(JSON.stringify(seeded)))).project).toEqual(
    seeded.project,
  );
  let recorded = await createNativeTake(fixed, 'recorded');
  const piece = nativeTakeState(recorded, 'recorded').pieces[0]!;
  recorded = await appendNativeMove(recorded, 'recorded', piece.id, 0, 0, 'human', [
    { frameOffset: 0, x: 0.2, y: 0.8 },
    { frameOffset: 15, x: 0.2, y: 0.2 },
  ]);
  const unchanged = JSON.stringify(recorded);
  await expect(setNativeSeededSupply(recorded)).rejects.toThrow(/Take recorded 第 1 步/);
  expect(JSON.stringify(recorded)).toBe(unchanged);
});
it('changes seeds with deterministic native supply and preserves or rejects affected takes', async () => {
  const { setNativeFixedSupply, setNativeSeed } = await import('../src/contracts/nativeWorkAuthor');
  const { createPieceSet } = await import(
    '../src/nativeReference/games/block-placement/runtime/gameEngine'
  );
  const source = await createNativeWork(41782),
    before = JSON.stringify(source),
    seeded = await setNativeSeed(source, 99);
  expect(JSON.stringify(source)).toBe(before);
  expect((seeded.project as any).game.initialState.data.pieces).toEqual(createPieceSet(99, 0));
  expect((await openBBWorkPackage(JSON.parse(JSON.stringify(seeded)))).project).toEqual(
    seeded.project,
  );
  let fixed = await setNativeFixedSupply(source, [
    [
      { shapeId: 'single', color: 'blue' },
      { shapeId: 'single', color: 'cyan' },
      { shapeId: 'single', color: 'rose' },
    ],
  ]);
  fixed = await createNativeTake(fixed, 'fixed');
  const piece = nativeTakeState(fixed, 'fixed').pieces[0]!;
  fixed = await appendNativeMove(fixed, 'fixed', piece.id, 0, 0, 'human', [
    { frameOffset: 0, x: 0.2, y: 0.8 },
    { frameOffset: 15, x: 0.2, y: 0.2 },
  ]);
  const changed = await setNativeSeed(fixed, 99);
  expect(nativeTakeState(changed, 'fixed').turn).toBe(1);
  expect((changed.project as any).game.initialState.data.fixedPieceSupply).toEqual(
    (fixed.project as any).game.initialState.data.fixedPieceSupply,
  );
  expect((changed.project as any).takes[0].actions).toEqual(
    (fixed.project as any).takes[0].actions,
  );
  const recorded = await generateNativeMachineTake(source, 'machine', 1),
    saved = JSON.stringify(recorded);
  await expect(setNativeSeed(recorded, 99)).rejects.toThrow(/Take machine 第 1 步/);
  expect(JSON.stringify(recorded)).toBe(saved);
  await expect(setNativeSeed(source, -1)).rejects.toThrow(/种子/);
});
it('replaces only the selected audio role and preserves both takes and the mix', async () => {
  const { attachObservedAudio } = await import('../src/contracts/attachObservedAudio');
  const { setNativeWorkAudio } = await import('../src/contracts/setNativeWorkAudio');
  const { updateBBWorkPackageProject } = await import('../src/contracts/bbWorkPackage');
  const file = (id: string) =>
    new File(
      [new Uint8Array(syntheticWav(id === 'music' ? 220 : id === 'placement' ? 740 : 1120)).buffer],
      `${id}.wav`,
      { type: 'audio/wav' },
    );
  let work = await generateNativeMachineTake(await createNativeWork(), 'first', 3);
  work = await generateNativeMachineTake(work, 'second', 2);
  const attached = await attachObservedAudio(work.project, {
    bgm: file('music'),
    placement: file('placement'),
    clear: file('clear'),
    bgmStart: 0.1,
    bgmOffset: 0.02,
    bgmGain: 0.3,
    bgmLoop: true,
    cueGain: 0.4,
  });
  work = await updateBBWorkPackageProject(work, attached.document);
  const before = JSON.stringify(work),
    oldAudio = (work.project as any).direction.production.audio;
  const variant = await setNativeWorkAudio(work, 'bgm', file('placement'));
  expect(JSON.stringify(work)).toBe(before);
  const next = (variant.project as any).direction.production.audio;
  expect(next.bgm.assetId).not.toBe(oldAudio.bgm.assetId);
  expect({ ...next.bgm, assetId: oldAudio.bgm.assetId }).toEqual(oldAudio.bgm);
  expect(next.cues).toEqual(oldAudio.cues);
  expect((variant.project as any).takes).toEqual((work.project as any).takes);
  expect((await openBBWorkPackage(JSON.parse(JSON.stringify(variant)))).project).toEqual(
    variant.project,
  );
  await expect(setNativeWorkAudio(work, 'clear', new File(['broken'], 'bad.wav'))).rejects.toThrow(
    /AUDIO_WAV_INVALID/,
  );
  expect(JSON.stringify(work)).toBe(before);
});
it('rejects corrupted audio on reopening an ordinary BB work before preview', async () => {
  const { attachObservedAudio } = await import('../src/contracts/attachObservedAudio');
  const audio = syntheticWav(740);
  let work = await generateNativeMachineTake(await createNativeWork(), 'take', 1);
  const result = await attachObservedAudio(work.project, {
    placement: new File([new Uint8Array(audio).buffer], 'placement.wav'),
    bgmStart: 0,
    bgmOffset: 0,
    bgmGain: 0.2,
    bgmLoop: false,
    cueGain: 0.5,
  });
  const { updateBBWorkPackageProject } = await import('../src/contracts/bbWorkPackage');
  work = await updateBBWorkPackageProject(work, result.document);
  const damaged = structuredClone(work) as any;
  damaged.project.direction.production.audio.assets.placement.sha256 = '0'.repeat(64);
  await expect(openBBWorkPackage(damaged)).rejects.toThrow(/哈希|HASH_MISMATCH/);
  const corrupt = structuredClone(work) as any,
    asset = corrupt.project.direction.production.audio.assets.placement;
  const bytes = new TextEncoder().encode('broken');
  asset.data = btoa('broken');
  asset.sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
  await expect(openBBWorkPackage(corrupt)).rejects.toThrow(/AUDIO_WAV_INVALID/);
});
it('updates the work board only when every recorded take remains legal', async () => {
  const { setNativeFixedSupply, setNativeWorkBoardCell } = await import(
    '../src/contracts/nativeWorkAuthor'
  );
  let work = await setNativeFixedSupply(await createNativeWork(), [
    [
      { shapeId: 'single', color: 'blue' },
      { shapeId: 'single', color: 'cyan' },
      { shapeId: 'single', color: 'rose' },
    ],
  ]);
  work = await createNativeTake(work, 'human');
  const piece = nativeTakeState(work, 'human').pieces[0]!;
  work = await appendNativeMove(work, 'human', piece.id, 0, 0, 'human', [
    { frameOffset: 0, x: 0.2, y: 0.8 },
    { frameOffset: 15, x: 0.2, y: 0.2 },
  ]);
  const before = JSON.stringify(work),
    updated = await setNativeWorkBoardCell(work, 7, 7, 'coral');
  expect(JSON.stringify(work)).toBe(before);
  expect((updated.project as any).game.initialState.data.board.cells[7][7]).toBe('coral');
  expect(nativeTakeState(updated, 'human').turn).toBe(1);
  expect((await openBBWorkPackage(JSON.parse(JSON.stringify(updated)))).project).toEqual(
    updated.project,
  );
  await expect(setNativeWorkBoardCell(work, 0, 0, 'coral')).rejects.toThrow(/human/);
  expect(JSON.stringify(work)).toBe(before);
});
it('applies board presets atomically and retains or rejects takes after replay', async () => {
  const { setNativeBoardPreset, setNativeFixedSupply } = await import(
    '../src/contracts/nativeWorkAuthor'
  );
  const { createCrossClearBoard } = await import(
    '../src/nativeReference/games/block-placement/runtime/boardPresets'
  );
  const original = await createNativeWork(),
    snapshot = JSON.stringify(original),
    cross = await setNativeBoardPreset(original, 'cross-clear');
  expect((cross.project as any).game.initialState.data.board).toEqual(createCrossClearBoard());
  expect(JSON.stringify(original)).toBe(snapshot);
  expect((await openBBWorkPackage(JSON.parse(JSON.stringify(cross)))).project).toEqual(
    cross.project,
  );
  let work = await setNativeFixedSupply(original, [
    [
      { shapeId: 'single', color: 'blue' },
      { shapeId: 'single', color: 'cyan' },
      { shapeId: 'single', color: 'rose' },
    ],
  ]);
  work = await createNativeTake(work, 'human');
  const piece = nativeTakeState(work, 'human').pieces[0]!;
  work = await appendNativeMove(work, 'human', piece.id, 2, 0, 'human', [
    { frameOffset: 0, x: 0.2, y: 0.8 },
    { frameOffset: 15, x: 0.2, y: 0.2 },
  ]);
  const before = JSON.stringify(work);
  await expect(setNativeBoardPreset(work, 'showcase')).rejects.toThrow(/Take human 第 1 步/);
  expect(JSON.stringify(work)).toBe(before);
  await expect(setNativeBoardPreset(work, 'invalid')).rejects.toThrow(/未知棋盘/);
});
it('rotates board and per-cell fixed colors while preserving the original and replay', async () => {
  const { setNativeFixedSupply, setNativeWorkBoardCell, rotateNativeSetupColors } = await import(
    '../src/contracts/nativeWorkAuthor'
  );
  let work = await setNativeFixedSupply(await createNativeWork(), [
    [
      { shapeId: 'single', color: 'coral' },
      { shapeId: 'tri-h', color: 'amber', cellColors: ['amber', 'cyan', 'rose'] },
      { shapeId: 'single', color: 'blue' },
    ],
  ]);
  work = await setNativeWorkBoardCell(work, 7, 7, 'coral');
  work = await createNativeTake(work, 'human');
  const piece = nativeTakeState(work, 'human').pieces[0]!;
  work = await appendNativeMove(work, 'human', piece.id, 0, 0, 'human', [
    { frameOffset: 0, x: 0.2, y: 0.8 },
    { frameOffset: 15, x: 0.2, y: 0.2 },
  ]);
  const before = JSON.stringify(work),
    next = await rotateNativeSetupColors(work),
    data = (next.project as any).game.initialState.data;
  expect(data.board.cells[7][7]).toBe('amber');
  expect(data.fixedPieceSupply[0][1].cellColors).toEqual(['lime', 'blue', 'coral']);
  expect(data.seed).toBe((work.project as any).game.initialState.data.seed);
  expect(nativeTakeState(next, 'human').turn).toBe(1);
  expect((next.project as any).takes[0].actions).toEqual((work.project as any).takes[0].actions);
  expect(JSON.stringify(work)).toBe(before);
  expect((await openBBWorkPackage(JSON.parse(JSON.stringify(next)))).project).toEqual(next.project);
});
it('reopens the browser-recorded board and human/machine work fixture', async () => {
  const work = await openBBWorkPackage(
    JSON.parse(JSON.stringify(await syntheticAuthoredFixture())),
  );
  expect((work.project as any).game.initialState.data.board.cells[7][7]).toBe('coral');
  expect(nativeTakeState(work, 'human-drag').turn).toBe(1);
  expect(nativeTakeState(work, 'machine').turn).toBe(3);
});
