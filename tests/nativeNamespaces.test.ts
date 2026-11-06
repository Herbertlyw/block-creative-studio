import { ordinaryProject } from './fixtures/ordinaryProject';
import { expect, it } from 'vitest';
import { restorePreservedNamespaces } from '../src/nativeReference/game-runtime/preservedNamespaces';
import {
  normalizePressureTrace,
  normalizeSurvivalAssessment,
} from '../src/nativeReference/game-runtime/pressureNormalization';
import type { StudioProjectDocumentV2 } from '../src/nativeReference/game-runtime/projectEnvelope';
const document = (): StudioProjectDocumentV2 => ordinaryProject() as StudioProjectDocumentV2;
it('preserves production and asset namespaces in a native bridge and honors invalidation', () => {
  const source = document(),
    bridge = structuredClone(source);
  delete bridge.direction!.production;
  delete (bridge.direction!.style as any).agentAssets;
  const result = restorePreservedNamespaces(source, bridge, { nativeBridge: true });
  expect(result.restored).toEqual(['direction.production', 'direction.style.agentAssets']);
  expect(result.document!.direction!.production).toEqual(source.direction!.production);
  expect((result.document!.direction!.style as any).agentAssets).toEqual(
    (source.direction!.style as any).agentAssets,
  );
  (result.document!.direction!.production as any).version = 'changed';
  expect((source.direction!.production as any).version).not.toBe('changed');
  const invalidated = restorePreservedNamespaces(source, bridge, {
    invalidates: ['direction.production', 'direction.style.agentAssets'],
  });
  expect(invalidated.restored).toEqual([]);
  expect(invalidated.document!.direction!.production).toBeUndefined();
});
it('normalizes provider pressure without losing native metrics or claiming a guarantee', () => {
  const metrics = [
    { step: 4, occupancyRatio: 0.5, capacity: { used: 3, limit: 4 }, custom: 'retained' },
    { occupancyRatio: 0.25 },
  ];
  const trace = normalizePressureTrace(metrics)!;
  expect(trace.points[0]).toMatchObject({
    step: 4,
    capacity: { used: 3, limit: 4, ratio: 0.75 },
    nativeMetrics: metrics[0],
  });
  expect(trace.points[1]).toMatchObject({
    step: 2,
    capacity: { used: 0.25, limit: 1, ratio: 0.25 },
  });
  expect(normalizeSurvivalAssessment(true, { verified: false })).toMatchObject({
    passes: false,
    arbitraryPlayerGuarantee: false,
  });
  const assessment = { custom: 'provided' };
  expect(normalizeSurvivalAssessment(false, { assessment })).toBe(assessment);
});
