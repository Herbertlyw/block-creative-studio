import { canEncodeAudio, Quality } from 'mediabunny';
import { ExportFailure, type ExportPhase } from './exportStatus';

let softwareReady: Promise<void> | undefined;

/** Register the official encoder only when this session cannot encode the requested AAC natively. */
export async function prepareAacEncoder({
  channels,
  bitrate,
  signal,
  onPhase,
}: {
  channels: 1 | 2;
  bitrate: number;
  signal?: AbortSignal | undefined;
  onPhase?: ((phase: ExportPhase) => void) | undefined;
}): Promise<'browser' | 'software'> {
  signal?.throwIfAborted();
  const options = {
    numberOfChannels: channels,
    sampleRate: 48_000,
    quality: new Quality({ bitrate }),
  };
  const available = await canEncodeAudio('aac', options);
  signal?.throwIfAborted();
  if (available) return softwareReady ? 'software' : 'browser';

  onPhase?.('audio-fallback');
  // Loading/registration is shared, but each export owns its cancellation and encoder worker.
  // A failed load must not poison the next attempt. Registration also clears codec probe caches.
  softwareReady ??= import('@mediabunny/aac-encoder')
    .then(({ registerAacEncoder }) => registerAacEncoder())
    .catch((error: unknown) => {
      softwareReady = undefined;
      throw error;
    });
  try {
    if (!signal) await softwareReady;
    else
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        softwareReady!.then(
          () => {
            signal.removeEventListener('abort', abort);
            resolve();
          },
          (error: unknown) => {
            signal.removeEventListener('abort', abort);
            reject(error);
          },
        );
        if (signal.aborted) abort();
      });
  } catch (error) {
    signal?.throwIfAborted();
    throw new ExportFailure('audio-fallback', 'AAC_ENCODER_LOAD_FAILED', error);
  }
  signal?.throwIfAborted();
  if (!(await canEncodeAudio('aac', options)))
    throw new ExportFailure('codec', 'ENCODER_UNSUPPORTED', '原生和软件编码器均不能编码 AAC。');
  signal?.throwIfAborted();
  return 'software';
}
