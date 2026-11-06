import { playbackFrame } from './playbackClock';

type AudioClock = { currentTime: number; startTime: number; startFrame: number };
/** Run a preview clock against RAF or, when present, its actual audio clock. */
export function startFramePlayback({
  initial,
  last,
  fps,
  readAudio,
  onFrame,
  onEnd,
  request,
  cancel,
}: {
  initial: number;
  last: number;
  fps: number;
  readAudio: () => AudioClock | null;
  onFrame: (frame: number) => void;
  onEnd: () => void;
  request: (callback: (time: number) => void) => number;
  cancel: (id: number) => void;
}): () => void {
  let origin: number | undefined,
    handle = 0,
    stopped = false;
  const tick = (time: number) => {
    if (stopped) return;
    origin ??= time;
    const audio = readAudio();
    const elapsed = audio ? audio.currentTime - audio.startTime : (time - origin) / 1000;
    const next = playbackFrame(audio?.startFrame ?? initial, last, fps, elapsed);
    onFrame(next);
    if (next >= last) {
      stopped = true;
      onEnd();
    } else handle = request(tick);
  };
  handle = request(tick);
  return () => {
    stopped = true;
    cancel(handle);
  };
}
