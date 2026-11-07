import { AssetPanel } from './components/AssetPanel';
import { InspectorPanel } from './components/InspectorPanel';
import { StatusBar } from './components/StatusBar';
import { Timeline } from './components/Timeline';
import { Toolbar } from './components/Toolbar';
import type { GridCell } from './domain/types';
import { Reference2DViewport } from './reference2d/Reference2DViewport';
import { ThreeViewport } from './renderer/ThreeViewport';
import { useStudioModel } from './state/useStudioModel';

export function BlockCreativeWorkspace({ onOpenTapTile }: { onOpenTapTile(): void }) {
  const studio = useStudioModel();
  const displayStyle = studio.resolvedStyle;
  const displaySnapshot =
    (studio.mode === 'replay' || studio.mode === 'render') && studio.presentationFrame
      ? studio.presentationFrame.snapshot
      : studio.liveSnapshot;

  const placementValid = (pieceId: string, anchor: GridCell): boolean => {
    const piece = studio.liveSnapshot.pieces.find((candidate) => candidate.id === pieceId);
    return piece ? studio.isPlacementValid(piece, anchor) : false;
  };

  return (
    <div className="studio-app">
      <button
        type="button"
        onClick={onOpenTapTile}
        style={{
          position: 'fixed', zIndex: 9999, right: 18, top: 72,
          border: '1px solid rgba(255,255,255,.18)', borderRadius: 10,
          padding: '9px 13px', color: 'white', background: '#5963e9',
          boxShadow: '0 8px 24px rgba(0,0,0,.3)', cursor: 'pointer',
        }}
      >
        打开 TapTile 堆叠编辑器
      </button>
      <Toolbar
        projectName={studio.project.name}
        mode={studio.mode}
        hasTake={studio.takes.length > 0}
        onProjectName={studio.updateProjectName}
        onEdit={studio.enterEdit}
        onPlay={studio.beginHumanPlay}
        onReplay={studio.enterReplay}
        onAgent={studio.runAgent}
        onExportProject={studio.exportProject}
        onImportProject={studio.importProject}
      />

      <main className="studio-workspace">
        <AssetPanel
          boardPresets={studio.boardPresets}
          pieces={studio.project.setupPieces}
          takes={studio.takes}
          setupEditable={studio.mode === 'edit'}
          takesLocked={studio.mode === 'play' || studio.mode === 'render'}
          selectedTakeId={studio.selectedTake?.id ?? null}
          selectedColor={studio.selectedColor}
          selectedPieceSlot={studio.selectedPieceSlot}
          onBoardPreset={(id) => studio.applyBoardPreset(id as (typeof studio.boardPresets)[number]['id'])}
          onColor={studio.setSelectedColor}
          onPieceSlot={studio.setSelectedPieceSlot}
          onPieceShape={studio.updatePieceShape}
          onPieceColor={studio.updatePieceColor}
          onPieceCellColor={studio.updatePieceCellColor}
          onSelectTake={studio.selectTake}
          onDeleteTake={studio.deleteTake}
        />

        <section className="stage-column">
          <div className="stage-header">
            <div>
              <span className="eyebrow">REFERENCE-FIRST CREATIVE CANVAS</span>
              <h1>{studio.mode === 'edit' ? '拆解并设计 2D 牌面' : studio.mode === 'play' ? '录制真人试玩' : '导演与固定帧重放'}</h1>
            </div>
            <div className="stage-metrics">
              <span><strong>8×8</strong>棋盘</span>
              <span><strong>{studio.liveSnapshot.pieces.filter((piece) => !piece.used).length}</strong>候选块</span>
              <span><strong>{studio.selectedTake?.actions.length ?? 0}</strong>动作</span>
            </div>
          </div>

          <div className="stage-frame">
            <div className="phone-frame">
              {displayStyle.renderer === 'reference-2d' ? (
                <Reference2DViewport
                  mode={studio.mode}
                  snapshot={studio.liveSnapshot}
                  frame={studio.presentationFrame}
                  style={displayStyle}
                  runtimeAssets={studio.runtimeAssets}
                  fps={studio.project.render.fps}
                  clearSignal={studio.clearSignal}
                  onEditCell={studio.editBoardCell}
                  onPlace={studio.commitHumanPlacement}
                  isPlacementValid={placementValid}
                />
              ) : (
                <ThreeViewport
                  mode={studio.mode}
                  snapshot={studio.liveSnapshot}
                  frame={studio.presentationFrame}
                  style={displayStyle}
                  runtimeAssets={studio.runtimeAssets}
                  fps={studio.project.render.fps}
                  clearSignal={studio.clearSignal}
                  onEditCell={studio.editBoardCell}
                  onPlace={studio.commitHumanPlacement}
                  isPlacementValid={placementValid}
                />
              )}
            </div>

            {studio.mode === 'play' && (
              <div className="play-session-bar">
                <div>
                  <span className="recording-dot" />
                  <strong>正在记录 Replay</strong>
                  <span>只保存动作、轨迹、状态与 Seed</span>
                </div>
                <div>
                  <button className="button-secondary" onClick={studio.undoHumanPlacement} disabled={studio.recordedActionCount === 0}>撤回一步</button>
                  <button className="button-secondary" onClick={studio.cancelHumanPlay}>取消</button>
                  <button className="button-primary" onClick={studio.finishHumanTake}>结束并保存 Take</button>
                </div>
              </div>
            )}

            {studio.mode === 'edit' && (
              <div className="stage-callout">
                <strong>先造局，再试玩。</strong>
                <span>左侧选择颜色、形状与候选块；点击棋盘绘制或擦除。</span>
              </div>
            )}
          </div>
        </section>

        <InspectorPanel
          variantWorkspace={studio.variantWorkspace}
          style={displayStyle}
          rhythm={studio.project.rhythm}
          render={studio.project.render}
          seed={studio.project.seed}
          take={studio.selectedTake}
          compiled={studio.compiledTake}
          locked={studio.mode === 'play' || studio.mode === 'render'}
          setupEditable={studio.mode === 'edit'}
          exportState={studio.exportState}
          onStyle={studio.setStyle}
          onGeometry={studio.setGeometry}
          onRhythmPreset={studio.setRhythmPreset}
          onRhythm={studio.setRhythm}
          onSeed={studio.updateProjectSeed}
          onRenderQuality={studio.updateRenderQuality}
          onExportVideo={studio.exportVideo}
          onCancelExport={studio.cancelExport}
        />
      </main>

      <Timeline
        compiled={studio.compiledTake}
        frame={studio.playbackFrame}
        playing={studio.isPlaying}
        locked={studio.mode === 'play' || studio.mode === 'render'}
        onFrame={studio.setPlaybackFrame}
        onToggle={studio.togglePlayback}
      />
      <StatusBar mode={studio.mode} snapshot={displaySnapshot} />
    </div>
  );
}
