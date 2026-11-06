import { syntheticObservedFixture } from './fixtures/syntheticObserved';
import { expect, it } from 'vitest';
import {
  evaluateBBClears,
  evaluateBBAtmosphere,
  type BBClearTrack,
} from '../src/games/block-placement/planning/feedbackTimeline';
import { evaluateBBScorePopups } from '../src/games/block-placement/planning/scorePopupTimeline';
import { evaluateBBCamera } from '../src/games/block-placement/planning/cameraTimeline';
import { inlineBrowserStudioReferences } from '../src/contracts/browserAssetReferences';
import { prepareCalibratedRenderer } from '../src/contracts/calibratedRenderer';
import { readCalibratedFrame } from '../src/contracts/calibratedFrame';

const track = (id: string, time: number, eligible: boolean): BBClearTrack => ({
  actionId: id,
  commitSeconds: time - 0.2,
  clearSeconds: time,
  timeScale: 2,
  rows: [0],
  cols: [],
  cells: [{ row: 0, col: 0, color: 'visible', logicalColor: 'blue' }],
  combo: 2,
  seed: 101,
  progressFrames: null,
  praiseLabel: 'Great!',
  feedback: { like: 'blue-badge', rim: true, celebrate: false },
  atmosphereEligible: eligible,
});

const syntheticObserved = await syntheticObservedFixture();

it('retains separate colors, independently timed feedback and most recent atmosphere eligibility', () => {
  const tracks = [track('first', 1, true), track('second', 2, false)];
  const first = evaluateBBClears(tracks, 0, 1.25, 37, 3)[0]!;
  expect(first).toMatchObject({
    actionId: 'first',
    age: 0.25,
    clearAge: 0.5,
    cells: [{ color: 'visible', logicalColor: 'blue' }],
    feedback: { like: 'blue-badge', rim: true },
  });
  expect(evaluateBBClears(tracks, 1, 2.2, 66, 3)).toHaveLength(2);
  expect(evaluateBBAtmosphere(tracks, 0, 1.25, true, null)).toBe(0.25);
  expect(evaluateBBAtmosphere(tracks, 1, 2.2, true, null)).toBeNull();
  expect(evaluateBBAtmosphere(tracks, 0, 1.25, true, 1.2)).toBeNull();
  expect(evaluateBBClears(tracks, 0, 2.16, 65, 3)[0]!.feedback).toBeNull();
});

it('samples a scored popup by event time, action identity and declared lifetime', () => {
  const tracks = [
    {
      actionIndex: 0,
      clearSeconds: 1,
      delaySeconds: 0.1,
      durationSeconds: 0.5,
      text: '+42',
      x: 100,
      y: 200,
      risePx: 100,
      minY: 80,
      fontSize: 50,
      style: 'gold' as const,
    },
  ];
  expect(evaluateBBScorePopups(tracks, -1, 1.35)).toEqual([]);
  expect(evaluateBBScorePopups(tracks, 0, 1)).toEqual([]);
  const popup = evaluateBBScorePopups(tracks, 0, 1.35)[0]!;
  expect(popup).toMatchObject({ text: '+42', x: 100, fontSize: 50, style: 'gold' });
  expect(popup.y).toBeCloseTo(150);
  expect(popup.alpha).toBeCloseTo(1);
  expect(popup.scale).toBeCloseTo(1);
  expect(evaluateBBScorePopups(tracks, 0, 1.7)).toEqual([]);
});

it('samples camera translation and impact without combining incompatible modes', () => {
  const translation = {
    translation: [
      [0, 0, 0],
      [1, 10, -4],
      [2, 0, 0],
    ] as const,
    impactStyle: null,
    impulses: [],
  };
  expect(evaluateBBCamera(translation, 0.5)).toEqual({ x: 5, y: -2, scale: 1 });
  const impact = {
    ...translation,
    impactStyle: 'vertical-kick',
    impulses: [{ clearSeconds: 0.5, lineCount: 2, allClear: false }],
  };
  expect(evaluateBBCamera(impact, 0.5)).toEqual({ x: 0, y: 0, scale: 1 });
  expect(evaluateBBCamera(impact, 0.53).y).toBeLessThan(0);
  expect(evaluateBBCamera(impact, 1)).toEqual({ x: 0, y: 0, scale: 1 });
});

it('renders an explicitly authored score popup at its measured action time', async () => {
  const work = {
    project: structuredClone(syntheticObserved.document),
    pointer: structuredClone(syntheticObserved.pointer),
  };
  const calibration = work.project.direction.style.referenceCalibration;
  calibration.scoreFeedback = {
    enabled: true,
    source: 'authored',
    durationSeconds: 0.8,
    risePx: 100,
    fontSize: 50,
    delaySeconds: 0.1,
  };
  calibration.actions[0].scorePopup = {
    value: 50,
    position: [250, 500],
    delaySeconds: 0.1,
    durationSeconds: 0.8,
    prefix: true,
    style: 'gold',
  };
  const doc = (await inlineBrowserStudioReferences(work.project, {})).document;
  const source = prepareCalibratedRenderer(doc, 'observed-take').frameSource;
  expect(readCalibratedFrame(source.evaluate(27)).scorePopups).toEqual([]);
  const popup = readCalibratedFrame(source.evaluate(36)).scorePopups[0]!;
  expect(popup).toMatchObject({ text: '+50', x: 250, fontSize: 50, style: 'gold' });
  expect(popup.y).toBeCloseTo(475);
  expect(popup.alpha).toBeCloseTo(1);
  expect(popup.scale).toBeCloseTo(1);
  expect(readCalibratedFrame(source.evaluate(55)).scorePopups).toEqual([]);
});
