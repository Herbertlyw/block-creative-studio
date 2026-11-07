import { describe, expect, it } from 'vitest';
import { MaterialRuntimeLoadGate } from '../src/renderer/materialRuntimeLoadGate';

describe('MaterialRuntimeLoadGate', () => {
  it('discards A after A → B → A so only the latest generation commits', () => {
    const gate = new MaterialRuntimeLoadGate();
    const loadA1 = gate.begin();
    const loadB = gate.begin();
    const loadA2 = gate.begin();
    expect(gate.commit(loadA1, 'A')).toBe(false);
    expect(gate.commit(loadB, 'B')).toBe(false);
    expect(gate.commit(loadA2, 'A')).toBe(true);
    expect(gate.committedKey).toBe('A');
    expect(gate.failure).toBeNull();
  });

  it('allows retry after a failed load of the same key once the URL is fixed', () => {
    const gate = new MaterialRuntimeLoadGate();
    const first = gate.begin();
    expect(gate.fail(first, '404')).toBe(true);
    expect(gate.shouldSkip('steel')).toBe(false);
    const retry = gate.begin();
    expect(gate.commit(retry, 'steel')).toBe(true);
    expect(gate.shouldSkip('steel')).toBe(true);
    expect(gate.failure).toBeNull();
  });

  it('does not skip before the first successful commit, even for an empty key', () => {
    const gate = new MaterialRuntimeLoadGate();
    expect(gate.shouldSkip('')).toBe(false);
    expect(gate.shouldSkip('steel')).toBe(false);
  });

  it('drops in-flight commits after the scene is disposed', () => {
    const gate = new MaterialRuntimeLoadGate();
    const load = gate.begin();
    gate.dispose();
    expect(gate.commit(load, 'steel')).toBe(false);
    expect(gate.isCurrent(load)).toBe(false);
    expect(() => gate.begin()).toThrow(/disposed/);
  });

  it('keeps the previous committed key when a later variant fails', () => {
    const gate = new MaterialRuntimeLoadGate();
    const steel = gate.begin();
    expect(gate.commit(steel, 'steel')).toBe(true);
    const wood = gate.begin();
    expect(gate.fail(wood, 'wood maps missing')).toBe(true);
    expect(gate.committedKey).toBe('steel');
    expect(gate.failure).toBe('wood maps missing');
    expect(gate.shouldSkip('wood')).toBe(false);
  });
});
