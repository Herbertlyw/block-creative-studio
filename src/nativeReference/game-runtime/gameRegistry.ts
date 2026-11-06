import type { AnyGameDefinition, GameDefinition, GameManifest, RuntimeSchema } from './contracts';
import { GameRegistryError } from './errors';
import { SchemaRegistry } from './schemaRegistry';

export function definitionSchemas(definition: AnyGameDefinition): RuntimeSchema<unknown>[] {
  const schemas: RuntimeSchema<unknown>[] = [
    definition.schemas.config,
    definition.schemas.state,
    definition.schemas.action,
  ];
  if (definition.schemas.replayAction) schemas.push(definition.schemas.replayAction);
  return schemas;
}

export function gameKey(gameId: string, moduleVersion: string): string {
  return `${gameId}@${moduleVersion}`;
}

export class GameRegistry {
  readonly schemas: SchemaRegistry;
  private readonly games = new Map<string, AnyGameDefinition>();

  constructor(schemas = new SchemaRegistry()) {
    this.schemas = schemas;
  }

  register<Config, State, Action, Resolution>(
    definition: GameDefinition<Config, State, Action, Resolution>,
  ): void {
    const key = gameKey(definition.manifest.gameId, definition.manifest.moduleVersion);
    const pending = definitionSchemas(definition);
    if (this.games.has(key)) {
      throw new GameRegistryError(
        'DUPLICATE_GAME',
        `Game ${key} is already registered.`,
        { details: { gameId: definition.manifest.gameId, moduleVersion: definition.manifest.moduleVersion } },
      );
    }
    for (const schema of pending) {
      if (this.schemas.has(schema.id, schema.version)) {
        throw new GameRegistryError(
          'DUPLICATE_SCHEMA',
          `Schema ${schema.id}@${schema.version} is already registered.`,
          { details: { id: schema.id, version: schema.version, gameId: definition.manifest.gameId } },
        );
      }
    }
    const seen = new Set<string>();
    for (const schema of pending) {
      const schemaId = `${schema.id}@${schema.version}`;
      if (seen.has(schemaId)) {
        throw new GameRegistryError(
          'DUPLICATE_SCHEMA',
          `Schema ${schemaId} is declared twice on ${key}.`,
          { details: { id: schema.id, version: schema.version, gameId: definition.manifest.gameId } },
        );
      }
      seen.add(schemaId);
    }
    for (const schema of pending) this.schemas.register(schema);
    this.games.set(key, definition);
  }

  require<Config, State, Action, Resolution>(
    gameId: string,
    moduleVersion?: string,
  ): GameDefinition<Config, State, Action, Resolution> {
    return this.get(gameId, moduleVersion);
  }

  get<Config, State, Action, Resolution>(
    gameId: string,
    moduleVersion?: string,
  ): GameDefinition<Config, State, Action, Resolution> {
    if (moduleVersion !== undefined) {
      const found = this.games.get(gameKey(gameId, moduleVersion));
      if (!found) {
        throw new GameRegistryError(
          'UNKNOWN_GAME',
          `Game ${gameKey(gameId, moduleVersion)} is not registered.`,
          { details: { gameId, moduleVersion } },
        );
      }
      return found as GameDefinition<Config, State, Action, Resolution>;
    }

    const matches = [...this.games.values()].filter((item) => item.manifest.gameId === gameId);
    if (matches.length === 0) {
      throw new GameRegistryError('UNKNOWN_GAME', `Game ${gameId} is not registered.`, { details: { gameId } });
    }
    if (matches.length > 1) {
      throw new GameRegistryError(
        'AMBIGUOUS_GAME',
        `Game ${gameId} has multiple registered versions; pass moduleVersion.`,
        { details: { gameId, versions: matches.map((item) => item.manifest.moduleVersion) } },
      );
    }
    return matches[0] as GameDefinition<Config, State, Action, Resolution>;
  }

  has(gameId: string, moduleVersion?: string): boolean {
    if (moduleVersion !== undefined) return this.games.has(gameKey(gameId, moduleVersion));
    return [...this.games.values()].some((item) => item.manifest.gameId === gameId);
  }

  list(): GameManifest[] {
    return [...this.games.values()].map((item) => item.manifest);
  }

  unregister(gameId: string, moduleVersion: string): void {
    const key = gameKey(gameId, moduleVersion);
    const definition = this.games.get(key);
    if (!definition) return;
    this.games.delete(key);
    for (const schema of definitionSchemas(definition)) {
      this.schemas.unregister(schema.id, schema.version);
    }
  }
}
