import type { CSSProperties } from 'react';
import type { TapTileDirectorProfile, TapTileDirectorTiming } from '../project';
import type { CompiledTapTileTake } from './types';

export function DirectorTimeline({
  compiled,
  currentFrame,
  zoom,
  profiles,
  selectedProfileId,
  selectedActionId,
  actionOverrides,
  onSeek,
  onZoom,
  onProfileChange,
  onSelectAction,
  onTimingOverride,
  onResetOverride,
}: {
  compiled: CompiledTapTileTake;
  currentFrame: number;
  zoom: number;
  profiles: Record<string, TapTileDirectorProfile>;
  selectedProfileId: string;
  selectedActionId: string | null;
  actionOverrides: Record<string, Partial<TapTileDirectorTiming>>;
  onSeek(frame: number): void;
  onZoom(value: number): void;
  onProfileChange(profileId: string): void;
  onSelectAction(actionId: string): void;
  onTimingOverride(actionId: string, key: keyof TapTileDirectorTiming, value: number): void;
  onResetOverride(actionId: string): void;
}) {
  const pixelsPerFrame = 1.4 * zoom;
  const timelineWidth = Math.max(760, compiled.totalFrames * pixelsPerFrame + 36);
  const selectedAction = compiled.actions.find((action) => action.actionId === selectedActionId) ?? null;
  const overlapCount = compiled.actions.filter((action, index) => {
    const next = compiled.actions[index + 1];
    return action.transition.matchedTileIds.length > 0 && next && next.timing.actionStartFrame < action.timing.matchVfxEndFrame;
  }).length;
  const firstOverlapFrame = compiled.actions.find((action, index) => {
    const next = compiled.actions[index + 1];
    return action.transition.matchedTileIds.length > 0 && next && next.timing.actionStartFrame < action.timing.matchVfxEndFrame;
  })?.timing.inputReadyFrame;
  return (
    <section
      className="tpt-director-timeline"
      data-total-frames={compiled.totalFrames}
      data-profile-id={compiled.profileId}
      data-overlap-count={overlapCount}
      data-first-overlap-frame={firstOverlapFrame ?? ''}
      data-level-hash={compiled.levelHash}
      data-final-state-hash={compiled.finalStateHash}
    >
      <header className="tpt-director-toolbar">
        <div><strong>导演时间线</strong><small>{compiled.actions.length} 动作 · {compiled.events.length} 语义事件 · {compiled.totalFrames} 帧</small></div>
        <label><span>Profile</span><select data-director-profile value={selectedProfileId} onChange={(event) => onProfileChange(event.target.value)}>{Object.values(profiles).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        <label><span>缩放</span><input data-director-zoom type="range" min="0.35" max="2.4" step="0.05" value={zoom} onChange={(event) => onZoom(Number(event.target.value))} /></label>
      </header>
      <div className="tpt-director-scroll">
        <div className="tpt-director-canvas" style={{ width: `${timelineWidth}px` }}>
          <div className="tpt-director-ruler">
            {Array.from({ length: Math.ceil(compiled.totalFrames / 30) + 1 }, (_, index) => (
              <i key={index} style={{ left: `${index * 30 * pixelsPerFrame}px` }}><span>{index}s</span></i>
            ))}
          </div>
          <div className="tpt-director-action-track">
            {compiled.actions.map((action) => {
              const left = action.timing.actionStartFrame * pixelsPerFrame;
              const width = Math.max(8, (action.timing.actionVisualEndFrame - action.timing.actionStartFrame + 1) * pixelsPerFrame);
              const flightLeft = (action.timing.flightStartFrame - action.timing.actionStartFrame) * pixelsPerFrame;
              const flightWidth = Math.max(2, action.effectiveTiming.flightFrames * pixelsPerFrame);
              const matchLeft = (action.timing.matchStartFrame - action.timing.actionStartFrame) * pixelsPerFrame;
              const matchWidth = Math.max(0, (action.timing.matchVfxEndFrame - action.timing.matchStartFrame) * pixelsPerFrame);
              return (
                <button
                  key={action.actionId}
                  type="button"
                  className={`tpt-director-action${selectedActionId === action.actionId ? ' is-selected' : ''}${action.transition.matchedTileIds.length > 0 ? ' has-match' : ''}`}
                  data-director-action={action.actionId}
                  data-action-index={action.index}
                  style={{ left: `${left}px`, width: `${width}px` }}
                  onClick={() => onSelectAction(action.actionId)}
                  title={`${action.index + 1}. ${action.tileId}`}
                >
                  <span className="segment-pointer" />
                  <span className="segment-flight" style={{ left: `${flightLeft}px`, width: `${flightWidth}px` }} />
                  {matchWidth > 0 && <span className="segment-match" style={{ left: `${matchLeft}px`, width: `${matchWidth}px` }} />}
                  <b>{action.index + 1}</b>
                </button>
              );
            })}
          </div>
          <div className="tpt-director-event-track">
            {compiled.events.filter((event) => ['match.resolved', 'tray.warning', 'game.won', 'game.lost'].includes(event.event.type)).map((event) => (
              <i key={event.id} className={`event-${event.event.type.replace('.', '-')}`} style={{ left: `${event.frame * pixelsPerFrame}px` }} title={event.event.type} />
            ))}
          </div>
          <button
            type="button"
            className="tpt-director-playhead"
            style={{ left: `${currentFrame * pixelsPerFrame}px` } as CSSProperties}
            aria-label={`播放头第 ${currentFrame} 帧`}
          />
        </div>
      </div>
      <footer className="tpt-director-footer">
        <button onClick={() => onSeek(Math.max(0, currentFrame - 1))}>‹</button>
        <input data-director-seek type="range" min={0} max={compiled.totalFrames - 1} value={currentFrame} onChange={(event) => onSeek(Number(event.target.value))} />
        <button onClick={() => onSeek(Math.min(compiled.totalFrames - 1, currentFrame + 1))}>›</button>
        <output>{currentFrame} / {compiled.totalFrames - 1}</output>
        {selectedAction && (
          <div className="tpt-action-override" data-selected-director-action={selectedAction.actionId}>
            <span>动作 {selectedAction.index + 1}</span>
            <label>飞行帧<input type="number" min={1} max={120} value={actionOverrides[selectedAction.actionId]?.flightFrames ?? selectedAction.effectiveTiming.flightFrames} onChange={(event) => onTimingOverride(selectedAction.actionId, 'flightFrames', Number(event.target.value))} /></label>
            <button onClick={() => onResetOverride(selectedAction.actionId)}>重置覆盖</button>
          </div>
        )}
      </footer>
    </section>
  );
}
