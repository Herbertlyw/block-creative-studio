import { makeTemplateProject, type StackTemplateId } from '../stackModel';
import { migrateTapTileStackProjectV1 } from './migrateV1';
import type { TapTileProjectV2 } from './types';

export function createDefaultTapTileProject(templateId: StackTemplateId = 'hourglass'): TapTileProjectV2 {
  return migrateTapTileStackProjectV1(makeTemplateProject(templateId));
}
