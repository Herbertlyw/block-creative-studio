import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { startFramePlayback } from '../contracts/framePlaybackLoop';

export type PlaybackAudio = {
  context: AudioContext;
  source: AudioBufferSourceNode;
  startTime: number;
  startFrame: number;
};

/** Shared continuous playback clock and audio lifecycle for game previews. */
export function useFramePlayback({
  playing,
  setPlaying,
  frameRef,
  setFrame,
  fps,
  totalFrames,
  audioRef,
  generationRef,
  clockKey,
}: {
  playing: boolean;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  frameRef: RefObject<number>;
  setFrame: Dispatch<SetStateAction<number>>;
  fps: number | null;
  totalFrames: number | null;
  audioRef: RefObject<PlaybackAudio | null>;
  generationRef: RefObject<number>;
  clockKey: unknown;
}): void {
  const previousClock = useRef(clockKey);
  useEffect(() => {
    if (Object.is(previousClock.current, clockKey)) return;
    previousClock.current = clockKey;
    // A changed plan or resource set invalidates both an already playing mix
    // and any async mix still being prepared for the previous work snapshot.
    generationRef.current++;
    setPlaying(false);
    if (totalFrames !== null && totalFrames > 0 && frameRef.current >= totalFrames) {
      frameRef.current = totalFrames - 1;
      setFrame(totalFrames - 1);
    }
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      try {
        audio.source.stop();
      } catch {
        /* already stopped */
      }
      void audio.context.close();
    }
  }, [clockKey, totalFrames, frameRef, setFrame, setPlaying, audioRef, generationRef]);
  useEffect(() => {
    if (!playing || fps === null || totalFrames === null) return;
    return startFramePlayback({
      initial: frameRef.current,
      last: totalFrames - 1,
      fps,
      readAudio: () => {
        const audio = audioRef.current;
        return audio
          ? {
              currentTime: audio.context.currentTime,
              startTime: audio.startTime,
              startFrame: audio.startFrame,
            }
          : null;
      },
      onFrame: setFrame,
      onEnd: () => setPlaying(false),
      request: requestAnimationFrame,
      cancel: cancelAnimationFrame,
    });
  }, [playing, fps, totalFrames, frameRef, audioRef, setFrame, setPlaying, clockKey]);
  useEffect(() => {
    if (playing) return;
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      try {
        audio.source.stop();
      } catch {
        /* already stopped */
      }
      void audio.context.close();
    }
  }, [playing, audioRef]);
  useEffect(
    () => () => {
      generationRef.current++;
      const audio = audioRef.current;
      audioRef.current = null;
      if (audio) {
        try {
          audio.source.stop();
        } catch {
          /* already stopped */
        }
        void audio.context.close();
      }
    },
    [audioRef, generationRef],
  );
}
