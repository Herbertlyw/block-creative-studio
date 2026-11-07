import type { FixedFrameExportResult } from '../../exporter/fixedFrameExporter';
import { stableStringify, type CompiledTapTileLevel, type TapTileProjectV2 } from '../project';
import type { TapTileProductionRenderJob } from './renderJob';

export interface TapTileRenderManifest {
  format: 'taptile-render-manifest';
  version: '1.0.0';
  combinationHash: string;
  source: {
    projectId: string;
    projectRevision: number;
    levelId: string;
    takeId: string;
    skinPackId: string;
    directorProfileId: string;
    audioPackId: string;
    cutSpecId: string;
    outroPackId?: string;
    renderSpec: TapTileProjectV2['render'];
    blenderVfx?: {
      fileName: string;
      sha256: string;
      byteLength: number;
      fragmentCount: number;
      matchEventIds: string[];
      isolated: boolean;
      timeline: { frameStart: number; frameEnd: number; frameCount: number; fps: number };
    };
  };
  identities: TapTileProductionRenderJob['identity'];
  timeline: {
    sourceStartFrame: number;
    sourceEndFrame: number;
    totalFrames: number;
    fps: number;
    durationSeconds: number;
  };
  audio: {
    codec: 'aac';
    sampleRate: number;
    channels: number;
    cueCount: number;
    pcmHash: string;
    peakBeforeLimit: number;
    peakAfterLimit: number;
    peakLimit: number;
  };
  output: {
    fileName: string;
    mimeType: 'video/mp4';
    bytes: number;
    sha256: string;
    videoCodec: 'avc';
    audioCodec: 'aac';
    renderScale: number;
    verification: FixedFrameExportResult['verification'];
  };
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('SHA256_UNAVAILABLE');
  const normalized = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', normalized)));
}

export async function sha256Blob(blob: Blob): Promise<string> {
  return sha256Bytes(new Uint8Array(await blob.arrayBuffer()));
}

export async function createTapTileRenderManifest(
  project: TapTileProjectV2,
  level: CompiledTapTileLevel,
  job: TapTileProductionRenderJob,
  result: FixedFrameExportResult,
): Promise<TapTileRenderManifest> {
  if (result.audioCodec !== 'aac') throw new Error('RENDER_MANIFEST_AUDIO_CODEC_MISSING');
  return {
    format: 'taptile-render-manifest',
    version: '1.0.0',
    combinationHash: job.identity.combinationHash,
    source: {
      projectId: project.id,
      projectRevision: project.revision,
      levelId: project.level.id,
      takeId: job.baseJob.compiledTake.takeId,
      skinPackId: job.baseJob.project.visuals.selectedThemeId,
      directorProfileId: job.baseJob.compiledTake.profileId,
      audioPackId: job.audioPack.id,
      cutSpecId: job.cut.cutSpec.id,
      ...(job.cut.outro ? { outroPackId: job.cut.outro.id } : {}),
      renderSpec: structuredClone(job.baseJob.project.render),
      ...(job.blenderVfxAsset ? {
        blenderVfx: {
          fileName: job.blenderVfxAsset.fileName,
          sha256: job.blenderVfxAsset.sha256,
          byteLength: job.blenderVfxAsset.byteLength,
          fragmentCount: job.blenderVfxAsset.validation.effectFragmentCount,
          matchEventIds: (job.blenderVfxAsset.validation.inspection.entityIdsByRole['match-core'] ?? [])
            .map((id) => id.endsWith('::core') ? id.slice(0, -'::core'.length) : id)
            .sort(),
          isolated: job.blenderVfxAsset.validation.tileEntityCount === 0,
          timeline: structuredClone(job.blenderVfxAsset.validation.inspection.timeline!),
        },
      } : {}),
    },
    identities: structuredClone(job.identity),
    timeline: {
      sourceStartFrame: job.cut.sourceStartFrame,
      sourceEndFrame: job.cut.sourceEndFrame,
      totalFrames: job.totalFrames,
      fps: job.fps,
      durationSeconds: job.totalFrames / job.fps,
    },
    audio: {
      codec: 'aac',
      sampleRate: job.audioMix.sampleRate,
      channels: job.audioMix.numberOfChannels,
      cueCount: job.audioMix.scheduledCues.length,
      pcmHash: job.audioMix.pcmHash,
      peakBeforeLimit: job.audioMix.peakBeforeLimit,
      peakAfterLimit: job.audioMix.peakAfterLimit,
      peakLimit: job.audioMix.peakLimit,
    },
    output: {
      fileName: result.fileName,
      mimeType: 'video/mp4',
      bytes: result.blob.size,
      sha256: await sha256Blob(result.blob),
      videoCodec: result.codec,
      audioCodec: result.audioCodec,
      renderScale: result.renderScale,
      verification: structuredClone(result.verification),
    },
  };
}

export function serializeTapTileRenderManifest(manifest: TapTileRenderManifest): string {
  return `${stableStringify(manifest)}\n`;
}
