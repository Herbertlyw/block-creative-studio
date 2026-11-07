import { TAPTILE_RULE_PROFILE_ID } from '../project';

export const TAPTILE_MATCH3_PROFILE = Object.freeze({
  id: TAPTILE_RULE_PROFILE_ID,
  matchSize: 3,
  trayCapacity: 7,
  warningAt: 6,
} as const);
