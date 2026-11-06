import type { CalibrationProfile } from '../game-runtime/calibrationProfile';
import type { CompositionProfile } from './composition';

export class CompositionRegistryError extends Error {
  readonly code: string;
  readonly path?: string;

  constructor(code: string, message: string, path?: string) {
    super(message);
    this.name = 'CompositionRegistryError';
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

const compositions = new Map<string, CompositionProfile>();
const calibrations = new Map<string, CalibrationProfile>();
let defaultCompositionId: string | undefined;
let defaultCalibrationId: string | undefined;

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function hasCompositionProfile(id: string): boolean {
  return compositions.has(id);
}

export function hasCalibrationProfile(id: string): boolean {
  return calibrations.has(id);
}

export function registerCompositionProfile(profile: CompositionProfile): void {
  const existing = compositions.get(profile.id);
  if (existing) {
    if (existing === profile || sameJson(existing, profile)) return;
    throw new CompositionRegistryError(
      'DUPLICATE_COMPOSITION',
      `Composition profile ${profile.id} is already registered.`,
      '$.id',
    );
  }
  compositions.set(profile.id, profile);
  if (defaultCompositionId === undefined) defaultCompositionId = profile.id;
}

export function unregisterCompositionProfile(id: string): void {
  compositions.delete(id);
  if (defaultCompositionId === id) {
    defaultCompositionId = compositions.keys().next().value;
  }
}

export function registerCalibrationProfile(profile: CalibrationProfile): void {
  const composition = compositions.get(profile.compositionProfileId);
  if (!composition) {
    throw new CompositionRegistryError(
      'CALIBRATION_COMPOSITION_MISSING',
      `Calibration ${profile.id} references unknown composition ${profile.compositionProfileId}.`,
      '$.compositionProfileId',
    );
  }
  if (composition.gameId !== profile.gameId) {
    throw new CompositionRegistryError(
      'CALIBRATION_COMPOSITION_GAME_MISMATCH',
      `Calibration ${profile.id} game ${profile.gameId} does not match composition ${composition.id} game ${composition.gameId}.`,
      '$.gameId',
    );
  }
  const existing = calibrations.get(profile.id);
  if (existing) {
    if (existing === profile || sameJson(existing, profile)) return;
    throw new CompositionRegistryError(
      'DUPLICATE_CALIBRATION',
      `Calibration profile ${profile.id} is already registered.`,
      '$.id',
    );
  }
  calibrations.set(profile.id, profile);
  if (defaultCalibrationId === undefined) defaultCalibrationId = profile.id;
}

export function unregisterCalibrationProfile(id: string): void {
  calibrations.delete(id);
  if (defaultCalibrationId === id) {
    defaultCalibrationId = calibrations.keys().next().value;
  }
}

export function setDefaultCompositionProfile(id: string): void {
  if (!compositions.has(id)) {
    throw new CompositionRegistryError('UNKNOWN_COMPOSITION', `Unknown composition profile ${id}`, '$.id');
  }
  defaultCompositionId = id;
}

export function setDefaultCalibrationProfile(id: string): void {
  if (!calibrations.has(id)) {
    throw new CompositionRegistryError('UNKNOWN_CALIBRATION', `Unknown calibration profile ${id}`, '$.id');
  }
  defaultCalibrationId = id;
}

export function getCompositionProfile(id: string): CompositionProfile | undefined {
  return compositions.get(id);
}

export function getCalibrationProfile(id: string): CalibrationProfile | undefined {
  return calibrations.get(id);
}

export function requireCompositionProfile(id: string): CompositionProfile {
  const profile = compositions.get(id);
  if (!profile) {
    throw new CompositionRegistryError('UNKNOWN_COMPOSITION', `Unknown composition profile ${id}`, '$.id');
  }
  return profile;
}

export function requireCalibrationProfile(id: string): CalibrationProfile {
  const profile = calibrations.get(id);
  if (!profile) {
    throw new CompositionRegistryError('UNKNOWN_CALIBRATION', `Unknown calibration profile ${id}`, '$.id');
  }
  return profile;
}

export function getDefaultCompositionProfile(): CompositionProfile {
  if (defaultCompositionId === undefined) {
    throw new CompositionRegistryError(
      'NO_DEFAULT_COMPOSITION',
      'No default composition profile is registered. Call platform bootstrap first.',
    );
  }
  return requireCompositionProfile(defaultCompositionId);
}

export function getDefaultCalibrationProfile(): CalibrationProfile {
  if (defaultCalibrationId === undefined) {
    throw new CompositionRegistryError(
      'NO_DEFAULT_CALIBRATION',
      'No default calibration profile is registered. Call platform bootstrap first.',
    );
  }
  return requireCalibrationProfile(defaultCalibrationId);
}
