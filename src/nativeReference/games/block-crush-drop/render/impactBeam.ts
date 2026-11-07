import {
  sampleDropImpactBeamOpacity,
  sampleDropImpactBloomOpacity,
  type DropImpactBeamCue,
} from '../profiles/impactBeam';

const rgba = (hex: string, alpha: number): string => {
  const rgb = parseInt(hex.slice(1), 16);
  return `rgba(${rgb >> 16},${(rgb >> 8) & 255},${rgb & 255},${alpha})`;
};

/** Call in un-stretched source-stage space, after physical pieces and before HUD. */
export function drawDropImpactBeams(
  context: CanvasRenderingContext2D,
  beams: readonly DropImpactBeamCue[] | undefined,
  waves: ReadonlyArray<{ actionIndex?: number; cycleIndex?: number; elapsedFrames: number }>,
  outputFps: number,
): void {
  if (!beams?.length) return;
  for (const beam of beams) {
    const wave = waves.find(
      (wave) => wave.actionIndex === beam.actionIndex && wave.cycleIndex === beam.cycleIndex,
    );
    if (!wave) continue;
    const envelope = sampleDropImpactBeamOpacity(beam, wave.elapsedFrames, outputFps);
    const bloomEnvelope = sampleDropImpactBloomOpacity(beam, wave.elapsedFrames, outputFps);
    if (
      !(envelope > 0 && beam.opacity > 0) &&
      !(bloomEnvelope > 0 && beam.bloom && beam.bloom.opacity > 0)
    )
      continue;
    context.save();
    try {
      context.globalCompositeOperation = 'screen';
      if (beam.opacity > 0 && envelope > 0) {
        const extent = beam.horizontalFalloff.at(-1)!.distancePixels;
        const gradient = context.createLinearGradient(beam.x - extent, 0, beam.x + extent, 0);
        for (const key of [...beam.horizontalFalloff].reverse())
          gradient.addColorStop(
            (extent - key.distancePixels) / (2 * extent),
            rgba(beam.color, key.value),
          );
        for (const key of beam.horizontalFalloff.slice(1))
          gradient.addColorStop(
            (extent + key.distancePixels) / (2 * extent),
            rgba(beam.color, key.value),
          );
        context.globalAlpha *= beam.opacity * envelope;
        context.fillStyle = gradient;
        context.fillRect(beam.x - extent, beam.topY, extent * 2, beam.bottomY - beam.topY);
      }
    } finally {
      context.restore();
    }
    if (beam.bloom && beam.bloom.opacity > 0 && bloomEnvelope > 0) {
      const bloom = beam.bloom;
      context.save();
      try {
        context.globalCompositeOperation = 'screen';
        context.globalAlpha *= bloomEnvelope * bloom.opacity;
        context.translate(beam.x, bloom.centerY);
        context.scale(bloom.radiusX, bloom.radiusY);
        const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
        gradient.addColorStop(0, rgba(bloom.color, 1));
        const plateau = bloom.plateauRadiusFraction ?? 0;
        if (plateau > 0) gradient.addColorStop(plateau, rgba(bloom.color, 1));
        gradient.addColorStop(plateau + (1 - plateau) * 0.35, rgba(bloom.color, 0.8));
        gradient.addColorStop(1, rgba(bloom.color, 0));
        context.fillStyle = gradient;
        context.fillRect(-1, -1, 2, 2);
      } finally {
        context.restore();
      }
    }
  }
}
