/** Source look-pack animation, sampled continuously on the canonical clock.
 * Observed on CRUSHZR29976 frames123..132, relative to pickup121.
 * This never changes a tray batch, availability, action or rule state.
 */
export function crushSourceTrayRefillScale(framesSincePickup: number): number {
  const samples = [0, 0.1, 0.5, 0.9, 1.08, 1.1, 1.04, 1.015, 1];
  const age = framesSincePickup - 2;
  if (age <= 0) return 0;
  if (age >= samples.length - 1) return 1;
  const i = Math.floor(age),
    t = age - i;
  return samples[i]! + (samples[i + 1]! - samples[i]!) * t;
}

export function crushSourceOutgoingTrayScale(framesSincePickup: number): number {
  const remaining = Math.max(0, Math.min(1, 1 - framesSincePickup / 2));
  return 0.35 * remaining * remaining;
}
