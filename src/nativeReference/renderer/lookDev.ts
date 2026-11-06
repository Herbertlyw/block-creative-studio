import type {
  FxPresetId,
  LookDevPresetId,
  ThreeLookDevStyle,
} from '../domain/types';

export const LOOKDEV_PRESETS: Record<LookDevPresetId, ThreeLookDevStyle> = {
  'neutral-lookdev': {
    id: 'neutral-lookdev',
    exposure: 0.9,
    environmentIntensity: 0.48,
    bloomStrength: 0,
    bloomThreshold: 1.15,
    bloomRadius: 0.18,
    clearBloomBoost: 0,
  },
  'balanced-cinematic': {
    id: 'balanced-cinematic',
    exposure: 0.96,
    environmentIntensity: 0.72,
    bloomStrength: 0.06,
    bloomThreshold: 1.08,
    bloomRadius: 0.24,
    clearBloomBoost: 0.07,
  },
  'high-energy': {
    id: 'high-energy',
    exposure: 1,
    environmentIntensity: 0.84,
    bloomStrength: 0.1,
    bloomThreshold: 0.98,
    bloomRadius: 0.32,
    clearBloomBoost: 0.12,
  },
};

export interface LookDevBloomState {
  strength: number;
  threshold: number;
  radius: number;
}

export function resolveLookDevBloom(
  lookDev: ThreeLookDevStyle,
  quality: 'interactive' | 'cinematic',
  clearProgress = 0,
  fx: FxPresetId = 'clean-pop',
): LookDevBloomState {
  const qualityMultiplier = quality === 'cinematic' ? 1.08 : 1;
  const progress = Math.max(0, Math.min(1, clearProgress));
  const fxMultiplier = fx === 'energy-burst' ? 1.25 : fx === 'crystal-shatter' ? 1 : 0.72;
  return {
    strength:
      lookDev.bloomStrength * qualityMultiplier
      + Math.sin(progress * Math.PI) * lookDev.clearBloomBoost * fxMultiplier,
    threshold: lookDev.bloomThreshold,
    radius: lookDev.bloomRadius,
  };
}

export function copyLookDevPreset(id: LookDevPresetId): ThreeLookDevStyle {
  return { ...LOOKDEV_PRESETS[id] };
}
