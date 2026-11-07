import type {
  CameraPresetId,
  CompiledTake,
  DiagnosticViewId,
  FxPresetId,
  GeometryPresetId,
  LightingPresetId,
  LookDevPresetId,
  MaterialPresetId,
  ProjectSpec,
  ReferenceAmbientFxId,
  ReferenceClearFxId,
  ReferenceFeedbackFxId,
  ReferencePreviewFxId,
  ReferenceTileFaceSetId,
  ReferenceTileMaterialId,
  RenderBackendId,
  RhythmPresetId,
  RhythmProfile,
  StyleSpec,
  Take,
} from '../domain/types';
import type { RenderProgress } from '../exporter/offlineVideoExporter';
import {
  CAMERA_OPTIONS,
  DIAGNOSTIC_VIEW_OPTIONS,
  FX_OPTIONS,
  GEOMETRY_DEFAULTS,
  GEOMETRY_OPTIONS,
  LIGHTING_OPTIONS,
  LOOKDEV_OPTIONS,
  MATERIAL_OPTIONS,
  REFERENCE_AMBIENT_OPTIONS,
  REFERENCE_CLEAR_OPTIONS,
  REFERENCE_FEEDBACK_OPTIONS,
  REFERENCE_PREVIEW_OPTIONS,
  REFERENCE_TILE_FACE_OPTIONS,
  REFERENCE_TILE_MATERIAL_OPTIONS,
  RENDERER_OPTIONS,
} from '../renderer/stylePresets';
import { RHYTHM_PRESET_LIST } from '../director/rhythmPresets';
import { copyLookDevPreset } from '../renderer/lookDev';
import { VariantWorkspacePanel, type VariantWorkspacePanelProps } from './VariantWorkspacePanel';
import type { MaterialRuntimeStatus } from '../renderer/materialRuntimeStatus';
import { IDLE_MATERIAL_RUNTIME_STATUS, materialRuntimeBlocksExport } from '../renderer/materialRuntimeStatus';
import { materialDescriptorKey } from '../headless/materialRuntime';

interface InspectorPanelProps {
  variantWorkspace: Omit<VariantWorkspacePanelProps, 'locked'>;
  style: StyleSpec;
  rhythm: RhythmProfile;
  render: ProjectSpec['render'];
  seed: number;
  take: Take | null;
  compiled: CompiledTake | null;
  locked: boolean;
  setupEditable: boolean;
  exportState: { running: boolean; progress: RenderProgress | null; error: string | null };
  materialRuntimeStatus?: MaterialRuntimeStatus;
  onStyle(patch: Partial<StyleSpec>): void;
  onGeometry(patch: Partial<StyleSpec['geometry']>): void;
  onRhythmPreset(id: RhythmPresetId): void;
  onRhythm(patch: Partial<RhythmProfile>): void;
  onSeed(seed: number): void;
  onRenderQuality(quality: ProjectSpec['render']['quality']): void;
  onExportVideo(): Promise<void>;
  onCancelExport(): void;
}

