import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  AssetManifest,
  VariantLockMode,
  VariantRecipe,
} from '../headless/contracts';
import type { BrowserAssetMetadata, BrowserAssetStoreEstimate } from '../assets/browserAssetStore';
import {
  BROWSER_ASSET_IMPORT_OPTIONS,
  createBrowserAssetManifest,
  createBrowserAssetVariant,
  validateBrowserAssetFile,
  type BrowserAssetImportRole,
} from '../assets/browserAssetAuthoring';
import type { RuntimeAssetBindings } from '../assets/runtimeAssetBindings';
import {
  PROJECT_CURRENT_LOOK_KEY,
  createStudioAssetCatalog,
  parseImportedAssetBundle,
  styleForLookOption,
} from '../integration/studioAssetCatalog';
import {
  PROJECT_CURRENT_VARIANT_ID,
  createStudioVariantMatrix,
  parseImportedVariantRecipe,
  studioPreviewStyle,
  type StudioVariantRow,
} from '../integration/studioVariantBridge';
import type {
  CompiledTake,
  ProjectSpec,
  StudioMode,
  StyleSpec,
  Take,
} from '../domain/types';
import { downloadBlob, safeFileName } from '../utils/download';
import { useBrowserAssetStore, type BrowserAssetStoreStatus } from './useBrowserAssetStore';

const VARIANT_AUTOSAVE_KEY = 'block-creative-studio/variant-workspace/v1';

interface StoredVariantWorkspace {
  version: '1.0.0';
  selectedLookKey: string;
  lockMode: VariantLockMode;
  activeRecipeId: string;
  assets: AssetManifest[];
  recipes: VariantRecipe[];
}

export interface VariantWorkspacePanelModel {
  lockMode: VariantLockMode;
  selectedLookKey: string;
  activeRecipeId: string;
  lookOptions: ReturnType<typeof createStudioAssetCatalog>['lookOptions'];
  rows: StudioVariantRow[];
  importedAssetCount: number;
  importedRecipeCount: number;
  assetStoreStatus: BrowserAssetStoreStatus;
  storedAssets: BrowserAssetMetadata[];
  assetStoreEstimate: BrowserAssetStoreEstimate;
  runtimeAssetMissingCount: number;
  binaryImportOptions: typeof BROWSER_ASSET_IMPORT_OPTIONS;
  workspaceError: string | null;
  onLockMode(lockMode: VariantLockMode): void;
  onSelectLook(key: string): void;
  onSelectRecipe(id: string): void;
  onImportAssets(file: File): Promise<void>;
  onImportRecipe(file: File): Promise<void>;
  onImportBinary(file: File, role: BrowserAssetImportRole): Promise<void>;
  onDeleteBinary(contentHash: string): Promise<void>;
  onExportArtifact(
    kind: 'master' | 'recipe' | 'plan' | 'quality' | 'asset-bundle',
  ): void;
}

export interface UseVariantWorkspaceInput {
  project: ProjectSpec;
  selectedTake: Take | null;
  compiledTake: CompiledTake | null;
  mode: StudioMode;
  setProject: Dispatch<SetStateAction<ProjectSpec>>;
}

export interface VariantWorkspaceController {
  resolvedStyle: StyleSpec;
  activeRow: StudioVariantRow | null;
  runtimeAssets: RuntimeAssetBindings;
  runtimeReady: boolean;
  panel: VariantWorkspacePanelModel;
  resetToCurrentLook(): void;
}

function assetIdentity(asset: Pick<AssetManifest, 'id' | 'version'>): string {
  return `${asset.id}@${asset.version}`;
}

function cloneAssetManifest(asset: AssetManifest): AssetManifest {
  return structuredClone(asset);
}

function cloneVariantRecipe(recipe: VariantRecipe): VariantRecipe {
  return structuredClone(recipe);
}

function defaultVariantWorkspace(): StoredVariantWorkspace {
  return {
    version: '1.0.0',
    selectedLookKey: PROJECT_CURRENT_LOOK_KEY,
    lockMode: 'frame-exact',
    activeRecipeId: PROJECT_CURRENT_VARIANT_ID,
    assets: [],
    recipes: [],
  };
}

