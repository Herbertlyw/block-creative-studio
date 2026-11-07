import { useState } from 'react';
import type {
  AssetManifest,
  QualityReport,
  ResolvedRenderPlan,
  VariantLockMode,
  VariantRecipe,
} from '../headless/contracts';
import type { StudioLookOption } from '../integration/studioAssetCatalog';
import { variantRowPreviewKind, type StudioVariantRow } from '../integration/studioVariantBridge';
import type { BrowserAssetImportRole } from '../assets/browserAssetAuthoring';
import type { BrowserAssetStoreStatus } from '../state/useBrowserAssetStore';
import type { MaterialRuntimeStatus } from '../renderer/materialRuntimeStatus';

type VariantExportKind = 'master' | 'recipe' | 'plan' | 'quality' | 'asset-bundle';

export interface VariantWorkspacePanelProps {
  lockMode: VariantLockMode;
  selectedLookKey: string;
  activeRecipeId: string;
  lookOptions: StudioLookOption[];
  rows: StudioVariantRow[];
  importedAssetCount: number;
  importedRecipeCount: number;
  assetStoreStatus: BrowserAssetStoreStatus;
  storedAssets: Array<{
    contentHash: string;
    fileName: string;
    mimeType: string;
    byteLength: number;
    mediaClass: string;
    width?: number;
    height?: number;
  }>;
  assetStoreEstimate: {
    assetCount: number;
    storedBytes: number;
    quotaBytes?: number;
    usageBytes?: number;
  };
  runtimeAssetMissingCount: number;
  binaryImportOptions: Array<{
    id: BrowserAssetImportRole;
    label: string;
    description: string;
    accept: string;
  }>;
  workspaceError: string | null;
  materialRuntimeStatus?: MaterialRuntimeStatus;
  locked: boolean;
  onLockMode(lockMode: VariantLockMode): void;
  onSelectLook(key: string): void;
  onSelectRecipe(id: string): void;
  onImportAssets(file: File): Promise<void>;
  onImportRecipe(file: File): Promise<void>;
  onImportBinary(file: File, role: BrowserAssetImportRole): Promise<void>;
  onDeleteBinary(contentHash: string): Promise<void>;
  onExportArtifact(kind: VariantExportKind): void;
}

function activeStatus(
  row: StudioVariantRow | undefined,
  runtimeAssetMissingCount = 0,
  materialRuntimeStatus?: MaterialRuntimeStatus,
): {
  label: string;
  tone: 'success' | 'warning' | 'error';
  detail: string;
} {
  if (!row) {
    return { label: '未编译', tone: 'error', detail: '没有可用的变体配方。' };
  }
  if (row.error) {
    return {
      label: '编译失败',
      tone: 'error',
      detail: `${row.error.code} · ${row.error.message}`,
    };
  }
  if (!row.quality?.passed) {
    const first = row.quality?.issues.find((issue) => issue.severity === 'error');
    return {
      label: '门禁未通过',
      tone: 'error',
      detail: first ? `${first.code} · ${first.message}` : '质量门禁返回失败。',
    };
  }
  if (variantRowPreviewKind(row) === 'artifact-only') {
    return {
      label: '可编译',
      tone: 'warning',
      detail: '资产契约有效，但当前网页渲染器没有该 Look 的预览绑定，也没有可应用的 Plan 材质。',
    };
  }
  if (runtimeAssetMissingCount > 0) {
    return {
      label: '运行资产缺失',
      tone: 'error',
      detail: `Render Plan 中有 ${runtimeAssetMissingCount} 个二进制资产尚未在本机 Asset Store 中解析。`,
    };
  }
  if (materialRuntimeStatus) {
    if (materialRuntimeStatus.state === 'idle') {
      return {
        label: '材质未就绪',
        tone: 'warning',
        detail: '三维材质尚未完成首次提交，不能作为可渲染/可导出状态。',
      };
    }
    if (materialRuntimeStatus.state === 'error') {
      return {
        label: '材质加载失败',
        tone: 'error',
        detail: `新材质加载失败。${materialRuntimeStatus.showingPrevious ? '当前仍显示上一套完整材质。' : ''}不能作为可渲染/可导出状态。${materialRuntimeStatus.error ?? ''}`,
      };
    }
    if (materialRuntimeStatus.state === 'stale' || materialRuntimeStatus.state === 'loading') {
      return {
        label: materialRuntimeStatus.showingPrevious ? '材质陈旧' : '材质加载中',
        tone: 'warning',
        detail: materialRuntimeStatus.showingPrevious
          ? '新材质尚未提交，当前仍显示上一套完整材质，正式导出已阻止。'
          : 'PBR 贴图仍在加载，正式导出已阻止。',
      };
    }
  }
  return {
    label: '可渲染',
    tone: 'success',
    detail: variantRowPreviewKind(row) === 'plan-material'
      ? 'Plan 材质已交给当前三维预览；该 Look 没有完整 studio.style 绑定。'
      : '网页预览、CLI 编译和质量门禁使用同一份 Render Plan。',
  };
}

