import { stableHash } from '../headless/stableHash';

export interface AgentPressurePoint {
  step: number;
  progress: number;
  metrics: Record<string, number>;
  stateHash?: string;
}

export interface AgentPressureStageTarget {
  id: string;
  from: number;
  to: number;
  metric: string;
  minimum?: number;
  maximum?: number;
}

export interface AgentSearchBudget {
  candidates: number;
  strategies: number;
  seeds: number;
  maxSteps: number;
}

function finite(value: unknown, label: string, fallback: number, minimum: number, maximum: number): number {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== 'number' || !Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

function integer(value: unknown, label: string, fallback: number, minimum: number, maximum: number): number {
  const resolved = finite(value, label, fallback, minimum, maximum);
  if (!Number.isInteger(resolved)) throw new Error(`${label} must be an integer.`);
  return resolved;
}

/** Shared only for bounded orchestration. Games retain their own rules, actions, and pressure metrics. */
export function parseAgentSearchBudget(value: unknown, defaults: Partial<AgentSearchBudget> = {}): AgentSearchBudget {
  const source = value === undefined ? {} : value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('budget must be an object.');
  const raw = source as Record<string, unknown>;
  const unknown = Object.keys(raw).filter(key => !['candidates', 'strategies', 'seeds', 'maxSteps'].includes(key));
  if (unknown.length) throw new Error(`Unsupported budget field(s): ${unknown.join(', ')}.`);
  return {
    candidates: integer(raw.candidates, 'budget.candidates', defaults.candidates ?? 4, 1, 32),
    strategies: integer(raw.strategies, 'budget.strategies', defaults.strategies ?? 3, 1, 8),
    seeds: integer(raw.seeds, 'budget.seeds', defaults.seeds ?? 3, 1, 16),
    maxSteps: integer(raw.maxSteps, 'budget.maxSteps', defaults.maxSteps ?? 180, 1, 500),
  };
}

export function parsePressureStageTargets(value: unknown, availableMetrics: readonly string[]): AgentPressureStageTarget[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) throw new Error('pressureStages must contain 1-12 stages.');
  const ids = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`pressureStages[${index}] must be an object.`);
    const raw = item as Record<string, unknown>;
    const unknown = Object.keys(raw).filter(key => !['id', 'from', 'to', 'metric', 'minimum', 'maximum'].includes(key));
    if (unknown.length) throw new Error(`pressureStages[${index}] has unsupported field(s): ${unknown.join(', ')}.`);
    if (typeof raw.id !== 'string' || !raw.id.trim() || ids.has(raw.id)) throw new Error(`pressureStages[${index}].id must be unique and non-empty.`);
    ids.add(raw.id);
    if (typeof raw.metric !== 'string' || !availableMetrics.includes(raw.metric)) {
      throw new Error(`pressureStages[${index}].metric must be one of ${availableMetrics.join(', ')}.`);
    }
    const from = finite(raw.from, `pressureStages[${index}].from`, 0, 0, 1);
    const to = finite(raw.to, `pressureStages[${index}].to`, 1, 0, 1);
    if (to <= from) throw new Error(`pressureStages[${index}].to must be greater than from.`);
    const minimum = raw.minimum === undefined ? undefined : finite(raw.minimum, `pressureStages[${index}].minimum`, 0, -1_000_000, 1_000_000);
    const maximum = raw.maximum === undefined ? undefined : finite(raw.maximum, `pressureStages[${index}].maximum`, 0, -1_000_000, 1_000_000);
    if (minimum === undefined && maximum === undefined) throw new Error(`pressureStages[${index}] needs minimum or maximum.`);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) throw new Error(`pressureStages[${index}] minimum exceeds maximum.`);
    return { id: raw.id, from, to, metric: raw.metric, ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }) };
  });
}

export function assessPressureStages(points: readonly AgentPressurePoint[], targets: readonly AgentPressureStageTarget[]) {
  return targets.map(target => {
    const samples = points.filter(point => point.progress >= target.from && point.progress <= target.to);
    const values = samples.map(point => point.metrics[target.metric]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const observed = values.length ? { minimum: Math.min(...values), maximum: Math.max(...values), end: values.at(-1)! } : null;
    const minimumAchieved = target.minimum === undefined || (observed !== null && observed.maximum >= target.minimum);
    const maximumAchieved = target.maximum === undefined || (observed !== null && observed.maximum <= target.maximum);
    const achieved = values.length > 0 && minimumAchieved && maximumAchieved;
    return {
      ...target,
      achieved,
      sampleCount: values.length,
      observed,
      gap: {
        minimum: target.minimum === undefined || observed === null ? null : Math.max(0, target.minimum - observed.maximum),
        maximum: target.maximum === undefined || observed === null ? null : Math.max(0, observed.maximum - target.maximum),
      },
    };
  });
}

export function summarizePressureTrace(points: readonly AgentPressurePoint[]) {
  const metricNames = [...new Set(points.flatMap(point => Object.keys(point.metrics)))];
  return Object.fromEntries(metricNames.map(metric => {
    const values = points.map(point => point.metrics[metric]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return [metric, values.length ? { start: values[0], end: values.at(-1), minimum: Math.min(...values), peak: Math.max(...values) } : null];
  }));
}

export function trajectorySignature(actions: unknown): string {
  return stableHash({ namespace: 'agent-trajectory', actions });
}

export function deterministicSeedSeries(baseSeed: number, count: number): number[] {
  if (!Number.isInteger(baseSeed) || baseSeed < 0 || baseSeed > 0x7fffffff) throw new Error('baseSeed must be a 31-bit non-negative integer.');
  return Array.from({ length: count }, (_, index) => (baseSeed + index * 104_729) & 0x7fffffff);
}

export function agentGoalSearchSchema(metricNames: readonly string[]) {
  return {
    budget: { type: 'object', properties: { candidates: { type: 'integer', minimum: 1, maximum: 32 }, strategies: { type: 'integer', minimum: 1, maximum: 8 }, seeds: { type: 'integer', minimum: 1, maximum: 16 }, maxSteps: { type: 'integer', minimum: 1, maximum: 500 } }, additionalProperties: false },
    pressureStages: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', required: ['id', 'from', 'to', 'metric'], properties: { id: { type: 'string' }, from: { type: 'number', minimum: 0, maximum: 1 }, to: { type: 'number', minimum: 0, maximum: 1 }, metric: { enum: metricNames }, minimum: { type: 'number' }, maximum: { type: 'number' } }, additionalProperties: false } },
  };
}