function loadVariantWorkspace(): StoredVariantWorkspace {
  if (typeof window === 'undefined') return defaultVariantWorkspace();
  try {
    const stored = window.localStorage.getItem(VARIANT_AUTOSAVE_KEY);
    if (!stored) return defaultVariantWorkspace();
    const source = JSON.parse(stored) as Partial<StoredVariantWorkspace>;
    const lockMode: VariantLockMode = source.lockMode === 'semantic' || source.lockMode === 'rule-only'
      ? source.lockMode
      : 'frame-exact';
    const assets = Array.isArray(source.assets)
      ? parseImportedAssetBundle(source.assets)
      : [];
    const recipes = Array.isArray(source.recipes)
      ? source.recipes.map((recipe) => parseImportedVariantRecipe(recipe))
      : [];
    return {
      version: '1.0.0',
      selectedLookKey: typeof source.selectedLookKey === 'string' && source.selectedLookKey
        ? source.selectedLookKey
        : PROJECT_CURRENT_LOOK_KEY,
      lockMode,
      activeRecipeId: typeof source.activeRecipeId === 'string' && source.activeRecipeId
        ? source.activeRecipeId
        : PROJECT_CURRENT_VARIANT_ID,
      assets,
      recipes,
    };
  } catch {
    window.localStorage.removeItem(VARIANT_AUTOSAVE_KEY);
    return defaultVariantWorkspace();
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function valueReferencesAssetKeys(value: unknown, assetKeys: Set<string>): boolean {
  if (Array.isArray(value)) return value.some((entry) => valueReferencesAssetKeys(entry, assetKeys));
  if (!isObject(value)) return false;
  if (
    typeof value.id === 'string'
    && typeof value.version === 'string'
    && assetKeys.has(`${value.id}@${value.version}`)
  ) return true;
  return Object.values(value).some((entry) => valueReferencesAssetKeys(entry, assetKeys));
}

function isBrowserDerivedLookFor(
  asset: AssetManifest,
  directKeys: Set<string>,
): boolean {
  if (asset.kind !== 'look-pack' || !isObject(asset.metadata)) return false;
  const derived = asset.metadata.browserDerivedLook;
  if (!isObject(derived) || !isObject(derived.replacementAsset)) return false;
  const replacement = derived.replacementAsset;
  return typeof replacement.id === 'string'
    && typeof replacement.version === 'string'
    && directKeys.has(`${replacement.id}@${replacement.version}`);
}

function mergeImportedAssets(
  current: AssetManifest[],
  incoming: AssetManifest[],
): AssetManifest[] {
  const merged = new Map(
    current.map((asset) => [assetIdentity(asset), cloneAssetManifest(asset)]),
  );
  for (const asset of incoming) {
    const key = assetIdentity(asset);
    const existing = merged.get(key);
    if (existing && existing.contentHash !== asset.contentHash) {
      throw new Error(`资产 ${key} 已存在，但内容 Hash 不一致。请提升 version 后再导入。`);
    }
    merged.set(key, cloneAssetManifest(asset));
  }
  return [...merged.values()].sort((left, right) =>
    assetIdentity(left).localeCompare(assetIdentity(right)),
  );
}

export function useVariantWorkspace({
  project,
  selectedTake,
  compiledTake,
  mode,
  setProject,
}: UseVariantWorkspaceInput): VariantWorkspaceController {
  const [initial] = useState(loadVariantWorkspace);
  const [variantLockMode, setVariantLockModeState] = useState(initial.lockMode);
  const [selectedLookKey, setSelectedLookKey] = useState(initial.selectedLookKey);
  const [activeRecipeId, setActiveRecipeId] = useState(initial.activeRecipeId);
  const [importedAssets, setImportedAssets] = useState<AssetManifest[]>(
    () => initial.assets.map(cloneAssetManifest),
  );
  const [importedRecipes, setImportedRecipes] = useState<VariantRecipe[]>(
    () => initial.recipes.map(cloneVariantRecipe),
  );
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const workspace: StoredVariantWorkspace = {
        version: '1.0.0',
        selectedLookKey,
        lockMode: variantLockMode,
        activeRecipeId,
        assets: importedAssets.map(cloneAssetManifest),
        recipes: importedRecipes.map(cloneVariantRecipe),
      };
      window.localStorage.setItem(VARIANT_AUTOSAVE_KEY, JSON.stringify(workspace));
    } catch {
      // Manifest-only workspace persistence is best-effort.
    }
  }, [activeRecipeId, importedAssets, importedRecipes, selectedLookKey, variantLockMode]);

  const builtinCatalog = useMemo(
    () => createStudioAssetCatalog(project),
    [project],
  );

  const compilation = useMemo(() => {
    try {
      return {
        matrix: createStudioVariantMatrix({
          project,
          selectedTake,
          compiledTake,
          requestedLockMode: variantLockMode,
          selectedLookKey,
          importedAssets,
          importedRecipes,
        }),
        error: null as string | null,
      };
    } catch (error) {
      return {
        matrix: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [
    compiledTake,
    importedAssets,
    importedRecipes,
    project,
    selectedLookKey,
    selectedTake,
    variantLockMode,
  ]);

  const matrix = compilation.matrix;
  const lookOptions = matrix?.catalog.lookOptions ?? builtinCatalog.lookOptions;
  const activeRow = matrix?.rows.find((row) => row.recipe.id === activeRecipeId)
    ?? matrix?.rows[0]
    ?? null;
  const browserAssets = useBrowserAssetStore(activeRow?.plan ?? null);
  const resolvedStyle = studioPreviewStyle(activeRow, project.style);

  useEffect(() => {
    if (lookOptions.some((option) => option.key === selectedLookKey)) return;
    setSelectedLookKey(PROJECT_CURRENT_LOOK_KEY);
    setActiveRecipeId(PROJECT_CURRENT_VARIANT_ID);
  }, [lookOptions, selectedLookKey]);

  useEffect(() => {
    if (activeRecipeId === PROJECT_CURRENT_VARIANT_ID) return;
    if (matrix?.rows.some((row) => row.recipe.id === activeRecipeId)) return;
    setActiveRecipeId(PROJECT_CURRENT_VARIANT_ID);
  }, [activeRecipeId, matrix]);

  const resetToCurrentLook = useCallback((): void => {
    setSelectedLookKey(PROJECT_CURRENT_LOOK_KEY);
    setActiveRecipeId(PROJECT_CURRENT_VARIANT_ID);
    setWorkspaceError(null);
  }, []);

  const selectLook = useCallback((key: string): void => {
    if (mode === 'play' || mode === 'render') return;
    const catalog = matrix?.catalog ?? builtinCatalog;
    const resolved = styleForLookOption(catalog, key, project.style);
    setSelectedLookKey(key);
    setActiveRecipeId(PROJECT_CURRENT_VARIANT_ID);
    if (resolved.previewSupported) {
      setProject((current) => ({ ...current, style: resolved.style }));
      setWorkspaceError(null);
    } else {
      setWorkspaceError(
        '该 Look Pack 没有完整 studio.style 预览绑定。若 Render Plan 含 tile.material，网页会切到固定机位三维预览并应用该 Plan 材质；Reference 2D 不消费 PBR MaterialRuntime。',
      );
    }
  }, [builtinCatalog, matrix, mode, project.style, setProject]);

  const selectRecipe = useCallback((recipeId: string): void => {
    if (mode === 'play' || mode === 'render') return;
    const row = matrix?.rows.find((candidate) => candidate.recipe.id === recipeId);
    if (!row) return;
    setActiveRecipeId(recipeId);
    setSelectedLookKey(`${row.recipe.lookPackRef.id}@${row.recipe.lookPackRef.version}`);
    setVariantLockModeState(row.recipe.lockMode);
    const preview = studioPreviewStyle(row, project.style);
    setProject((current) => ({ ...current, style: preview }));
    if (row.previewSupported) {
      setWorkspaceError(null);
    } else {
      setWorkspaceError(
        row.error
          ? `${row.error.code}: ${row.error.message}`
          : row.resolvedStyle.materialRuntime
            ? '该 Variant 的 Look 没有完整 studio.style 绑定。Plan 材质已交给固定机位三维预览；Reference 2D 不会绘制这些 PBR 贴图。'
            : '该 Variant 可以作为 Headless Artifact 使用，但当前网页预览没有对应的渲染绑定。',
      );
    }
  }, [matrix, mode, project.style, setProject]);

  const setLockMode = useCallback((lockMode: VariantLockMode): void => {
    if (mode === 'play' || mode === 'render') return;
    setVariantLockModeState(lockMode);
    setActiveRecipeId(PROJECT_CURRENT_VARIANT_ID);
    setWorkspaceError(null);
  }, [mode]);

  const importAssets = useCallback(async (file: File): Promise<void> => {
    if (mode === 'play' || mode === 'render') return;
    try {
      const assets = parseImportedAssetBundle(JSON.parse(await file.text()));
      setImportedAssets((current) => mergeImportedAssets(current, assets));
      setWorkspaceError(null);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, [mode]);

  const importRecipe = useCallback(async (file: File): Promise<void> => {
    if (mode === 'play' || mode === 'render') return;
    try {
      const recipe = parseImportedVariantRecipe(JSON.parse(await file.text()));
      setImportedRecipes((current) => [
        ...current.filter((candidate) => candidate.id !== recipe.id),
        cloneVariantRecipe(recipe),
      ]);
      setActiveRecipeId(recipe.id);
      setSelectedLookKey(`${recipe.lookPackRef.id}@${recipe.lookPackRef.version}`);
      setVariantLockModeState(recipe.lockMode);
      setWorkspaceError(null);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, [mode]);

  const importBinary = useCallback(async (
    file: File,
    role: BrowserAssetImportRole,
  ): Promise<void> => {
    if (mode === 'play' || mode === 'render') return;
    let storedHash: string | null = null;
    try {
      await validateBrowserAssetFile(file, role);
      const stored = await browserAssets.putFile(file);
      storedHash = stored.contentHash;
      const asset = createBrowserAssetManifest(stored, { role });
      setImportedAssets((current) => mergeImportedAssets(current, [asset]));

      if (!matrix?.master || !activeRow?.plan) {
        setWorkspaceError('文件已写入 Browser Asset Store；当前没有可用 Render Plan，因此尚未生成 Variant。');
        return;
      }
      if (!asset.runtime.renderers.includes(activeRow.plan.renderer)) {
        setWorkspaceError(
          `文件已存储并生成 ${asset.kind} Manifest，但当前 Renderer ${activeRow.plan.renderer} 不支持该资产。可交给外部 Renderer 或切换后端后再组装。`,
        );
        return;
      }

      const authored = createBrowserAssetVariant({
        plan: activeRow.plan,
        masterId: matrix.master.id,
        lockMode: activeRow.recipe.lockMode,
        seed: project.seed,
        asset,
        role,
      });
      setImportedAssets((current) => mergeImportedAssets(current, [authored.asset, authored.look]));
      setImportedRecipes((current) => [
        ...current.filter((candidate) => candidate.id !== authored.recipe.id),
        cloneVariantRecipe(authored.recipe),
      ]);
      setSelectedLookKey(`${authored.look.id}@${authored.look.version}`);
      setActiveRecipeId(authored.recipe.id);
      setVariantLockModeState(authored.recipe.lockMode);
      setWorkspaceError(
        authored.previewSupported
          ? null
          : '二进制资产和 Variant 已生成，但当前网页后端尚未实现该资产角色的预览 Pass。CLI 与未来 Renderer 可以继续消费。',
      );
    } catch (error) {
      if (storedHash) {
        // Preserve the content-addressed blob when authoring fails: another
        // manifest can still reference it later. The UI reports the failure.
      }
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, [activeRow, browserAssets, matrix, mode, project.seed]);

  const deleteBinary = useCallback(async (contentHash: string): Promise<void> => {
    if (mode === 'play' || mode === 'render') return;
    try {
      const direct = importedAssets.filter((asset) => asset.contentHash === contentHash);
      const directKeys = new Set(direct.map(assetIdentity));
      const derivedLooks = importedAssets.filter((asset) => isBrowserDerivedLookFor(asset, directKeys));
      const derivedLookKeys = new Set(derivedLooks.map(assetIdentity));
      const removableKeys = new Set([...directKeys, ...derivedLookKeys]);
      const blockingAssets = importedAssets.filter((asset) =>
        !removableKeys.has(assetIdentity(asset))
        && valueReferencesAssetKeys(asset, removableKeys),
      );
      const removedRecipeIds = new Set(
        importedRecipes
          .filter((recipe) => derivedLookKeys.has(assetIdentity(recipe.lookPackRef)))
          .map((recipe) => recipe.id),
      );
      const blockingRecipes = importedRecipes.filter((recipe) =>
        !removedRecipeIds.has(recipe.id)
        && valueReferencesAssetKeys(recipe, removableKeys),
      );
      if (blockingAssets.length > 0 || blockingRecipes.length > 0) {
        const blockers = [
          ...blockingAssets.map((asset) => assetIdentity(asset)),
          ...blockingRecipes.map((recipe) => recipe.id),
        ];
        throw new Error(
          `不能删除：该 Blob 仍被 ${blockers.slice(0, 5).join('、')}${blockers.length > 5 ? ` 等 ${blockers.length} 项` : ''} 引用。请先更新或删除这些 Manifest / Recipe。`,
        );
      }

      await browserAssets.deleteAsset(contentHash);
      setImportedAssets((current) => current.filter((asset) =>
        asset.contentHash !== contentHash && !derivedLookKeys.has(assetIdentity(asset)),
      ));
      setImportedRecipes((current) => current.filter((recipe) => !removedRecipeIds.has(recipe.id)));
      if (removedRecipeIds.has(activeRecipeId)) {
        setActiveRecipeId(PROJECT_CURRENT_VARIANT_ID);
        setSelectedLookKey(PROJECT_CURRENT_LOOK_KEY);
      }
      setWorkspaceError(null);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, [activeRecipeId, browserAssets, importedAssets, importedRecipes, mode]);

  const exportArtifact = useCallback((
    kind: 'master' | 'recipe' | 'plan' | 'quality' | 'asset-bundle',
  ): void => {
    const row = activeRow;
    let value: unknown;
    let suffix: string;
    switch (kind) {
      case 'master':
        value = matrix?.master;
        suffix = 'creative-master';
        break;
      case 'recipe':
        value = row?.recipe;
        suffix = 'variant-recipe';
        break;
      case 'plan':
        value = row?.plan;
        suffix = 'render-plan';
        break;
      case 'quality':
        value = row?.quality;
        suffix = 'quality-report';
        break;
      case 'asset-bundle':
        value = matrix ? {
          contract: 'bcs.asset-bundle',
          contractVersion: '1.0.0',
          assets: matrix.catalog.assets,
        } : null;
        suffix = 'asset-bundle';
        break;
    }
    if (!value) {
      setWorkspaceError(`当前没有可导出的 ${suffix}。`);
      return;
    }
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${safeFileName(project.name)}.${suffix}.json`);
    setWorkspaceError(null);
  }, [activeRow, matrix, project.name]);

  const runtimeMissingError = browserAssets.runtimeAssets.missing.length > 0
    ? `当前 Render Plan 引用了 ${browserAssets.runtimeAssets.missing.length} 个本机缺失或尚未适配的二进制资产。请重新导入对应文件，或切换到完整的 Look Pack。`
    : null;
  const effectiveError = workspaceError
    ?? compilation.error
    ?? activeRow?.error?.message
    ?? runtimeMissingError
    ?? (browserAssets.runtimeAssets.missing.length > 0 ? browserAssets.error : null)
    ?? null;

  return {
    resolvedStyle,
    activeRow,
    runtimeAssets: browserAssets.runtimeAssets,
    runtimeReady: browserAssets.runtimeReady,
    resetToCurrentLook,
    panel: {
      lockMode: variantLockMode,
      selectedLookKey,
      activeRecipeId,
      lookOptions,
      rows: matrix?.rows ?? [],
      importedAssetCount: importedAssets.length,
      importedRecipeCount: importedRecipes.length,
      assetStoreStatus: browserAssets.status,
      storedAssets: browserAssets.records,
      assetStoreEstimate: browserAssets.estimate,
      runtimeAssetMissingCount: browserAssets.runtimeAssets.missing.length,
      binaryImportOptions: BROWSER_ASSET_IMPORT_OPTIONS,
      workspaceError: effectiveError,
      onLockMode: setLockMode,
      onSelectLook: selectLook,
      onSelectRecipe: selectRecipe,
      onImportAssets: importAssets,
      onImportRecipe: importRecipe,
      onImportBinary: importBinary,
      onDeleteBinary: deleteBinary,
      onExportArtifact: exportArtifact,
    },
  };
}
