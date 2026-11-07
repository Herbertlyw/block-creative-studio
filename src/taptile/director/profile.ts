import type { TapTileDirectorProfile } from '../project';
import type { RuntimeTapTileDirectorProfile } from './types';

export function resolveRuntimeDirectorProfile(source: TapTileDirectorProfile): RuntimeTapTileDirectorProfile {
  const urgent = source.pointerStyle === 'urgent';
  const fast = source.tileFlightStyle !== 'arc';
  const matchImplementation = source.matchStyle === 'shatter' ? 'sprite-sequence' : 'web-procedural';
  return {
    id: source.id,
    name: source.name,
    globalSpeed: source.globalSpeed,
    betweenActionFrames: source.betweenActionFrames,
    pointer: {
      style: source.pointerStyle,
      easing: urgent ? 'urgent' : source.pointerStyle === 'direct' ? 'linear' : 'smooth',
      leadDistancePx: urgent ? 100 : 150,
    },
    clickFeedback: { scale: urgent ? 0.88 : 0.93, ring: true },
    tileFlight: {
      style: source.tileFlightStyle,
      easing: source.tileFlightStyle === 'snap' ? 'snap' : fast ? 'linear' : 'smooth',
      arcHeightPx: source.tileFlightStyle === 'arc' ? 150 : source.tileFlightStyle === 'direct' ? 45 : 15,
    },
    trayMotion: {
      style: source.trayMotionStyle,
      easing: source.trayMotionStyle,
    },
    matchPresentation: {
      preFlash: { id: `${source.id}-pre-flash`, implementation: 'web-procedural', presetId: 'white-flash', intensity: 0.72 },
      tilePulse: { id: `${source.id}-tile-pulse`, implementation: 'web-procedural', presetId: source.matchStyle, intensity: 0.9 },
      shatter: { id: `${source.id}-shatter`, implementation: matchImplementation, presetId: source.matchStyle, intensity: 1 },
      particles: { id: `${source.id}-particles`, implementation: 'web-procedural', presetId: `${source.matchStyle}-particles`, intensity: 1 },
      praise: { enabled: true, labels: ['Nice', 'Great', 'Fantastic'] },
      camera: { enabled: source.cameraStyle !== 'steady', intensity: source.cameraStyle === 'rush' ? 1 : 0.65 },
      audioCueId: `match-${source.matchStyle}`,
    },
    camera: {
      style: source.cameraStyle,
      shakePx: source.cameraStyle === 'steady' ? 0 : source.cameraStyle === 'rush' ? 14 : 9,
      zoomImpact: source.cameraStyle === 'steady' ? 0 : source.cameraStyle === 'rush' ? 0.035 : 0.022,
    },
    timing: { ...source.timing },
  };
}
