export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function frameProgress(frame: number, start: number, end: number): number {
  if (end <= start) return frame >= end ? 1 : 0;
  return clamp01((frame - start) / (end - start));
}

export function easeProgress(value: number, easing: 'smooth' | 'linear' | 'urgent' | 'snap' | 'tight' | 'elastic'): number {
  const t = clamp01(value);
  if (easing === 'linear') return t;
  if (easing === 'urgent') return 1 - (1 - t) ** 3;
  if (easing === 'snap') return t < 0.72 ? (t / 0.72) ** 2 * 0.88 : 0.88 + ((t - 0.72) / 0.28) * 0.12;
  if (easing === 'tight') return t * t * (3 - 2 * t);
  if (easing === 'elastic') {
    if (t === 0 || t === 1) return t;
    return clamp01(2 ** (-9 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1);
  }
  return t * t * (3 - 2 * t);
}

export function lerp(left: number, right: number, progress: number): number {
  return left + (right - left) * progress;
}
