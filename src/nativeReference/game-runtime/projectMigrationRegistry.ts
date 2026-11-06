import { GameRegistryError } from './errors';
import type { ProjectMigrationReport, StudioProjectDocumentV2 } from './projectEnvelope';

export interface ProjectMigrationResult {
  document: StudioProjectDocumentV2;
  report: ProjectMigrationReport;
}

export interface ProjectMigrationAdapter {
  readonly gameId: string;
  canMigrate(value: unknown): boolean;
  migrate(value: unknown): ProjectMigrationResult;
}

/** Game-neutral dispatch for legacy project formats registered by game packages. */
export class ProjectMigrationRegistry {
  private readonly adapters = new Map<string, ProjectMigrationAdapter>();

  register(adapter: ProjectMigrationAdapter): void {
    if (this.adapters.has(adapter.gameId)) {
      throw new GameRegistryError(
        'DUPLICATE_PROJECT_MIGRATION',
        `Project migration adapter for ${adapter.gameId} is already registered.`,
      );
    }
    this.adapters.set(adapter.gameId, adapter);
  }

  unregister(gameId: string): void {
    this.adapters.delete(gameId);
  }

  has(gameId: string): boolean {
    return this.adapters.has(gameId);
  }

  migrate(value: unknown): ProjectMigrationResult {
    const matches = [...this.adapters.values()].filter((adapter) => adapter.canMigrate(value));
    if (matches.length === 0) {
      throw new GameRegistryError('PROJECT_MIGRATION_NOT_FOUND', 'No registered game package recognizes this project format.');
    }
    if (matches.length > 1) {
      throw new GameRegistryError(
        'PROJECT_MIGRATION_AMBIGUOUS',
        `Multiple game packages recognize this project: ${matches.map((adapter) => adapter.gameId).join(', ')}.`,
      );
    }
    return matches[0]!.migrate(value);
  }
}
