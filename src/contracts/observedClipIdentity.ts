import { prepareCalibratedRenderer } from './calibratedRenderer';
import { verifyObservedPointer, type VerifiedPointerOverlay } from './observedPointer';
import { projectContentHash } from './observedSourceLink';

/** A pointer binds all project bytes, including clips. Recover the existing
 * pre-clip frame-source identity for comparison without changing the project
 * used to render, or weakening pointer verification. */
export async function observedPreClipSourceHash(
  project: unknown,
  pointer: VerifiedPointerOverlay,
  takeId: string,
): Promise<string> {
  await verifyObservedPointer(project, pointer);
  const projection = structuredClone(project) as any;
  delete projection.direction.production.clips;
  delete projection.direction.production.selectedClipId;
  const projectedPointer = await verifyObservedPointer(projection, {
    ...pointer,
    projectSha256: await projectContentHash(projection),
  });
  return prepareCalibratedRenderer(projection, takeId, projectedPointer).frameSource
    .frameSourceHash;
}
