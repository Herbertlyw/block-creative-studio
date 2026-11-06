import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainContractDocument } from '../src/contracts/validateContract';
import { audioCuesForTake } from '../src/domain/audioCues';
import { compileTake } from '../src/director/presentationCompiler';
import { RHYTHM_PRESETS } from '../src/director/rhythmPresets';
import { createEmptyBoard } from '../src/domain/boardPresets';
import {
  createGame,
  createPieceSet,
  diagnoseReplay,
  placementRejectionReason,
} from '../src/domain/gameEngine';
import { identifyCreativeDocument } from '../src/domain/projectIdentity';
import { parseStudioBundle } from '../src/domain/projectValidation';
import { omitTakeAction, rebaseTakesForSetup, rotateBundleColors } from '../src/domain/variants';
import type { Take } from '../src/domain/types';

const demo = JSON.parse(
  readFileSync(new URL('./fixtures/legacy-cross-clear-parameters.json', import.meta.url), 'utf8'),
);

describe('BB contract boundary', () => {
  it('explicitly rejects the old demo in the workbench and does not identify structure as successful playback', () => {
    expect(identifyCreativeDocument(demo).loadable).toBe(false);
    expect(explainContractDocument(demo)).toMatch(/不支持旧格式/);
    const bundle = parseStudioBundle(demo);
    expect(bundle.takes[0]?.actions.length).toBeGreaterThan(0);

    const v2 = {
      format: 'bcs-studio-project',
      version: '2.0.0',
      id: 'sample',
      name: 'sample',
      game: {
        contract: 'bcs.game-project',
        contractVersion: '2.0.0',
        game: {
          id: 'block-placement',
          moduleVersion: '1.0.0',
          rulesetId: 'block-placement-classic-v1',
          rulesetVersion: '1.0.0',
        },
        config: {},
        initialState: {},
      },
      production: {},
      takes: [],
    };
    const identity = identifyCreativeDocument(v2);
    expect(identity.kind).toBe('placement-v2');
    expect(identity.loadable).toBe(false);
    expect(() => parseStudioBundle(v2)).toThrow(/BB 工程/);
  });

  it('refuses workbench audio instead of dropping it', () => {
    const withWorkbenchAudio = structuredClone(demo);
    withWorkbenchAudio.project.audio = { bgm: { source: 'original' }, cues: [] };
    expect(() => parseStudioBundle(withWorkbenchAudio)).toThrow(/声音/);
  });

  it('keeps actions valid after a color rotation and reports an illegal placement', () => {
    const bundle = parseStudioBundle(demo);
    const rotated = rotateBundleColors(bundle);
    expect(rotated.takes[0]?.actions.map((action) => action.id)).toEqual(
      bundle.takes[0]?.actions.map((action) => action.id),
    );
    expect(rotated.project.setupBoard.cells).not.toEqual(bundle.project.setupBoard.cells);
    parseStudioBundle(rotated);

    const pieces = createPieceSet(3, 0, ['single', 'single', 'single']);
    const initial = createGame(createEmptyBoard(), 3, pieces);
    const piece = pieces[0]!;
    initial.board.cells[0]![0] = 'coral';
    expect(placementRejectionReason(initial, piece.id, { row: 0, col: 0 })).toMatch(/重叠/);
    const take: Take = {
      id: 'take',
      name: 'take',
      createdAt: '2026-09-01T00:00:00.000Z',
      initial,
      actions: [
        {
          id: 'first',
          actor: 'human',
          pieceId: piece.id,
          anchor: { row: 1, col: 1 },
          durationFrames: 8,
          pointerPath: [],
        },
        {
          id: 'second',
          actor: 'human',
          pieceId: pieces[1]!.id,
          anchor: { row: 1, col: 1 },
          durationFrames: 8,
          pointerPath: [],
        },
      ],
    };
    expect(diagnoseReplay(initial, take.actions).ok).toBe(false);
    const trimmed = omitTakeAction(take, 1);
    expect(trimmed.actions.map((action) => action.id)).toEqual(['first']);
  });

  it('places test-audio cues on the compiled frame clock', () => {
    const bundle = parseStudioBundle(demo);
    const compiled = compileTake(
      bundle.takes[0]!,
      bundle.project.rhythm,
      bundle.project.render.fps,
    );
    const cues = audioCuesForTake(compiled);
    expect(cues[0]).toMatchObject({
      kind: 'place',
      frame: compiled.actions[0]!.releaseFrame + 1,
      seconds: (compiled.actions[0]!.releaseFrame + 1) / compiled.fps,
    });
    const hasClear = compiled.actions.some((action) => action.transition.clear.cells.length > 0);
    expect(cues.some((cue) => cue.kind === 'line-cleared' || cue.kind === 'cross-cleared')).toBe(
      hasClear,
    );
    const kindsAtFirstClear = cues.filter(
      (cue) =>
        cue.actionId ===
        compiled.actions.find((action) => action.transition.clear.cells.length > 0)?.action.id,
    );
    expect(new Set(kindsAtFirstClear.map((cue) => `${cue.kind}:${cue.frame}`)).size).toBe(
      kindsAtFirstClear.length,
    );
  });
  it('retains valid actions after setup edits and rejects invalid edits without mutating the original', () => {
    const bundle = parseStudioBundle(demo);
    const original = structuredClone(bundle);
    const legal = structuredClone(bundle.project);
    legal.setupPieces[0]!.color = 'coral';
    legal.setupPieces[0]!.cellColors = ['coral'];
    const rebased = rebaseTakesForSetup(legal, bundle.takes);
    expect(rebased[0]!.actions).toEqual(bundle.takes[0]!.actions);
    parseStudioBundle({ ...bundle, project: legal, takes: rebased });
    const invalid = structuredClone(bundle.project);
    const action = bundle.takes[0]!.actions[0]!;
    invalid.setupBoard.cells[action.anchor.row]![action.anchor.col] = 'blue';
    expect(() => rebaseTakesForSetup(invalid, bundle.takes)).toThrow(/第 1 步/);
    expect(bundle).toEqual(original);
  });

  it('validates the entire authored supply and rotates each batch consistently', () => {
    const bundle = parseStudioBundle(demo);
    const supply = [
      structuredClone(bundle.project.setupPieces),
      createPieceSet(bundle.project.seed, 1),
    ];
    bundle.project.fixedPieceSupply = structuredClone(supply);
    bundle.takes[0]!.initial.fixedPieceSupply = structuredClone(supply);
    parseStudioBundle(bundle);
    const rotated = rotateBundleColors(bundle);
    expect(rotated.project.fixedPieceSupply![1]).not.toEqual(supply[1]);
    parseStudioBundle(rotated);
    const stale = structuredClone(bundle);
    stale.takes[0]!.initial.fixedPieceSupply![1]![0]!.color = 'coral';
    if (stale.takes[0]!.initial.fixedPieceSupply![1]![0]!.color === supply[1]![0]!.color)
      stale.takes[0]!.initial.fixedPieceSupply![1]![0]!.color = 'blue';
    expect(() => parseStudioBundle(stale)).toThrow(/initial/);
    const wrongRound = structuredClone(bundle);
    wrongRound.project.fixedPieceSupply![1]![0]!.setIndex = 0;
    expect(() => parseStudioBundle(wrongRound)).toThrow(/setIndex/);
  });

  it('rejects malformed optional test-audio fields without dropping them', () => {
    const broken = structuredClone(demo);
    broken.project.audio = { enabled: true, sfxGain: 0.3, bgmLoop: 'yes' };
    expect(() => parseStudioBundle(broken)).toThrow(/声音/);
  });
});

