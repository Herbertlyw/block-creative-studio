/**
 * Generation-token gate for async material texture loads.
 * Commit only on success; failures keep the previous committed key so the
 * last complete material remains visible and the same key can be retried.
 */
export class MaterialRuntimeLoadGate {
  private generation = 0;
  private disposed = false;
  private committed = false;
  committedKey = '';
  failure: string | null = null;

  begin(): number {
    if (this.disposed) {
      throw new Error('MaterialRuntimeLoadGate has been disposed.');
    }
    return ++this.generation;
  }

  shouldSkip(key: string): boolean {
    return !this.disposed && this.committed && key === this.committedKey && this.failure === null;
  }

  isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  commit(generation: number, key: string): boolean {
    if (!this.isCurrent(generation)) return false;
    this.committedKey = key;
    this.committed = true;
    this.failure = null;
    return true;
  }

  fail(generation: number, message: string): boolean {
    if (!this.isCurrent(generation)) return false;
    this.failure = message;
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
  }
}
