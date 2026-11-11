export type ExportPhase =
  | 'assets'
  | 'mixing'
  | 'codec'
  | 'audio-encoding'
  | 'video-encoding'
  | 'muxing'
  | 'audio-timing'
  | 'download';

export const EXPORT_PHASE_LABELS: Record<ExportPhase, string> = {
  assets: '素材准备',
  mixing: '音频混音',
  codec: '检测 AVC/AAC 编码能力',
  'audio-encoding': '音频编码',
  'video-encoding': '视频编码',
  muxing: 'MP4 封装',
  'audio-timing': 'AAC 动态时序校准',
  download: '准备下载',
};

export class ExportFailure extends Error {
  constructor(
    readonly phase: ExportPhase,
    readonly code: string,
    reason: unknown,
  ) {
    const detail = reason instanceof Error ? reason.message : String(reason);
    super(`${EXPORT_PHASE_LABELS[phase]}失败 [${code}]：${detail}`, { cause: reason });
    this.name = 'ExportFailure';
  }
}

export function isProjectMediaError(reason: unknown) {
  const detail = reason instanceof Error ? reason.message : String(reason);
  return /ASSET_(?:UNKNOWN|HASH_MISMATCH|UNRESOLVED)|AUDIO_(?:WAV|VOICE|BASE64)_|素材.*(?:缺失|不匹配|损坏)|SHA-256|哈希/.test(
    detail,
  );
}

export function exportFailure(reason: unknown, phase: ExportPhase): Error {
  if (reason instanceof ExportFailure) return reason;
  const detail = reason instanceof Error ? reason.message : String(reason);
  const code = isProjectMediaError(reason)
    ? 'ASSET_INVALID'
    : /不能编码|not supported|unsupported|no.*encoder/i.test(detail) && phase === 'codec'
      ? 'ENCODER_UNSUPPORTED'
      : phase === 'mixing'
        ? 'AUDIO_MIX_FAILED'
        : phase === 'download'
          ? 'DOWNLOAD_FAILED'
          : phase === 'muxing'
            ? 'MUX_FAILED'
            : phase === 'audio-timing'
              ? 'AAC_TIMING_FAILED'
              : 'ENCODE_FAILED';
  return new ExportFailure(phase, code, reason);
}

export function describeExportFailure(reason: unknown, phase: ExportPhase): string {
  const error = exportFailure(reason, phase);
  if (phase === 'download')
    return `${error.message}。未能确认下载发起；请检查浏览器下载列表，可重新导出。工程与编辑设置保留。`;
  return `${error.message}。本次未发布视频，可重新导出；工程与编辑设置保留。`;
}