describe('public 2D background variant', () => {
  it('round trips the optional background without changing the reference contract or other settings', () => {
    const bundle = parseStudioBundle(demo);
    const before = structuredClone(bundle);
    bundle.project.style.reference2d.backgroundColor = '#335577';
    expect(explainContractDocument(bundle)).toMatch(/不支持旧格式/);
    const reopened = parseStudioBundle(JSON.parse(JSON.stringify(bundle)));
    expect(reopened.project.style.reference2d.backgroundColor).toBe('#335577');
    expect(reopened.takes).toEqual(before.takes);
    expect(reopened.project.rhythm).toEqual(before.project.rhythm);
  });
});

describe('V2 read-only boundary', () => {
  it('distinguishes valid structure from unsupported fields without claiming playback', () => {
    const valid = JSON.parse(
      readFileSync(new URL('./fixtures/synthetic-v2-structure.json', import.meta.url), 'utf8'),
    );
    const unknown = JSON.parse(
      readFileSync(new URL('./fixtures/synthetic-v2-unknown.json', import.meta.url), 'utf8'),
    );
    expect(identifyCreativeDocument(valid).kind).toBe('placement-v2');
    expect(explainContractDocument(valid)).toMatch(/Schema 校验通过/);
    expect(explainContractDocument(valid)).toMatch(/不代表.*播放/);
    expect(explainContractDocument(unknown)).toMatch(/Schema 未通过/);
    expect(explainContractDocument(unknown)).toMatch(/原件可保存/);
    expect(unknown.unknownExtension.values).toEqual([1, 2, 3]);
  });
});

describe('semantic frame identity', () => {
  it('keeps reference-style event IDs stable and deduplicates multi-frame effects', async () => {
    const { semanticEventsForFrame, collectSemanticEvents } = await import(
      '../src/director/semanticEvents'
    );
    const { evaluateCompiledTake } = await import('../src/director/presentationCompiler');
    const bundle = parseStudioBundle(demo);
    const compiled = compileTake(
      bundle.takes[0]!,
      bundle.project.rhythm,
      bundle.project.render.fps,
    );
    const action = compiled.actions[0]!;
    const first = evaluateCompiledTake(compiled, action.clearStartFrame, bundle.project.rhythm);
    const later = evaluateCompiledTake(compiled, action.clearStartFrame + 1, bundle.project.rhythm);
    expect(first.currentActionId).toBe(action.action.id);
    expect(semanticEventsForFrame(first).map((e) => e.id)).toEqual(
      semanticEventsForFrame(later).map((e) => e.id),
    );
    const events = collectSemanticEvents(compiled, bundle.project.rhythm);
    expect(events.filter((e) => e.type === 'block-placement.cross-cleared')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'block-placement.placement-committed')).toHaveLength(1);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });
});

it('round trips a short authored agent path without changing the original V1 contract view', () => {
  const bundle = parseStudioBundle(
    JSON.parse(
      readFileSync(
        new URL('./fixtures/reference-supply-demo.block-creative.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  bundle.takes[0]!.actions[0]!.pointerPathMode = 'authored';
  bundle.takes[0]!.actions[0]!.pointerPath = [
    { frameOffset: 0, x: 0.2, y: 0.8 },
    { frameOffset: 15, x: 0.5, y: 0.6 },
  ];
  expect(explainContractDocument(bundle)).toMatch(/不支持旧格式/);
  expect(
    parseStudioBundle(JSON.parse(JSON.stringify(bundle))).takes[0]!.actions[0]!.pointerPathMode,
  ).toBe('authored');
});
