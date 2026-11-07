import type {
  AssetManifestEntry,
  BodyStyle,
  FaceAssembly,
  FaceAssemblyMode,
  FacePartTransform,
  StageAssemblyLayer,
  TapTilePresentationRole,
  ThemeVariant,
  TileArchetype,
} from '../project';
import type { TileMaterialId } from '../stackModel';

export interface ResolvedAsset {
  entry: AssetManifestEntry;
  uri?: string;
  persistence: 'builtin' | 'indexeddb';
}

export type ResolvedFaceSource =
  | { kind: 'glyph'; value: string }
  | { kind: 'image'; assetId: string; asset: ResolvedAsset };

export interface RenderedFacePart {
  id: string;
  source: ResolvedFaceSource;
  transform: FacePartTransform;
  repeatIndex: number;
}

export interface RenderedFaceAssembly {
  id: string;
  mode: FaceAssemblyMode;
  showBody: boolean;
  fit: 'contain-safe-area' | 'cover-front' | 'composed';
  parts: RenderedFacePart[];
}

export interface ResolvedTileVisual {
  archetype: TileArchetype;
  theme: ThemeVariant;
  material: TileMaterialId;
  role: TapTilePresentationRole;
  faceAssembly: FaceAssembly;
  renderedFace: RenderedFaceAssembly;
  bodyStyle: BodyStyle;
  bodyAsset?: ResolvedAsset;
  identityHash: string;
  roleScale: number;
}

export type SkinCompatibilitySeverity = 'error' | 'warning' | 'info';

export interface SkinCompatibilityIssue {
  code: string;
  severity: SkinCompatibilitySeverity;
  message: string;
  themeId: string;
  archetypeId?: string;
  faceAssemblyId?: string;
  partId?: string;
}

export interface SkinCompatibilityReport {
  valid: boolean;
  themeId: string;
  coveredArchetypeIds: string[];
  issues: SkinCompatibilityIssue[];
}

export interface ResolvedStageLayer extends StageAssemblyLayer {
  asset?: ResolvedAsset;
}

export interface ResolvedStageAssembly {
  id: string;
  layers: ResolvedStageLayer[];
}
