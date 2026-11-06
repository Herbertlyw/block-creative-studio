import type { PresentationCompilerAdapter } from './frameSource';
import { GameRegistryError } from './errors';

export class PresentationRegistry {
  private readonly adapters = new Map<string, PresentationCompilerAdapter>();

  register(adapter: PresentationCompilerAdapter): void {
    if (this.adapters.has(adapter.gameId)) {
      throw new GameRegistryError(
        'DUPLICATE_PRESENTATION',
        `Presentation adapter for ${adapter.gameId} is already registered.`,
        { details: { gameId: adapter.gameId } },
      );
    }
    this.adapters.set(adapter.gameId, adapter);
  }

  require(gameId: string): PresentationCompilerAdapter {
    const adapter = this.adapters.get(gameId);
    if (!adapter) {
      throw new GameRegistryError(
        'UNKNOWN_PRESENTATION',
        `Presentation adapter for ${gameId} is not registered.`,
        { details: { gameId } },
      );
    }
    return adapter;
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }

  has(gameId: string): boolean {
    return this.adapters.has(gameId);
  }

  unregister(gameId: string): void {
    this.adapters.delete(gameId);
  }
}
