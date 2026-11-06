import type { GameRenderContract } from './renderContract';
import { GameRegistryError } from './errors';

export function renderContractKey(id: string, version: string): string {
  return `${id}@${version}`;
}

export class RenderContractRegistry {
  private readonly contracts = new Map<string, GameRenderContract>();

  register(contract: GameRenderContract): void {
    const key = renderContractKey(contract.id, contract.version);
    if (this.contracts.has(key)) {
      throw new GameRegistryError(
        'DUPLICATE_RENDER_CONTRACT',
        `Render contract ${key} is already registered.`,
        { details: { id: contract.id, version: contract.version } },
      );
    }
    this.contracts.set(key, contract);
  }

  require(id: string, version?: string): GameRenderContract {
    if (version !== undefined) {
      const found = this.contracts.get(renderContractKey(id, version));
      if (!found) {
        throw new GameRegistryError(
          'UNKNOWN_RENDER_CONTRACT',
          `Render contract ${renderContractKey(id, version)} is not registered.`,
          { details: { id, version } },
        );
      }
      return found;
    }
    const matches = [...this.contracts.values()].filter((item) => item.id === id);
    if (matches.length === 0) {
      throw new GameRegistryError('UNKNOWN_RENDER_CONTRACT', `Render contract ${id} is not registered.`, {
        details: { id },
      });
    }
    if (matches.length > 1) {
      throw new GameRegistryError(
        'AMBIGUOUS_RENDER_CONTRACT',
        `Render contract ${id} has multiple registered versions; pass version.`,
        { details: { id, versions: matches.map((item) => item.version) } },
      );
    }
    return matches[0]!;
  }

  has(id: string, version?: string): boolean {
    if (version !== undefined) return this.contracts.has(renderContractKey(id, version));
    return [...this.contracts.values()].some((item) => item.id === id);
  }

  list(): GameRenderContract[] {
    return [...this.contracts.values()];
  }

  unregister(id: string, version: string): void {
    this.contracts.delete(renderContractKey(id, version));
  }
}
