import { referenceCameraOffset } from './cameraShake';

export function impactPose(
  style: string | undefined,
  age: number,
  lines: number,
  allClear: boolean,
) {
  const zero = { x: 0, y: 0, scale: 1 };
  if (!style || style === 'off' || age <= 0) return zero;
  const duration = style === 'elastic-settle' ? 0.22 : style === 'micro-zoom' ? 0.16 : 0.13;
  if (age >= duration) return zero;
  const q = age / duration,
    e = (1 - q) ** 2,
    power = allClear ? 1.3 : lines >= 3 ? 1 : lines === 2 ? 0.7 : 0.45;
  const wave = Math.sin(q * Math.PI * 4),
    kick = Math.sin(q * Math.PI * 2);
  switch (style) {
    case 'soft-tap':
      return {
        x: wave * 2.8 * e * power,
        y: Math.sin(q * Math.PI * 3) * 1.7 * e * power,
        scale: 1,
      };
    case 'vertical-kick':
      return { x: 0, y: -kick * 7 * e * power, scale: 1 };
    case 'horizontal-snap':
      return { x: wave * 7 * e * power, y: 0, scale: 1 };
    case 'diagonal-recoil':
      return { x: -kick * 4.8 * e * power, y: kick * 4.8 * e * power, scale: 1 };
    case 'micro-zoom':
      return { x: 0, y: 0, scale: 1 + Math.sin(q * Math.PI) * 0.008 * power };
    case 'elastic-settle':
      return {
        x: Math.sin(q * Math.PI * 5) * 3.5 * e * power,
        y: -Math.sin(q * Math.PI * 3) * 5 * e * power,
        scale: 1 + Math.sin(q * Math.PI) * 0.003 * power,
      };
    default:
      return zero;
  }
}

export interface BBCameraTimeline {
  readonly translation: readonly (readonly [number, number, number])[] | null;
  readonly impactStyle: string | null;
  readonly impulses: readonly {
    readonly clearSeconds: number;
    readonly lineCount: number;
    readonly allClear: boolean;
  }[];
}
export function evaluateBBCamera(plan: BBCameraTimeline, time: number) {
  const [x, y] = referenceCameraOffset(
    plan.impactStyle === null ? (plan.translation ?? undefined) : undefined,
    time,
  );
  let impact = { x: 0, y: 0, scale: 1 };
  for (let index = plan.impulses.length - 1; index >= 0; index--) {
    const item = plan.impulses[index];
    if (!item || time < item.clearSeconds) continue;
    impact = impactPose(
      plan.impactStyle ?? undefined,
      time - item.clearSeconds,
      item.lineCount,
      item.allClear,
    );
    break;
  }
  return { x: x + impact.x, y: y + impact.y, scale: impact.scale };
}
