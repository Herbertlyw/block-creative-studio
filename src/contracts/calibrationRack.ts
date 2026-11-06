import Ajv from 'ajv/dist/2020';
import schema from '../../contracts/bb/workbench-extensions/calibration-rack-v1.schema.json';
const validate = new Ajv({ strict: false }).compile(schema);
export type RackCenters = [number, number, number];
/** Optional compatible extension owned by this workbench, not the frozen reference. */
export function parseCalibrationRackCenters(raw: unknown): RackCenters | undefined {
  if (raw === undefined) return undefined;
  if (!validate({ rackCenters: raw }))
    throw new Error('候选横坐标须为 0 到 1080 内三个不同的数字。');
  const centers = raw as RackCenters;
  if (!(centers[0] < centers[1] && centers[1] < centers[2]))
    throw new Error('候选横坐标必须从左到右递增。');
  return [...centers];
}
