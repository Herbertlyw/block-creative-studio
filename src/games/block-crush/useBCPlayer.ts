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
    generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  const [frame, setFrame] = useState(0),
    frameRef = useRef(frame);
  frameRef.current = frame;
  const [playing, setPlaying] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState('');
  const [exporting, setExporting] = useState(false),
    [progress, setProgress] = useState('');
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
  const pause = useCallback(() => {
    generation.current++;
    setPlaying(false);
  }, []);
  useEffect(() => {
    setReady(false);
    setError('');
    const viewKey = playback ? `${playback.project.id}:${playback.takeId}:${playback.start}` : '';
    const sameView = viewKey === previousView.current;
    previousView.current = viewKey;
    setFrame((current) => (sameView && playback ? Math.min(current, playback.totalFrames - 1) : 0));
    controller.current?.abort();
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
      scene.current?.dispose();
      scene.current = null;
      controller.current?.abort();
    };
  }, [playback]);
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
    const context = new AudioContext({ sampleRate: 48_000 });
    try {
      await context.resume();
      const mix = await mixBCAudio(playback);
      if (ticket !== generation.current) {
        await context.close();
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
      await context.close();
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [playing, playback, ready, pause]);
  const exportVideo = useCallback(async () => {
    if (!playback || exporting || !ready || !canvas.current || !scene.current) return;
    pause();
    setError('');
    setExporting(true);
    setProgress('准备素材与音频…');
    const abort = new AbortController();
    controller.current = abort;
    // Controls are locked during export. Reuse the prepared scene so large PNG
    // sequences are not decoded a second time into another renderer.
    const surface = canvas.current,
      renderer = scene.current;
    try {
      const mix = await mixBCAudio(playback);
      const blob = await exportFrameVideo({
        canvas: surface,
        width: playback.project.production.output.width,
        height: playback.project.production.output.height,
        fps: playback.source.fps,
        totalFrames: playback.totalFrames,
        render: (index) => renderer.render(index),
        audio: mix ? { pcm: mix.track.data, channels: mix.track.numberOfChannels } : null,
        signal: abort.signal,
        onProgress: (done, total) =>
          setProgress(`${Math.round((done / total) * 100)}% · ${done}/${total} 帧`),
      });
      if (abort.signal.aborted) throw new DOMException('工程已改变，导出已取消。', 'AbortError');
      downloadBlob(blob, `${playback.project.name.replace(/[\\/:*?"<>|]/g, '-')}-${takeId}.mp4`);
      setProgress('视频下载已发起');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setProgress('');
    } finally {
      if (scene.current === renderer) {
        try {
          renderer.render(frameRef.current);
        } catch (reason) {
          setReady(false);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
      if (controller.current === abort) controller.current = null;
      setExporting(false);
    }
  }, [playback, exporting, ready, pause, takeId]);
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
    exporting,
    exportVideo,
    progress,
    cancelExport: () => controller.current?.abort(),
  };
}
