import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFramePlayback, type PlaybackAudio } from '../../components/useFramePlayback';
import { startPreviewAudio } from '../../contracts/previewAudio';
import { exportFrameVideo } from '../../exporter/exportFrameVideo';
import { downloadBlob } from '../../utils/download';
import type { BCProject } from './document';
import { compileBCPlayback, mixBCAudio, prepareBCScene } from './timeline';

export function useBCPlayer(project: BCProject | null, takeId: string, full: boolean) {
  const canvas = useRef<HTMLCanvasElement>(null),
    scene = useRef<Awaited<ReturnType<typeof prepareBCScene>> | null>(null);
  const audio = useRef<PlaybackAudio | null>(null),
    preparingAudio = useRef<AudioContext | null>(null),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  const [frame, setFrame] = useState(0),
    frameRef = useRef(frame);
  frameRef.current = frame;
  const [playing, setPlaying] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState('');
  const [exporting, setExporting] = useState(false),
    [progress, setProgress] = useState(''),
    [exportError, setExportError] = useState('');
  const compiled = useMemo(() => {
    if (!project) return { playback: null, error: '' };
    try {
      return { playback: compileBCPlayback(project, takeId, full), error: '' };
    } catch (reason) {
      return { playback: null, error: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [project, takeId, full]);
  const playback = compiled.playback;
  const previousView = useRef('');
  useFramePlayback({
    playing,
    setPlaying,
    frameRef,
    setFrame,
    fps: playback?.source.fps ?? null,
    totalFrames: playback?.totalFrames ?? null,
    audioRef: audio,
    generationRef: generation,
    clockKey: playback,
  });
  const closePreparingAudio = useCallback(() => {
    const context = preparingAudio.current;
    preparingAudio.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }, []);
  const pause = useCallback(() => {
    generation.current++;
    closePreparingAudio();
    setPlaying(false);
  }, [closePreparingAudio]);
  useEffect(() => {
    closePreparingAudio();
    setReady(false);
    setError('');
    setExportError('');
    setProgress('');
    setExporting(false);
    const viewKey = playback ? `${playback.project.id}:${playback.takeId}:${playback.start}` : '';
    const sameView = viewKey === previousView.current;
    previousView.current = viewKey;
    setFrame((current) => (sameView && playback ? Math.min(current, playback.totalFrames - 1) : 0));
    controller.current?.abort();
    controller.current = null;
    scene.current?.dispose();
    scene.current = null;
    if (!playback || !canvas.current) return;
    let cancelled = false;
    void prepareBCScene(canvas.current, playback)
      .then((value) => {
        if (cancelled) {
          value.dispose();
          return;
        }
        scene.current = value;
        value.render(Math.min(frameRef.current, playback.totalFrames - 1));
        setReady(true);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      closePreparingAudio();
      scene.current?.dispose();
      scene.current = null;
      controller.current?.abort();
      controller.current = null;
    };
  }, [playback, closePreparingAudio]);
  useEffect(() => {
    if (!ready || !scene.current) return;
    try {
      scene.current.render(frame);
    } catch (reason) {
      pause();
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [frame, ready, pause]);
  const seek = useCallback(
    (next: number) => {
      pause();
      setFrame(next);
    },
    [pause],
  );
  const play = useCallback(async () => {
    if (playing) {
      pause();
      return;
    }
    if (!playback || !ready) return;
    const ticket = ++generation.current;
    closePreparingAudio();
    let context: AudioContext | undefined;
    try {
      context = new AudioContext({ sampleRate: 48_000 });
      preparingAudio.current = context;
      await context.resume();
      if (ticket !== generation.current) {
        if (context.state !== 'closed') await context.close();
        return;
      }
      const mix = await mixBCAudio(playback);
      if (ticket !== generation.current) {
        if (context.state !== 'closed') await context.close();
        return;
      }
      const start = frameRef.current >= playback.totalFrames - 1 ? 0 : frameRef.current;
      setFrame(start);
      frameRef.current = start;
      if (mix)
        audio.current = startPreviewAudio(
          context,
          mix.track.data,
          mix.track.numberOfChannels,
          start,
          playback.source.fps,
        );
      else await context.close();
      setPlaying(true);
    } catch (reason) {
      if (context && context.state !== 'closed') await context.close();
      if (ticket === generation.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (preparingAudio.current === context) preparingAudio.current = null;
    }
  }, [playing, playback, ready, pause, closePreparingAudio]);
  const exportVideo = useCallback(async () => {
    if (
      !playback ||
      controller.current ||
      !ready ||
      compiled.error ||
      error ||
      !canvas.current ||
      !scene.current
    )
      return;
    pause();
    setExportError('');
    setExporting(true);
    setProgress('准备素材与音频…');
    const abort = new AbortController();
    controller.current = abort;
    // Controls are locked during export. Reuse the prepared scene so large PNG
    // sequences are not decoded a second time into another renderer.
    const surface = canvas.current,
      renderer = scene.current;
    const ownsExport = () => controller.current === abort;
    let preparationFailed = true;
    let renderFailed = false;
    try {
      const mix = await mixBCAudio(playback);
      abort.signal.throwIfAborted();
      preparationFailed = false;
      const blob = await exportFrameVideo({
        canvas: surface,
        width: playback.project.production.output.width,
        height: playback.project.production.output.height,
        fps: playback.source.fps,
        totalFrames: playback.totalFrames,
        render: (index) => {
          abort.signal.throwIfAborted();
          try {
            renderer.render(index);
          } catch (reason) {
            renderFailed = true;
            throw reason;
          }
        },
        audio: mix ? { pcm: mix.track.data, channels: mix.track.numberOfChannels } : null,
        signal: abort.signal,
        onProgress: (done, total) => {
          if (ownsExport() && !abort.signal.aborted)
            setProgress(`${Math.round((done / total) * 100)}% · ${done}/${total} 帧`);
        },
      });
      abort.signal.throwIfAborted();
      if (!ownsExport()) return;
      downloadBlob(blob, `${playback.project.name.replace(/[\\/:*?"<>|]/g, '-')}-${takeId}.mp4`);
      setProgress('视频下载已发起');
    } catch (reason) {
      if (ownsExport()) {
        if (abort.signal.aborted) setProgress('已取消，可重新导出。');
        else {
          const detail = reason instanceof Error ? reason.message : String(reason);
          // Invalid audio/assets or frame rendering block the project. Encoder
          // failures are scoped to this attempt and can be retried unchanged.
          if (preparationFailed || renderFailed) setError(detail);
          else setExportError(`导出失败：${detail}。可重新点击导出重试。`);
          setProgress('');
        }
      }
    } finally {
      if (ownsExport() && scene.current === renderer) {
        try {
          renderer.render(frameRef.current);
        } catch (reason) {
          setReady(false);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
      if (ownsExport()) {
        controller.current = null;
        setExporting(false);
      }
    }
  }, [playback, ready, pause, takeId, compiled.error, error]);
  return {
    canvas,
    frame,
    seek,
    playing,
    play,
    pause,
    playback,
    ready,
    error: compiled.error || error,
    exportError,
    exporting,
    exportVideo,
    progress,
    cancelExport: () => controller.current?.abort(),
  };
}
