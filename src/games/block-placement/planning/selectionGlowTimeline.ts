/** Selection feedback is parameter data; a painter only consumes the sampled amount. */
export interface BBSelectionGlow {
  readonly enabled: boolean;
  readonly intensity: number;
  readonly haloPx: number;
  readonly edgePx: number;
}

export function selectionGlowAt(
  config: BBSelectionGlow | undefined,
  start: number,
  release: number,
  time: number,
): number {
  if (!config?.enabled || time < start || time >= release || release <= start) return 0;
  const attack = Math.min(0.055, (release - start) * 0.3),
    u = Math.min(1, (time - start) / attack);
  return config.intensity * u * u * (3 - 2 * u) * (0.94 + 0.06 * Math.cos((time - start) * 8));
}
