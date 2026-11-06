import type { StudioProjectDocumentV2 } from './projectEnvelope';

/** Versioned, game-owned operations. Clients only own transport and files. */
export interface AgentOperationInput {
  project?: unknown;
  recipe?: unknown;
  options?: Record<string, unknown>;
}
export interface AgentOperationResult {
  ok: boolean;
  document?: StudioProjectDocumentV2;
  report: Record<string, unknown>;
  artifact?: unknown;
}
export interface AgentOperationContract {
  id: string;
  version: '1.0.0';
  title: string;
  description: string;
  kind: 'query' | 'edit' | 'workflow';
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requires: string[];
  preserves: string[];
  invalidates: string[];
  /**
   * Stable platform family, separate from a game-owned operation id.  It is
   * deliberately additive: older packages can be normalised by the registry.
   */
  familyId?: string;
  familyVersion?: '1.0.0';
  /** Whether the envelope is shared, adapted by a game provider, or native. */
  support?: 'shared' | 'adapted' | 'native';
  /** Explicit compatibility alias metadata; never an implicit dispatcher hint. */
  compatibility?: { aliasFor: string; deprecated: true; replacement: string };
  /** Explicit common envelope admitted for a shared/adapted family. */
  familyCore?: { kind: 'query' | 'mutation'; project: 'required' | 'optional'; recipe: 'optional' | 'unsupported'; options: 'optional' | 'unsupported'; result: 'ok+report' };
  /** Named shared implementation factory; discovery can distinguish it from provider-only adapters. */
  implementationOrigin?: string;
}
export interface GameAgentOperation extends AgentOperationContract {
  execute(input: AgentOperationInput): AgentOperationResult | Promise<AgentOperationResult>;
}
export interface GameAgentAdapter {
  gameId: string;
  version: string;
  aliases?: string[];
  operations: GameAgentOperation[];
}

export class GameAgentRegistry {
  private readonly adapters = new Map<string, GameAgentAdapter>();
  register(adapter: GameAgentAdapter): void {
    if (this.adapters.has(adapter.gameId)) throw new Error(`DUPLICATE_AGENT_ADAPTER: ${adapter.gameId}`);
    const names = [adapter.gameId, ...adapter.aliases ?? []];
    if (new Set(names).size !== names.length || names.some(name => !/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(name))) throw new Error('AGENT_ID_INVALID');
    const occupied = this.list().flatMap(item => [item.gameId, ...item.aliases ?? []]);
    if (names.some(name => occupied.includes(name))) throw new Error('AGENT_ALIAS_COLLISION');
    const ids = adapter.operations.map(operation => operation.id);
    if (new Set(ids).size !== ids.length) throw new Error(`DUPLICATE_AGENT_OPERATION: ${adapter.gameId}`);
    // The registry is the package admission boundary.  Discovery never sees an
    // unclassified legacy operation, even when an extension uses the older type.
    adapter.operations = adapter.operations.map(operation => ({
        ...operation,
        familyId: operation.familyId ?? operationFamilyId(operation.id),
        familyVersion: operation.familyVersion ?? '1.0.0',
        support: operation.support ?? operationSupport(operation.id),
      }));
    this.adapters.set(adapter.gameId, adapter);
  }
  unregister(gameId: string): void { this.adapters.delete(gameId); }
  has(gameId: string): boolean { return this.adapters.has(gameId); }
  list(): GameAgentAdapter[] { return [...this.adapters.values()].sort((a, b) => a.gameId.localeCompare(b.gameId)); }
  require(id: string): GameAgentAdapter {
    const adapter = this.adapters.get(id) ?? this.list().find(item => item.aliases?.includes(id));
    if (!adapter) throw new Error(`GAME_AGENT_UNAVAILABLE: ${id}`);
    return adapter;
  }
}

export function operationFamilyId(operationId: string): string {
  return `native.${operationId.replace(/\s+/g, '-')}`;
}
export function operationSupport(operationId: string): 'shared' | 'adapted' | 'native' {
  void operationId;
  return 'native';
}

export const AGENT_RESULT_SCHEMA = {
  type: 'object', required: ['ok', 'report'],
  properties: {
    ok: { type: 'boolean' }, document: { type: 'object' }, report: { type: 'object' }, artifact: {},
    gameId: { type: 'string' }, operation: { type: 'string' }, adapterVersion: { type: 'string' }, operationVersion: { type: 'string' },
    inputHash: { type: 'string' }, projectHash: { type: 'string' }, effects: { type: 'object' }, outputs: { type: 'object' },
  },
  additionalProperties: false,
};
