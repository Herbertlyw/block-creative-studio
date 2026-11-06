import { expect, it } from 'vitest';
import { ordinaryProject } from './fixtures/ordinaryProject';
import { inspectNativeRuntime } from '../src/contracts/inspectNativeRuntime';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import { editNativeOutputSize } from '../src/contracts/editNativeDocument';

const project = () => JSON.parse(JSON.stringify(ordinaryProject()));
it('validates the current BB project and rejects an invalid initial state identity', () => {
  const doc = project();
  expect(inspectNativeRuntime(doc).validated).toBe(true);
  const stale = project();
  stale.game.initialState.data.pieces[0].color = 'violet';
  expect(inspectNativeRuntime(stale).validated).toBe(false);
});
it('rejects unknown and shape-mismatched candidate colors', () => {
  const short = project();
  short.game.initialState.data.pieces[1].cellColors = ['coral'];
  expect(inspectNativeRuntime(short).validated).toBe(false);
  const unknown = project();
  unknown.game.initialState.data.pieces[1].cellColors = ['coral', 'unknown', 'blue'];
  expect(inspectNativeRuntime(unknown).validated).toBe(false);
});
it('rejects malformed pointer coordinates and samples outside the action duration', () => {
  const coordinates = project();
  coordinates.takes[0].interactions[0].samples[0].x = 2;
  expect(() => compileNativeTake(coordinates, 'synthetic-take')).toThrow();
  const duration = project();
  duration.takes[0].interactions[0].samples[1].frameOffset = 10000;
  expect(() => compileNativeTake(duration, 'synthetic-take')).toThrow();
});
it('rejects odd output sizes and duplicate Take identities', () => {
  const doc = project();
  expect(() => editNativeOutputSize(JSON.stringify(doc), 1079, 1920)).toThrow(/偶数/);
  doc.takes.push(structuredClone(doc.takes[0]));
  expect(inspectNativeRuntime(doc).validated).toBe(false);
});
