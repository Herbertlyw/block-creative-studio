import { expect, it } from 'vitest';
import { syntheticObservedPackageFixture } from './fixtures/syntheticObserved';
import {
  buildObservedPointer,
  pointerAt,
  verifyObservedPointer,
  rebindPointerForImageVariant,
  verifyPointerAgainstObservation,
} from '../src/contracts/observedPointer';
const fixture = await syntheticObservedPackageFixture();
it('binds separate pointer coordinates to the measured clock, project and take', async () => {
  const doc = structuredClone(fixture.project),
    obs = structuredClone(fixture.source.observation),
    a = JSON.parse(obs.structured),
    mapping = {
      version: '1.0.0' as const,
      mode: 'stretch' as const,
      crop: { x: 0, y: 0, width: 512, height: 864 },
      x: 0,
      y: 0,
      confirmed: true,
    };
  const p = await buildObservedPointer(
    doc,
    a,
    obs.measurement,
    obs.source.sha256,
    512,
    864,
    mapping,
    20,
  );
  expect(pointerAt(p, 0.2)?.actionId).toBe('1');
  expect(pointerAt(p, 0.2)?.x).toBeCloseTo(216);
  expect(pointerAt(p, 0.2)?.y).toBeCloseTo(1536);
  expect(pointerAt(p, 0.45)?.x).toBeCloseTo(378);
  expect(pointerAt(p, 1)).toBeNull();
  await expect(verifyObservedPointer(doc, p)).resolves.toEqual(p);
  const bad = structuredClone(p);
  bad.tracks[0]!.actionId = 'other';
  await expect(verifyObservedPointer(doc, bad)).rejects.toThrow(/动作 ID/);
  const changed = structuredClone(doc);
  changed.takes[0].actions[0].id = 'bad';
  await expect(verifyObservedPointer(changed, p)).rejects.toThrow(/工程身份/);
  await expect(
    buildObservedPointer(
      doc,
      a,
      obs.measurement,
      obs.source.sha256,
      512,
      864,
      { ...mapping, confirmed: false },
      20,
    ),
  ).rejects.toThrow(/确认/);
});

it('rebinds a pointer only for the designated isolated image change', async () => {
  const original = structuredClone(fixture.project),
    p = structuredClone(fixture.pointer);
  const target = structuredClone(original);
  target.direction.style.agentAssets.entries['observed-coral'].sourceName = 'other.png';
  const linked = await rebindPointerForImageVariant(original, target, p, 'coral');
  expect(linked.tracks).toEqual(p.tracks);
  await expect(verifyObservedPointer(target, linked)).resolves.toEqual(linked);
  target.name = 'changed';
  await expect(rebindPointerForImageVariant(original, target, p, 'coral')).rejects.toThrow(/以外/);
});
it('keeps pointer coordinates independent when only block motion changes', async () => {
  const { bindObservedCalibration } = await import('../src/contracts/bindObservedCalibration');
  const obs = structuredClone(fixture.source.observation),
    a = JSON.parse(obs.structured),
    g = JSON.parse(obs.geometry),
    mapping = {
      version: '1.0.0' as const,
      mode: 'contain' as const,
      crop: { x: 0, y: 0, width: 512, height: 864 },
      x: 0,
      y: 0,
      confirmed: true,
    };
  const first = await bindObservedCalibration(a, obs.measurement, obs.source.sha256, 512, 864, g);
  const altered = structuredClone(g);
  altered.motions[0].points[0].x += 25;
  const second = await bindObservedCalibration(
    a,
    obs.measurement,
    obs.source.sha256,
    512,
    864,
    altered,
  );
  const p = await buildObservedPointer(
      first.document,
      a,
      obs.measurement,
      obs.source.sha256,
      512,
      864,
      mapping,
      20,
    ),
    q = await buildObservedPointer(
      second.document,
      a,
      obs.measurement,
      obs.source.sha256,
      512,
      864,
      mapping,
      20,
    );
  expect(p.tracks).toEqual(q.tracks);
  expect(p.projectSha256).not.toBe(q.projectSha256);
});

it('does not treat an edited pointer as matching the old source observation', async () => {
  const doc = structuredClone(fixture.project),
    obs = structuredClone(fixture.source.observation),
    p = structuredClone(fixture.pointer),
    shifted = structuredClone(fixture.pointer);
  shifted.tracks[0]!.points[0]!.x += 15;
  await expect(verifyPointerAgainstObservation(doc, p, obs)).resolves.toBeUndefined();
  await expect(verifyPointerAgainstObservation(doc, shifted, obs)).rejects.toThrow(/不一致/);
});
