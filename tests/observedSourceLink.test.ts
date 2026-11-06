import { syntheticObservedPackageFixture } from './fixtures/syntheticObserved';
import { expect, it } from 'vitest';
import {
  createObservedSourceLink,
  verifyObservedSourceLink,
} from '../src/contracts/observedSourceLink';
it('binds the exact project, video, measurement and authored observation without modifying them', async () => {
  const fixture = await syntheticObservedPackageFixture(),
    doc = fixture.project,
    obs = fixture.source.observation,
    m = obs.measurement,
    hash = obs.source.sha256,
    before = JSON.stringify(doc);
  const link = await createObservedSourceLink(doc, obs, hash, 512, 864);
  await expect(
    verifyObservedSourceLink(link, JSON.parse(JSON.stringify(doc)), obs, m, hash, 512, 864),
  ).resolves.toEqual(link);
  expect(JSON.stringify(doc)).toBe(before);
  const edited = structuredClone(doc);
  edited.takes[0].actions[0].id = 'changed';
  await expect(verifyObservedSourceLink(link, edited, obs, m, hash, 512, 864)).rejects.toThrow(
    /工程内容/,
  );
  const changed = structuredClone(obs);
  changed.geometry += ' ';
  await expect(verifyObservedSourceLink(link, doc, changed, m, hash, 512, 864)).rejects.toThrow(
    /观察记录/,
  );
  const badMeasure = structuredClone(m);
  badMeasure.source.fps = '29';
  await expect(
    verifyObservedSourceLink(link, doc, obs, badMeasure, hash, 512, 864),
  ).rejects.toThrow();
  await expect(
    verifyObservedSourceLink(link, doc, obs, m, 'f'.repeat(64), 512, 864),
  ).rejects.toThrow(/源视频/);
  await expect(
    verifyObservedSourceLink({ ...link, future: true }, doc, obs, m, hash, 512, 864),
  ).rejects.toThrow(/旁车合同/);
  const forged = structuredClone(doc);
  forged.name = 'changed';
  forged.direction.style.referenceCalibration.board[0] += 1;
  const forgedLink = await createObservedSourceLink(forged, obs, hash, 512, 864);
  await expect(
    verifyObservedSourceLink(forgedLink, forged, obs, m, hash, 512, 864),
  ).rejects.toThrow(/重放后/);
});
