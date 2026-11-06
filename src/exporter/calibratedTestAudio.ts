import type { CompiledFrameSource } from '../nativeReference/game-runtime/frameSource';

export function makeCalibratedTestPcm(source: CompiledFrameSource, rate: number): Float32Array {
  const pcm = new Float32Array(Math.ceil((source.totalFrames * rate) / source.fps));
  for (let frame = 0; frame < source.totalFrames; frame++)
    for (const event of source.evaluate(frame).semanticEvents) {
      const frequency =
        event.type === 'block-placement.placement-committed'
          ? 660
          : event.type === 'block-placement.reference-clear-body'
            ? 990
            : 0;
      if (!frequency) continue;
      const start = Math.round((frame * rate) / source.fps),
        length = Math.round(0.035 * rate);
      for (let i = 0; i < length && start + i < pcm.length; i++)
        pcm[start + i] =
          (pcm[start + i] ?? 0) +
          0.3 * Math.sin((Math.PI * i) / length) * Math.sin((2 * Math.PI * frequency * i) / rate);
    }
  return pcm;
}
