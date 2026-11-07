import type { StudioProjectDocumentV2 } from '../../../game-runtime/projectEnvelope';
import { decodeBase64Image, sha256Hex } from '../../../agent-assets/image';
import {
  attachRuntimeAgentAssetBindings,
  runtimeAgentSequenceBindings,
  verifyRuntimeAgentSequenceBindings,
  type RuntimeAgentSequenceBinding,
} from '../../../agent-assets/storage';
import { AGENT_SEQUENCE_DEFAULT_PLAYBACK } from '../../../agent-assets/contracts';
import { agentSequenceFrameIndex } from '../../../agent-assets/sequences';
import { loadRuntimeImage } from '../../../agent-assets/runtimeImage';
import { stableHash } from '../../../headless/stableHash';
import { blockCrushDropAgentAssetDeclaration } from '../agent/assetBindings';
import { readClearEffectLibrary } from '../presentation/clearEffectLibrary';
import {
  CLEAR_SEQUENCE_MODEL,
  CLEAR_SEQUENCE_SLOT,
  inlineClearSequence,
} from '../presentation/clearSequence';
import type { BlockCrushDropPresentationFrame } from '../presentation/presentationAdapter';

export const clearSequenceRuntimeKey = (assetId: string) => `${CLEAR_SEQUENCE_SLOT}:${assetId}`;
/** Entries are selected by validated effect bindings, never by an unscoped slot. */
export function attachBlockCrushDropRuntimeAssets(
  runtimeAssets: unknown,
  document: StudioProjectDocumentV2,
  takeId: string,
) {
  const base = attachRuntimeAgentAssetBindings(
    runtimeAssets,
    document,
    blockCrushDropAgentAssetDeclaration,
  );
  const library = readClearEffectLibrary(document),
    selected = new Set(library.bindings.filter((b) => b.takeId === takeId).map((b) => b.effectId));
  const effects = library.effects.filter(
    (e) => selected.has(e.id) && e.model === CLEAR_SEQUENCE_MODEL,
  );
  if (!effects.length) return base;
  const bySlot = { ...runtimeAgentSequenceBindings(base)?.bySlot };
  const sequenceHashes: Record<string, string> = {};
  for (const effect of effects) {
    if (effect.model !== CLEAR_SEQUENCE_MODEL) continue;
    const a = inlineClearSequence(document, effect.sequence),
      slotId = clearSequenceRuntimeKey(a.id);
    sequenceHashes[slotId] = a.sha256;
    bySlot[slotId] = {
      slotId,
      fps: a.fps,
      playback: { ...AGENT_SEQUENCE_DEFAULT_PLAYBACK },
      frames: a.frames.map((f, i) => ({
        slotId,
        role: 'particle-sprite' as const,
        contentHash: `sha256:${f.sha256}`,
        sourceUri: `embedded:${a.id}#${i}`,
        objectUrl: `data:image/png;base64,${f.data}`,
        fileName: `${a.sourceName}#${i}`,
        mimeType: 'image/png' as const,
        width: a.width,
        height: a.height,
        fit: 'stretch' as const,
        opacity: 1,
        blendMode: 'source-over' as const,
        inset: 0,
      })),
    };
  }
  return {
    ...base,
    crushClearSequenceHashes: sequenceHashes,
    agentSequenceBindings: { revision: stableHash(bySlot), bySlot },
  };
}
export function assertBlockCrushDropNativeEffectExport(
  document: StudioProjectDocumentV2,
  takeId?: string,
): void {
  const l = readClearEffectLibrary(document),
    ids = new Set(l.effects.filter((e) => e.model === CLEAR_SEQUENCE_MODEL).map((e) => e.id));
  if (l.bindings.some((b) => (!takeId || b.takeId === takeId) && ids.has(b.effectId)))
    throw new Error(
      'CRUSH_SEQUENCE_NATIVE_EXPORT_UNSUPPORTED: imported effects require the normal project preview/render path',
    );
}
export class BlockCrushDropClearSequences {
  readonly ready: Promise<void>;
  private readonly sequences = new Map<
    string,
    { binding: RuntimeAgentSequenceBinding; images: CanvasImageSource[] }
  >();
  constructor(assets: unknown) {
    this.ready = (async () => {
      await verifyRuntimeAgentSequenceBindings(assets);
      for (const [key, binding] of Object.entries(
        runtimeAgentSequenceBindings(assets)?.bySlot ?? {},
      )) {
        if (!key.startsWith(`${CLEAR_SEQUENCE_SLOT}:`)) continue;
        const expected = (assets as { crushClearSequenceHashes?: Record<string, string> })
          .crushClearSequenceHashes?.[key];
        const buffers = binding.frames.map((f) =>
          decodeBase64Image(f.objectUrl.slice(f.objectUrl.indexOf(',') + 1)),
        );
        const ordered = new Uint8Array(buffers.reduce((sum, b) => sum + b.length, 0));
        let offset = 0;
        for (const b of buffers) {
          ordered.set(b, offset);
          offset += b.length;
        }
        if (!expected || (await sha256Hex(ordered)) !== expected)
          throw new Error('CRUSH_SEQUENCE_ORDERED_HASH_MISMATCH');
        const images: CanvasImageSource[] = [];
        const probe = document.createElement('canvas');
        probe.width = 1080;
        probe.height = 1920;
        const context = probe.getContext('2d', { willReadFrequently: true })!;
        let transparent = false;
        // Decode every frame during warmup; seeking must never reveal a late corrupt frame.
        for (const frame of binding.frames) {
          const image = await loadRuntimeImage(frame);
          if (!image) throw new Error(`CRUSH_SEQUENCE_FRAME_DECODE_FAILED: ${frame.sourceUri}`);
          const dimensions = image as { width: number; height: number };
          if (dimensions.width !== 1080 || dimensions.height !== 1920)
            throw new Error('CRUSH_SEQUENCE_RUNTIME_CANVAS_INVALID');
          context.clearRect(0, 0, 1080, 1920);
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, 1080, 1920).data;
          for (let i = 3; i < pixels.length; i += 4)
            if (pixels[i]! < 255) {
              transparent = true;
              break;
            }
          images.push(image);
        }
        if (!transparent) throw new Error('CRUSH_SEQUENCE_TRANSPARENT_ALPHA_REQUIRED');
        this.sequences.set(key, { binding, images });
      }
    })();
  }
  imagesAt(frame: BlockCrushDropPresentationFrame): CanvasImageSource[] {
    const out: CanvasImageSource[] = [];
    for (const cue of frame.sequenceCueSchedule ?? []) {
      const now = frame.frameIndex / frame.fps;
      if (now < cue.startSeconds || now >= cue.endSeconds) continue;
      const key = clearSequenceRuntimeKey(cue.sequence.assetId),
        resource = this.sequences.get(key);
      if (!resource)
        throw new Error(`CRUSH_SEQUENCE_RUNTIME_BINDING_MISSING: ${cue.sequence.assetId}`);
      const index = clearSequenceFrameAt(
        frame.frameIndex,
        frame.fps,
        cue.startSeconds,
        cue.endSeconds,
        resource.images.length,
        resource.binding.fps,
      );
      if (index !== null) out.push(resource.images[index]!);
    }
    return out;
  }
  draw(context: CanvasRenderingContext2D, frame: BlockCrushDropPresentationFrame): void {
    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.filter = 'none';
    for (const image of this.imagesAt(frame)) context.drawImage(image, 0, 0);
    context.restore();
  }
  dispose(): void {
    this.sequences.clear();
  }
}

/** Cue-relative seconds, with only a floating-point boundary tolerance. */
export function clearSequenceFrameAt(
  frameIndex: number,
  fps: number,
  startSeconds: number,
  endSeconds: number,
  count: number,
  sequenceFps: number,
): number | null {
  const now = frameIndex / fps;
  if (now < startSeconds || now >= endSeconds) return null;
  return agentSequenceFrameIndex({
    elapsedFrames: (now - startSeconds) * fps + 1e-8,
    presentationFps: fps,
    frameCount: count,
    sequenceFps,
    playback: AGENT_SEQUENCE_DEFAULT_PLAYBACK,
  });
}
