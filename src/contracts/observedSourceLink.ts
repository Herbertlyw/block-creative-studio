import Ajv from 'ajv/dist/2020';
import schema from '../../contracts/bb/workbench-extensions/observed-source-link-v1.schema.json';
import { sha256Hex } from '../nativeReference/agent-assets/image';
import { validateReferenceMeasurement } from './referenceMeasurement';

const schemaValidator = new Ajv({ strict: false }).compile(schema);
const validLink = (value: unknown): boolean => Boolean(schemaValidator(value));
/** Stable JSON is independent of whitespace and object-key ordering, but includes every value. */
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  throw new Error('来源关联中含无法稳定编码的值。');
}
async function digest(value: unknown) {
  return sha256Hex(new TextEncoder().encode(canonical(value)));
}
export const projectContentHash = (value: unknown) => digest(value);
/** Source evidence binds measured gameplay and geometry; presentation-only
 * changes remain legitimate derivatives, not a claim of visual equivalence. */
export function observedCalibrationIdentity(value: any) {
  return {
    duration: value.duration,
    sourceOffset: value.sourceOffset,
    board: value.board,
    rackY: value.rackY,
    rackCell: value.rackCell,
    rackCenters: value.rackCenters ?? value.appearance?.rackCenters ?? [236, 540, 844],
    actions: value.actions.map((action: any) => ({
      actionId: action.actionId,
      start: action.start,
      release: action.release,
      clear: action.clear,
      slot: action.slot,
      motion: action.motion ?? null,
    })),
  };
}
function projection(observation: any) {
  if (
    !observation ||
    observation.version !== '1.0.0' ||
    !Array.isArray(observation.observations) ||
    typeof observation.structured !== 'string' ||
    typeof observation.geometry !== 'string'
  )
    throw new Error('观察记录缺少版本、观察、标注或几何。');
  return observation;
}
export async function createObservedSourceLink(
  project: unknown,
  observation: any,
  sourceHash: string,
  width: number,
  height: number,
) {
  if (!/^[a-f0-9]{64}$/.test(sourceHash) || observation?.source?.sha256 !== sourceHash)
    throw new Error('观察记录与源视频 SHA-256 不匹配。');
  const measurement = validateReferenceMeasurement(
    observation.measurement,
    sourceHash,
    width,
    height,
  );
  const source = measurement.source;
  return {
    contract: 'bcs.workbench.observation-link',
    version: '1.0.0',
    projectSha256: await digest(project),
    measurementSha256: await digest(measurement),
    observationSha256: await digest(projection(observation)),
    source: {
      sha256: sourceHash,
      width,
      height,
      fps: source.fps,
      timeBase: source.timeBase,
      firstTimestamp: source.firstTimestamp,
      frameCount: source.frameCount,
    },
  };
}
export async function verifyObservedSourceLink(
  link: any,
  project: unknown,
  observation: any,
  measurement: unknown,
  sourceHash: string,
  width: number,
  height: number,
) {
  const exact = (v: any, keys: string[]) =>
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).sort().join(',') === [...keys].sort().join(',');
  if (
    !validLink(link) ||
    !exact(link, [
      'contract',
      'version',
      'projectSha256',
      'measurementSha256',
      'observationSha256',
      'source',
    ]) ||
    link.contract !== 'bcs.workbench.observation-link' ||
    link.version !== '1.0.0' ||
    !exact(link.source, [
      'sha256',
      'width',
      'height',
      'fps',
      'timeBase',
      'firstTimestamp',
      'frameCount',
    ]) ||
    ![link.projectSha256, link.measurementSha256, link.observationSha256, link.source.sha256].every(
      (x: unknown) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x),
    )
  )
    throw new Error('来源旁车合同无效或版本不支持。');
  if (
    link.source.sha256 !== sourceHash ||
    link.source.width !== width ||
    link.source.height !== height
  )
    throw new Error('源视频身份或尺寸与旁车不一致。');
  const valid = validateReferenceMeasurement(measurement, sourceHash, width, height);
  if ((await digest(valid)) !== link.measurementSha256) throw new Error('测量内容与旁车不一致。');
  if ((await digest(project)) !== link.projectSha256)
    throw new Error('工程内容与旁车不一致，不能使用旧来源关联。');
  const expected = await createObservedSourceLink(project, observation, sourceHash, width, height);
  if (expected.measurementSha256 !== link.measurementSha256)
    throw new Error('观察记录中的测量与旁车不一致。');
  if (expected.observationSha256 !== link.observationSha256)
    throw new Error('观察记录、动作或几何已变化，不能使用旧旁车。');
  if (canonical(expected.source) !== canonical(link.source))
    throw new Error('来源时间基摘要与测量不一致。');
  // A matching hash alone is not proof that the observation generated the game.
  // Replay and recompile the authored fields, ignoring only separately checked sprite attachments.
  const { bindObservedCalibration } = await import('./bindObservedCalibration');
  const rebuilt = await bindObservedCalibration(
    JSON.parse(observation.structured),
    valid,
    sourceHash,
    width,
    height,
    JSON.parse(observation.geometry),
  );
  const actual = (project as any)?.direction?.style?.referenceCalibration;
  if (!actual) throw new Error('工程缺少校准轨道。');
  if (
    canonical((project as any).game) !== canonical(rebuilt.document.game) ||
    canonical((project as any).takes) !== canonical(rebuilt.document.takes) ||
    canonical((project as any).production) !== canonical(rebuilt.document.production) ||
    canonical(observedCalibrationIdentity(actual)) !==
      canonical(
        observedCalibrationIdentity(
          (rebuilt.document.direction?.style as any)?.referenceCalibration,
        ),
      )
  )
    throw new Error('观察记录重放后的玩法或校准轨道与工程不一致。');
  return expected;
}
