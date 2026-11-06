import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import type { useBBTimelinePlayer } from './useBBTimelinePlayer';

type Player = ReturnType<typeof useBBTimelinePlayer>;
/** Shared canvas, frame seek, playback and export controls for every BB input. */
export function BBPlaybackControls({
  player,
  totalFrames,
  fps,
  canvasLabel,
  seekLabel,
  playLabel,
  pauseLabel,
  exportLabel,
  onExport,
  canvasStyle,
  onCanvasClick,
  seekWhilePlaying = true,
  disablePlay = false,
  disableExport = false,
  disableExportWhilePlaying = false,
  audioControls,
  afterCanvas,
  details,
}: {
  player: Player;
  totalFrames: number;
  fps: number;
  canvasLabel: string;
  seekLabel: string;
  playLabel: string;
  pauseLabel: string;
  exportLabel: string;
  onExport: () => void;
  canvasStyle?: CSSProperties;
  onCanvasClick?: MouseEventHandler<HTMLCanvasElement>;
  seekWhilePlaying?: boolean;
  disablePlay?: boolean;
  disableExport?: boolean;
  disableExportWhilePlaying?: boolean;
  audioControls?: ReactNode;
  afterCanvas?: ReactNode;
  details?: ReactNode;
}) {
  const busy = player.preparing || player.exporting;
  return (
    <>
      <canvas
        ref={player.canvas}
        aria-label={canvasLabel}
        style={canvasStyle}
        onClick={onCanvasClick}
      />
      <label>
        帧 {player.frame} / {totalFrames - 1}{' '}
        <input
          aria-label={seekLabel}
          type="range"
          min={0}
          max={totalFrames - 1}
          value={player.frame}
          disabled={busy || (!seekWhilePlaying && player.playing)}
          onChange={(event) => {
            if (seekWhilePlaying) player.setPlaying(false);
            player.setFrame(Number(event.target.value));
          }}
        />
      </label>{' '}
      <span>
        {fps} fps；共 {totalFrames} 帧。
      </span>
      {details}
      {afterCanvas}
      <button
        className="button-secondary"
        disabled={busy || !player.ready || disablePlay}
        onClick={() => (player.playing ? player.setPlaying(false) : void player.start())}
      >
        {player.preparing ? '准备预览音频…' : player.playing ? pauseLabel : playLabel}
      </button>{' '}
      {audioControls}{' '}
      <button
        className="button-secondary"
        disabled={
          busy || !player.ready || disableExport || (disableExportWhilePlaying && player.playing)
        }
        onClick={onExport}
      >
        {exportLabel}
      </button>
    </>
  );
}
