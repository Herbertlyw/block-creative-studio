import { parseCalibrationRackCenters } from './calibrationRack';
import Ajv, { type ErrorObject } from 'ajv/dist/2020.js';
import placementSchema from '../../contracts/bb/schemas/block-placement-project.schema.json';
import envelopeSchema from '../../contracts/bb/schemas/game-project-v2.schema.json';
import { identifyCreativeDocument, type CreativeDocumentIdentity } from '../domain/projectIdentity';

const ajv = new Ajv({ allErrors: true, strict: false });
const validatePlacement = ajv.compile(placementSchema);
const validateEnvelope = ajv.compile(envelopeSchema);

export function isValidPlacementContract(value: unknown): boolean {
  if (!validatePlacement(value)) return false;
  const style = (
    value as {
      direction?: {
        style?: {
          referenceCalibration?: { rackCenters?: unknown };
          workbenchCalibrationV2?: { tracks?: Array<{ calibration?: { rackCenters?: unknown } }> };
        };
      };
    }
  )?.direction?.style;
  try {
    parseCalibrationRackCenters(style?.referenceCalibration?.rackCenters);
    if (Array.isArray(style?.workbenchCalibrationV2?.tracks))
      for (const track of style.workbenchCalibrationV2.tracks)
        parseCalibrationRackCenters(track.calibration?.rackCenters);
    return true;
  } catch {
    return false;
  }
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return 'Schema 校验未通过，但没有具体字段。';
  return errors
    .slice(0, 8)
    .map((error) => `${error.instancePath || '/'} ${error.message ?? '无效'}`)
    .join('；');
}

export function explainContractDocument(
  value: unknown,
  identity: CreativeDocumentIdentity = identifyCreativeDocument(value),
): string {
  if (identity.kind === 'public-studio-v1') {
    return '此展示版本不支持旧格式；原文件没有修改。';
  }
  if (identity.kind === 'placement-v2') {
    const valid = isValidPlacementContract(value);
    return valid
      ? ' Schema 校验通过，但这只说明结构符合 block-placement-project@2，不代表可完整播放或渲染，也不代表素材和音频可用。'
      : ` V2 Schema 未通过：${formatErrors(validatePlacement.errors)} 未作为可播放工程导入，原件可保存或仅修改名称。`;
  }
  if (identity.kind === 'studio-v2') {
    const valid = validateEnvelope(value);
    return valid
      ? ' 外层 V2 Schema 校验通过。当前编辑器没有对应游戏运行时。'
      : ` 外层 V2 Schema 未通过：${formatErrors(validateEnvelope.errors)}`;
  }
  return '';
}
