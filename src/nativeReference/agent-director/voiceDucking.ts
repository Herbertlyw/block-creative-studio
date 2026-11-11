/** Build one shared envelope, using the full Take clock even for a cropped export.
 * Nearby speech intervals are joined across gaps <= attack + release to avoid pumping.
 * Overlap never multiplies attenuation; the strongest envelope wins.
 */
export function voiceDuckingEnvelope(
  intervals: Array<{ start: number; end: number }>,
  attack: number,
  release: number,
  firstSample: number,
  sampleCount: number,
): Float32Array {
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end + attack + release)
      last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  const envelope = new Float32Array(sampleCount);
  for (const { start, end } of merged) {
    const from = Math.max(0, start - attack - firstSample);
    const to = Math.min(sampleCount, end + release - firstSample);
    for (let i = Math.ceil(from); i < to; i++) {
      const time = i + firstSample;
      const amount = time < start ? (time - start + attack) / attack
        : time < end ? 1 : 1 - (time - end) / release;
      envelope[i] = Math.max(envelope[i]!, Math.max(0, Math.min(1, amount)));
    }
  }
  return envelope;
}