function SelectField<T extends string>({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string; description: string }>;
  disabled?: boolean;
  onChange(value: T): void;
}) {
  const active = options.find((option) => option.id === value);
  return (
    <label className="field-stack">
      <span>{label}</span>
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      {active && <small>{active.description}</small>}
    </label>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  disabled?: boolean;
  onChange(value: number): void;
}) {
  return (
    <label className="range-field">
      <span>{label}</span>
      <output>{value.toFixed(step < 0.1 ? 2 : 1)}{suffix}</output>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function InspectorPanel({
  variantWorkspace,
  style,
  rhythm,
  render,
  seed,
  take,
  compiled,
  locked,
  setupEditable,
  exportState,
  materialRuntimeStatus,
  onStyle,
  onGeometry,
  onRhythmPreset,
  onRhythm,
  onSeed,
  onRenderQuality,
  onExportVideo,
  onCancelExport,
}: InspectorPanelProps) {
  return (
    <aside className="panel inspector-panel">
      <VariantWorkspacePanel {...variantWorkspace} locked={locked} />
      <section>
        <div className="section-heading">
          <span>表现基线</span>
          <small>Renderer</small>
        </div>
        <SelectField<RenderBackendId>
          label="渲染模式"
          value={style.renderer}
          options={RENDERER_OPTIONS}
          disabled={locked}
          onChange={(renderer) => onStyle({ renderer })}
        />

        {style.renderer === 'reference-2d' ? (
          <>
            <SelectField<ReferenceTileMaterialId>
              label="方块材质"
              value={style.reference2d.tileMaterial}
              options={REFERENCE_TILE_MATERIAL_OPTIONS}
              disabled={locked}
              onChange={(tileMaterial) => onStyle({ reference2d: { ...style.reference2d, tileMaterial } })}
            />
            <SelectField<ReferenceTileFaceSetId>
              label="牌面纹样"
              value={style.reference2d.tileFaceSet}
              options={REFERENCE_TILE_FACE_OPTIONS}
              disabled={locked}
              onChange={(tileFaceSet) => onStyle({ reference2d: { ...style.reference2d, tileFaceSet } })}
            />
            <SelectField<ReferencePreviewFxId>
              label="预消除填充"
              value={style.reference2d.previewFx}
              options={REFERENCE_PREVIEW_OPTIONS}
              disabled={locked}
              onChange={(previewFx) => onStyle({ reference2d: { ...style.reference2d, previewFx } })}
            />
            <SelectField<ReferenceClearFxId>
              label="清除演出"
              value={style.reference2d.clearFx}
              options={REFERENCE_CLEAR_OPTIONS}
              disabled={locked}
              onChange={(clearFx) => onStyle({ reference2d: { ...style.reference2d, clearFx } })}
            />
            <SelectField<ReferenceFeedbackFxId>
              label="评价与连击"
              value={style.reference2d.feedbackFx}
              options={REFERENCE_FEEDBACK_OPTIONS}
              disabled={locked}
              onChange={(feedbackFx) => onStyle({ reference2d: { ...style.reference2d, feedbackFx } })}
            />
            <SelectField<ReferenceAmbientFxId>
              label="背景环境粒子"
              value={style.reference2d.ambientFx}
              options={REFERENCE_AMBIENT_OPTIONS}
              disabled={locked}
              onChange={(ambientFx) => onStyle({ reference2d: { ...style.reference2d, ambientFx } })}
            />
            <label className="field-stack">
              <span>历史最高分</span>
              <input
                type="number"
                min={0}
                max={2_147_483_647}
                value={style.reference2d.bestScore}
                disabled={locked}
                onChange={(event) => onStyle({
                  reference2d: {
                    ...style.reference2d,
                    bestScore: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                  },
                })}
              />
              <small>对应参考视频左上角皇冠数字，独立于本局实时得分。</small>
            </label>
            <label className="compact-field checkbox-field">
              <input type="checkbox" checked={style.showPointer} disabled={locked} onChange={(event) => onStyle({ showPointer: event.target.checked })} />
              <span>显示操作指针</span>
            </label>
          </>
        ) : (
          <>
            <SelectField<GeometryPresetId>
              label="彩块几何"
              value={style.geometry.id}
              options={GEOMETRY_OPTIONS}
              disabled={locked}
              onChange={(id) => onGeometry(GEOMETRY_DEFAULTS[id])}
            />
            <SelectField<MaterialPresetId>
              label="材质"
              value={style.material}
              options={MATERIAL_OPTIONS}
              disabled={locked}
              onChange={(material) => onStyle({ material })}
            />
            <SelectField<DiagnosticViewId>
              label="材质诊断"
              value={style.diagnosticView ?? 'beauty'}
              options={DIAGNOSTIC_VIEW_OPTIONS}
              disabled={locked}
              onChange={(diagnosticView) => onStyle({ diagnosticView })}
            />
            <div className="inline-ranges">
              <RangeField label="厚度" value={style.geometry.depth} min={0.18} max={0.72} step={0.01} disabled={locked} onChange={(depth) => onGeometry({ depth })} />
              <RangeField label="倒角" value={style.geometry.bevel} min={0.04} max={0.24} step={0.01} disabled={locked} onChange={(bevel) => onGeometry({ bevel })} />
              <RangeField label="间隙" value={style.geometry.gap} min={0.04} max={0.18} step={0.01} disabled={locked} onChange={(gap) => onGeometry({ gap })} />
            </div>
            <SelectField<LookDevPresetId>
              label="高光与后处理"
              value={style.lookDev.id}
              options={LOOKDEV_OPTIONS}
              disabled={locked}
              onChange={(id) => onStyle({
                lookDev: copyLookDevPreset(id),
                ...(id === 'neutral-lookdev'
                  ? { lighting: 'neutral-lookdev' as LightingPresetId }
                  : style.lighting === 'neutral-lookdev'
                    ? { lighting: id === 'high-energy' ? 'neon-contrast' : 'clean-studio' }
                    : {}),
              })}
            />
            <div className="lookdev-status-card">
              <strong>{style.lookDev.id === 'neutral-lookdev' ? '材质校准模式' : style.lookDev.id === 'high-energy' ? '高能量演出' : '平衡影视模式'}</strong>
              <span>
                {style.lookDev.id === 'neutral-lookdev'
                  ? 'Bloom 已关闭；先检查材质、颜色、粗糙度与接触阴影。'
                  : '普通镜面高光保持克制，清除峰值通过独立 Bloom Boost 增强。'}
              </span>
            </div>
            <div className="inline-ranges lookdev-ranges">
              <RangeField
                label="曝光"
                value={style.lookDev.exposure}
                min={0.5}
                max={1.3}
                step={0.01}
                suffix="×"
                disabled={locked}
                onChange={(exposure) => onStyle({ lookDev: { ...style.lookDev, exposure } })}
              />
              <RangeField
                label="环境反射"
                value={style.lookDev.environmentIntensity}
                min={0}
                max={1.5}
                step={0.01}
                suffix="×"
                disabled={locked}
                onChange={(environmentIntensity) => onStyle({ lookDev: { ...style.lookDev, environmentIntensity } })}
              />
              <RangeField
                label="基础 Bloom"
                value={style.lookDev.bloomStrength}
                min={0}
                max={0.7}
                step={0.01}
                disabled={locked}
                onChange={(bloomStrength) => onStyle({ lookDev: { ...style.lookDev, bloomStrength } })}
              />
              <RangeField
                label="Bloom 阈值"
                value={style.lookDev.bloomThreshold}
                min={0.5}
                max={1.5}
                step={0.01}
                disabled={locked}
                onChange={(bloomThreshold) => onStyle({ lookDev: { ...style.lookDev, bloomThreshold } })}
              />
              <RangeField
                label="清除 Bloom"
                value={style.lookDev.clearBloomBoost}
                min={0}
                max={0.8}
                step={0.01}
                disabled={locked}
                onChange={(clearBloomBoost) => onStyle({ lookDev: { ...style.lookDev, clearBloomBoost } })}
              />
            </div>
            <SelectField<LightingPresetId>
              label="灯光"
              value={style.lighting}
              options={LIGHTING_OPTIONS}
              disabled={locked}
              onChange={(lighting) => onStyle({ lighting })}
            />
            <SelectField<CameraPresetId>
              label="摄像机"
              value={style.camera}
              options={CAMERA_OPTIONS}
              disabled={locked}
              onChange={(camera) => onStyle({ camera })}
            />
            <SelectField<FxPresetId>
              label="3D 清除特效"
              value={style.fx}
              options={FX_OPTIONS}
              disabled={locked}
              onChange={(fx) => onStyle({ fx })}
            />
            <div className="two-column-field">
              <label className="compact-field">
                <span>背景</span>
                <input type="color" value={style.background} disabled={locked} onChange={(event) => onStyle({ background: event.target.value })} />
              </label>
              <label className="compact-field checkbox-field">
                <input type="checkbox" checked={style.showPointer} disabled={locked} onChange={(event) => onStyle({ showPointer: event.target.checked })} />
                <span>显示指针</span>
              </label>
            </div>
          </>
        )}
      </section>

      <section>
        <div className="section-heading">
          <span>导演节奏</span>
          <small>Rhythm</small>
        </div>
        <SelectField<RhythmPresetId>
          label="节奏模板"
          value={rhythm.id}
          options={RHYTHM_PRESET_LIST}
          disabled={locked}
          onChange={onRhythmPreset}
        />
        <RangeField
          label="全局速度"
          value={rhythm.globalSpeed}
          min={0.72}
          max={1.5}
          step={0.01}
          suffix="×"
          disabled={locked}
          onChange={(globalSpeed) => onRhythm({ globalSpeed })}
        />
        <RangeField
          label="拖拽时长"
          value={rhythm.dragFrames}
          min={8}
          max={36}
          step={1}
          suffix="f"
          disabled={locked}
          onChange={(dragFrames) => onRhythm({ dragFrames })}
        />
        <RangeField
          label="动作间隔"
          value={rhythm.betweenActionFrames}
          min={2}
          max={30}
          step={1}
          suffix="f"
          disabled={locked}
          onChange={(betweenActionFrames) => onRhythm({ betweenActionFrames })}
        />
        <RangeField
          label="清除时长"
          value={rhythm.clearDurationFrames}
          min={7}
          max={34}
          step={1}
          suffix="f"
          disabled={locked}
          onChange={(clearDurationFrames) => onRhythm({ clearDurationFrames })}
        />
      </section>

      <section>
        <div className="section-heading">
          <span>确定性</span>
          <small>Seed</small>
        </div>
        <label className="field-stack">
          <span>局面随机种子</span>
          <input
            type="number"
            min={0}
            max={2_147_483_647}
            step={1}
            value={seed}
            disabled={!setupEditable}
            onChange={(event) => onSeed(Number(event.target.value))}
          />
          <small>改变 Seed 会清空旧 Take，保证候选刷新与特效随机可复现。</small>
        </label>
      </section>

      <section className="export-section">
        <div className="section-heading">
          <span>高画质导出</span>
          <small>Chrome offline</small>
        </div>
        <label className="field-stack">
          <span>质量档</span>
          <select disabled={locked} value={render.quality} onChange={(event) => onRenderQuality(event.target.value as ProjectSpec['render']['quality'])}>
            <option value="preview">快速预览 · 8 Mbps</option>
            <option value="standard">标准成片 · 14 Mbps</option>
            <option value="cinematic">电影档 · 24 Mbps</option>
          </select>
        </label>
        <div className="render-summary">
          <div><strong>{render.width}×{render.height}</strong><span>分辨率</span></div>
          <div><strong>{render.fps} fps</strong><span>固定帧率</span></div>
          <div><strong>{compiled ? (compiled.totalFrames / compiled.fps).toFixed(1) : '—'} s</strong><span>成片时长</span></div>
        </div>
        {style.renderer !== 'reference-2d' && materialRuntimeStatus && (
          <p className={materialRuntimeStatus.state === 'ready' ? 'empty-copy' : 'error-copy'}>
            {materialRuntimeStatus.state === 'ready' && '三维材质已提交，可进入正式导出。'}
            {materialRuntimeStatus.state === 'loading' && '材质加载中，正式导出已阻止。'}
            {materialRuntimeStatus.state === 'stale' && '新材质尚未提交，当前仍显示上一套材质。正式导出已阻止。'}
            {materialRuntimeStatus.state === 'error' && `新材质加载失败${materialRuntimeStatus.showingPrevious ? '，当前仍显示上一套材质' : ''}。正式导出已阻止。`}
            {materialRuntimeStatus.state === 'idle' && '三维材质尚未完成首次提交。正式导出已阻止。'}
          </p>
        )}
        {exportState.running ? (
          <button className="export-button export-button--cancel" onClick={onCancelExport}>
            取消本次渲染
          </button>
        ) : (
          <button
            className="export-button"
            disabled={!take || locked || (style.renderer !== 'reference-2d' && materialRuntimeBlocksExport(
              materialRuntimeStatus ?? IDLE_MATERIAL_RUNTIME_STATUS,
              { descriptorKey: style.materialRuntime ? materialDescriptorKey(style.materialRuntime) : '' },
            ))}
            onClick={() => void onExportVideo()}
          >
            生成 1080P MP4
          </button>
        )}
        {exportState.progress && (
          <div className="export-progress">
            <div><span style={{ width: `${exportState.progress.ratio * 100}%` }} /></div>
            <p>{exportState.progress.message}</p>
          </div>
        )}
        {exportState.error && <p className="error-copy">{exportState.error}</p>}
        {!take && <p className="empty-copy">先保存一次人类或机器试玩 Take。</p>}
      </section>
    </aside>
  );
}