function shortHash(value: string | undefined): string {
  if (!value) return '—';
  return value.length > 20 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

function downloadLabel(kind: VariantExportKind): string {
  switch (kind) {
    case 'master': return 'Master';
    case 'recipe': return 'Recipe';
    case 'plan': return 'Plan';
    case 'quality': return 'Report';
    case 'asset-bundle': return 'Assets';
  }
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function assetStoreLabel(status: BrowserAssetStoreStatus): string {
  switch (status) {
    case 'opening': return '初始化中';
    case 'ready': return 'IndexedDB 已就绪';
    case 'unavailable': return '浏览器不支持';
    case 'error': return '存储错误';
  }
}

export function VariantWorkspacePanel({
  lockMode,
  selectedLookKey,
  activeRecipeId,
  lookOptions,
  rows,
  importedAssetCount,
  importedRecipeCount,
  assetStoreStatus,
  storedAssets,
  assetStoreEstimate,
  runtimeAssetMissingCount,
  binaryImportOptions,
  workspaceError,
  materialRuntimeStatus,
  locked,
  onLockMode,
  onSelectLook,
  onSelectRecipe,
  onImportAssets,
  onImportRecipe,
  onImportBinary,
  onDeleteBinary,
  onExportArtifact,
}: VariantWorkspacePanelProps) {
  const [binaryRole, setBinaryRole] = useState<BrowserAssetImportRole>('background-image');
  const active = rows.find((row) => row.recipe.id === activeRecipeId) ?? rows[0];
  const status = activeStatus(active, runtimeAssetMissingCount, materialRuntimeStatus);
  const selectedBinaryOption = binaryImportOptions.find((option) => option.id === binaryRole)
    ?? binaryImportOptions[0];
  const plan = active?.plan;
  const report = active?.quality;

  return (
    <section className="variant-workspace-section">
      <div className="section-heading">
        <span>变体编译</span>
        <small>Headless Core</small>
      </div>

      <div className={`variant-status-card is-${status.tone}`}>
        <div>
          <span className="variant-status-dot" />
          <strong>{status.label}</strong>
        </div>
        <p>{status.detail}</p>
      </div>

      {workspaceError && <p className="variant-workspace-error">{workspaceError}</p>}

      <label className="field-stack">
        <span>Look Pack</span>
        <select
          value={selectedLookKey}
          disabled={locked}
          onChange={(event) => onSelectLook(event.target.value)}
        >
          {lookOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}{option.origin !== 'builtin' && option.origin !== 'project' ? ` · ${option.origin}` : ''}
            </option>
          ))}
        </select>
        <small>
          {lookOptions.find((option) => option.key === selectedLookKey)?.description
            ?? 'Look Pack 将背景、棋盘、材质、清除与反馈组织为可覆盖的原子槽。'}
        </small>
      </label>

      <label className="field-stack">
        <span>不变量锁定</span>
        <select
          value={lockMode}
          disabled={locked || activeRecipeId !== 'project.current.variant'}
          onChange={(event) => onLockMode(event.target.value as VariantLockMode)}
        >
          <option value="frame-exact">Frame-exact · 帧位完全锁定</option>
          <option value="semantic">Semantic · 玩法事件锁定</option>
          <option value="rule-only">Rule-only · 仅规则锁定</option>
        </select>
        <small>严格换皮使用 Frame-exact；调整节奏时使用 Semantic。</small>
      </label>

      {rows.length > 1 && (
        <div className="variant-matrix-list">
          <div className="variant-matrix-title">
            <span>Variant Matrix</span>
            <small>{rows.length} 条配方</small>
          </div>
          {rows.map((row) => {
            const rowStatus = activeStatus(row);
            return (
              <button
                key={row.recipe.id}
                type="button"
                className={`variant-matrix-row ${row.recipe.id === activeRecipeId ? 'is-active' : ''}`}
                onClick={() => onSelectRecipe(row.recipe.id)}
                disabled={locked}
              >
                <span className={`variant-row-dot is-${rowStatus.tone}`} />
                <span>
                  <strong>{row.recipe.id}</strong>
                  <small>{row.recipe.lockMode} · {row.plan?.renderer ?? 'compile error'}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="variant-plan-summary">
        <div>
          <span>Plan Hash</span>
          <strong title={plan?.planHash}>{shortHash(plan?.planHash)}</strong>
        </div>
        <div>
          <span>Renderer</span>
          <strong>{plan?.renderer ?? '—'}</strong>
        </div>
        <div>
          <span>资产</span>
          <strong>{report?.metrics.assetCount ?? '—'}</strong>
        </div>
        <div>
          <span>预算</span>
          <strong>{report ? `${report.metrics.textureMemoryMiB} MiB` : '—'}</strong>
        </div>
      </div>

      {report && report.issues.length > 0 && (
        <div className="quality-issue-list">
          {report.issues.slice(0, 3).map((issue, index) => (
            <div key={`${issue.code}-${index}`} className={`quality-issue is-${issue.severity}`}>
              <strong>{issue.code}</strong>
              <span>{issue.message}</span>
            </div>
          ))}
          {report.issues.length > 3 && <small>另有 {report.issues.length - 3} 项，导出 Report 查看完整结果。</small>}
        </div>
      )}

      <div className="browser-asset-store">
        <div className="browser-asset-store__heading">
          <div>
            <strong>本地二进制资产</strong>
            <span>{assetStoreLabel(assetStoreStatus)}</span>
          </div>
          <small>{assetStoreEstimate.assetCount} 个 · {formatBytes(assetStoreEstimate.storedBytes)}</small>
        </div>

        <label className="field-stack browser-asset-role">
          <span>导入目标</span>
          <select
            value={binaryRole}
            disabled={locked || assetStoreStatus !== 'ready'}
            onChange={(event) => setBinaryRole(event.target.value as BrowserAssetImportRole)}
          >
            {binaryImportOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          <small>{selectedBinaryOption?.description}</small>
        </label>

        <label className={`file-button browser-asset-upload ${locked || assetStoreStatus !== 'ready' ? 'is-disabled' : ''}`}>
          上传并生成 Variant
          <input
            type="file"
            accept={selectedBinaryOption?.accept}
            disabled={locked || assetStoreStatus !== 'ready' || !selectedBinaryOption}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = '';
              if (file && selectedBinaryOption) void onImportBinary(file, selectedBinaryOption.id);
            }}
          />
        </label>

        {assetStoreEstimate.quotaBytes !== undefined && (
          <div className="browser-asset-quota">
            <span style={{ width: `${Math.min(100, ((assetStoreEstimate.usageBytes ?? assetStoreEstimate.storedBytes) / Math.max(1, assetStoreEstimate.quotaBytes)) * 100)}%` }} />
          </div>
        )}

        {storedAssets.length > 0 ? (
          <div className="browser-asset-list">
            {storedAssets.slice(0, 8).map((asset) => (
              <div key={asset.contentHash} className="browser-asset-row">
                <span className={`browser-asset-kind is-${asset.mediaClass}`}>{asset.mediaClass}</span>
                <span className="browser-asset-copy">
                  <strong title={asset.fileName}>{asset.fileName}</strong>
                  <small>
                    {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}
                    {formatBytes(asset.byteLength)} · {shortHash(asset.contentHash)}
                  </small>
                </span>
                <button
                  type="button"
                  className="browser-asset-delete"
                  disabled={locked}
                  aria-label={`删除 ${asset.fileName}`}
                  onClick={() => void onDeleteBinary(asset.contentHash)}
                >
                  ×
                </button>
              </div>
            ))}
            {storedAssets.length > 8 && <small>另有 {storedAssets.length - 8} 个资产未展开。</small>}
          </div>
        ) : (
          <p className="variant-import-count">图片、纹理、GLB、Flipbook 与音频会按 SHA-256 存入本机 IndexedDB。</p>
        )}
      </div>

      <div className="variant-file-actions">
        <label className={`file-button variant-file-button ${locked ? 'is-disabled' : ''}`}>
          导入资产清单
          <input
            type="file"
            accept=".json,application/json"
            disabled={locked}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = '';
              if (file) void onImportAssets(file);
            }}
          />
        </label>
        <label className={`file-button variant-file-button ${locked ? 'is-disabled' : ''}`}>
          导入 Variant
          <input
            type="file"
            accept=".json,application/json"
            disabled={locked}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = '';
              if (file) void onImportRecipe(file);
            }}
          />
        </label>
      </div>
      <p className="variant-import-count">
        已导入 {importedAssetCount} 个外部资产、{importedRecipeCount} 条外部配方。只保存 Manifest，不执行任意代码。
      </p>

      <div className="variant-export-actions">
        {(['master', 'recipe', 'plan', 'quality', 'asset-bundle'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className="button-secondary"
            disabled={
              (kind === 'plan' && !plan)
              || (kind === 'quality' && !report)
              || (kind === 'recipe' && !active)
            }
            onClick={() => onExportArtifact(kind)}
          >
            {downloadLabel(kind)}
          </button>
        ))}
      </div>
    </section>
  );
}

export type VariantWorkspaceExportArtifact =
  | AssetManifest[]
  | VariantRecipe
  | ResolvedRenderPlan
  | QualityReport;
