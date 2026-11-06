import { GameRegistryError } from './errors';
import type { StudioProjectDocumentV2 } from './projectEnvelope';

export interface GameAuthoringResult {
  ok: boolean;
  report: Record<string, unknown>;
  document?: StudioProjectDocumentV2;
  recipe?: unknown;
  previewSvg?: string;
}

/** Game-owned authoring operations. CLI and future agents share this boundary. */
export interface GameAuthoringAdapter {
  gameId: string;
  catalog(base?: unknown): unknown;
  generate(recipe: unknown, base?: unknown): GameAuthoringResult;
  inspect(project: unknown): GameAuthoringResult;
  evaluate(project: unknown, options?: unknown): GameAuthoringResult;
  /** Optional independently callable stages; game-owned rules stay behind this adapter. */
  build?(recipe: unknown, base?: unknown): GameAuthoringResult;
  validate?(project: unknown, options?: unknown): GameAuthoringResult;
  assignMatching?(project: unknown, options?: unknown): GameAuthoringResult;
  validateTake?(project: unknown, options?: unknown): GameAuthoringResult;
  retime?(project: unknown, options?: unknown): GameAuthoringResult;
  /**
   * Moves stored asset bytes out of, or back into, the project document. Byte IO is
   * injected so the game package stays free of filesystem and network access, and the
   * caller decides where bytes live; a render never resolves references itself.
   */
  externalizeAssets?(project: unknown, write: AuthoringAssetWriter): Promise<GameAuthoringResult>;
  inlineAssets?(project: unknown, read: AuthoringAssetReader): Promise<GameAuthoringResult>;
}

/** Writes bytes somewhere local and returns the reference string to record. */
export type AuthoringAssetWriter = (suggestedName: string, sha256: string, bytes: Uint8Array) => Promise<string>;

/**
 * Where referenced bytes live. Declared structurally so the core protocol keeps no
 * dependency on the asset modules, but with the same literal union so a concrete
 * reader stays assignable.
 */
export type AuthoringAssetRefKind = 'attachment' | 'cas' | 'library';

/** Reads the bytes behind one parsed reference. Implementations are local-only by contract. */
export type AuthoringAssetReader = (
  ref: { kind: AuthoringAssetRefKind; locator: string; sha256?: string },
) => Promise<Uint8Array>;

export class GameAuthoringRegistry {
  private readonly adapters = new Map<string, GameAuthoringAdapter>();
  register(adapter: GameAuthoringAdapter): void {
    if (this.has(adapter.gameId)) throw new GameRegistryError('DUPLICATE_AUTHORING', `Authoring for ${adapter.gameId} is already registered.`);
    this.adapters.set(adapter.gameId, adapter);
  }
  has(gameId: string): boolean { return this.adapters.has(gameId); }
  unregister(gameId: string): void { this.adapters.delete(gameId); }
  require(gameId: string): GameAuthoringAdapter {
    const adapter = this.adapters.get(gameId);
    if (!adapter) throw new GameRegistryError('AUTHORING_UNAVAILABLE', `Authoring for ${gameId} is unavailable.`);
    return adapter;
  }
  list(): string[] { return [...this.adapters.keys()].sort(); }
}
