import { useEffect, useRef, useState } from 'react';
import { exportFrameVideo } from '../exporter/exportFrameVideo';
import { startPreviewAudio } from '../contracts/previewAudio';
import type { CompiledFrameSource } from '../nativeReference/game-runtime/frameSource';
import { useFramePlayback, type PlaybackAudio } from './useFramePlayback';

export interface BBPreviewAudio {
  pcm: Float32Array;
  channels: 1 | 2;
  warning?: string;
}
export interface BBPreviewStage {
  draw(frame: number): void;
  dispose(): void;
}
export interface BBPreviewConfiguration {
  source: CompiledFrameSource;
  output: { width: number; height: number };
  preview: { width: number; height: number };
  quality: { bitrate: number; scale: number };
  audioEnabled: boolean;
  audio(): Promise<BBPreviewAudio | null>;
  createStage(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    purpose: 'preview' | 'export',
    initialFrame: number,
    scale: number,
  ): Promise<BBPreviewStage>;
}

/** One lifecycle and clock for preview, seek, audio preparation and export. */
export function useBBTimelinePlayer(config: BBPreviewConfiguration | null) {
  const [frame, setFrame] = useState(0),
    [playing, setPlaying] = useState(false),
    [preparing, setPreparing] = useState(false),
    [exporting, setExporting] = useState(false),
    [ready, setReady] = useState(false),
    [status, setStatus] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null),
    stage = useRef<BBPreviewStage | null>(null),
    frameRef = useRef(frame);
  const audio = useRef<PlaybackAudio | null>(null),
    generation = useRef(0),
    exportAbort = useRef<AbortController | null>(null);
  frameRef.current = frame;
  useEffect(
    () => () => {
      exportAbort.current?.abort();
    },
    [config],
  );
  useEffect(() => {
    if (!config || !canvas.current) {
      setReady(false);
      stage.current = null;
      return;
    }
    const destination = canvas.current;
    let active = true,
      created: BBPreviewStage | null = null;
    setReady(false);
    stage.current = null;
    destination.width = config.preview.width;
    destination.height = config.preview.height;
    void config
      .createStage(
        destination,
        config.preview.width,
        config.preview.height,
        'preview',
        Math.min(frameRef.current, config.source.totalFrames - 1),
        1,
      )
      .then((value) => {
        created = value;
        if (!active) {
          value.dispose();
          return;
        }
        value.draw(Math.min(frameRef.current, config.source.totalFrames - 1));
        stage.current = value;
        setReady(true);
      })
      .catch((error: unknown) => {
        if (active)
          setStatus(
            `画面或素材准备失败：${error instanceof Error ? error.message : String(error)}`,
          );
      });
    return () => {
      active = false;
      if (stage.current === created) stage.current = null;
      created?.dispose();
    };
  }, [config]);
  useEffect(() => {
    if (!config || !stage.current) return;
    try {
      stage.current.draw(frame);
    } catch (error) {
      setPlaying(false);
      setReady(false);
      setStatus(`画面绘制失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [frame, config]);
  useFramePlayback({
    playing,
    setPlaying,
    frameRef,
    setFrame,
    fps: config?.source.fps ?? null,
    totalFrames: config?.source.totalFrames ?? null,
    audioRef: audio,
    generationRef: generation,
    clockKey: config,
  });
  const start = async () => {
    if (!config || !ready || preparing || exporting) return;
    const first = frameRef.current >= config.source.totalFrames - 1 ? 0 : frameRef.current;
    if (first !== frameRef.current) {
      frameRef.current = first;
      setFrame(first);
    }
    if (!config.audioEnabled) {
      setPlaying(true);
      return;
    }
    const token = ++generation.current;
    setPreparing(true);
    setStatus('正在准备预览音频…');
    const context = new AudioContext({ sampleRate: 48000 });
    try {
      await context.resume();
      if (context.sampleRate !== 48000) throw new Error('设备不支持 48 kHz 音频预览。');
      const track = await config.audio();
      if (token !== generation.current) {
        await context.close();
        return;
      }
      if (!track) throw new Error('音频配置未产生轨道。');
      audio.current = startPreviewAudio(
        context,
        track.pcm,
        track.channels,
        first,
        config.source.fps,
      );
      setPlaying(true);
      setStatus(`连续预览使用共同帧时钟。${track.warning ?? ''}`);
    } catch (error) {
      await context.close();
      if (token === generation.current)
        setStatus(`音频预览失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPreparing(false);
    }
  };
  const exportVideo = async (): Promise<{ blob: Blob; warning: string } | null> => {
    if (!config || !ready || preparing || exporting) return null;
    setPlaying(false);
    setExporting(true);
    setStatus('准备视频…');
    const controller = new AbortController();
    exportAbort.current = controller;
    let drawing: BBPreviewStage | null = null;
    try {
      const target = document.createElement('canvas'),
        { width, height } = config.output;
      drawing = await config.createStage(target, width, height, 'export', 0, config.quality.scale);
      const track = await config.audio(),
        active = drawing;
      const blob = await exportFrameVideo({
        canvas: target,
        width,
        height,
        fps: config.source.fps,
        totalFrames: config.source.totalFrames,
        bitrate: config.quality.bitrate,
        audio: track ? { pcm: track.pcm, channels: track.channels } : null,
        signal: controller.signal,
        render: (index) => active.draw(index),
        onProgress: (index, total) => setStatus(`视频 ${index} / ${total} 帧`),
      });
      if (controller.signal.aborted) throw new Error('作品或预览设置已更改，已取消旧导出。');
      return { blob, warning: track?.warning ?? '' };
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      if (exportAbort.current === controller) exportAbort.current = null;
      drawing?.dispose();
      setExporting(false);
    }
  };
  return {
    canvas,
    frame,
    setFrame,
    frameRef,
    playing,
    setPlaying,
    preparing,
    exporting,
    ready,
    status,
    setStatus,
    start,
    exportVideo,
  };
}
