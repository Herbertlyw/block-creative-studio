/** Provider-neutral pressure and survival envelopes retain every native metric. */
export function normalizePressureTrace(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const points = value.filter((point): point is Record<string, unknown> => Boolean(point) && typeof point === 'object').map((nativeMetrics, index, all) => {
    const ratio = numberAt(nativeMetrics, 'occupancyRatio');
    const declared = capacityAt(nativeMetrics);
    const used = declared?.used ?? (ratio === undefined ? undefined : ratio);
    const limit = declared?.limit ?? (ratio === undefined ? undefined : 1);
    return {
      step: numberAt(nativeMetrics, 'step') ?? numberAt(nativeMetrics, 'index') ?? index + 1,
      progress: numberAt(nativeMetrics, 'progress') ?? (all.length <= 1 ? 1 : index / (all.length - 1)),
      // A provider-declared capacity is more informative than a normalized
      // ratio.  A ratio remains usable when capacity has no game-owned limit.
      capacity: declared ? { used: declared.used, limit: declared.limit, ratio: declared.used / declared.limit }
        : ratio !== undefined ? { used: ratio, limit: 1, ratio }
          : used !== undefined && limit !== undefined ? { used, limit, ratio: used / limit } : null,
      nativeMetrics,
    };
  });
  return { contract: 'bcs.pressure-trace', version: '1.0.0', points };
}

export function normalizeSurvivalAssessment(ok: boolean, report: Record<string, unknown>) {
  if (report.assessment && typeof report.assessment === 'object') return report.assessment;
  const passes = typeof report.passes === 'boolean' ? report.passes : typeof report.verified === 'boolean' ? report.verified : ok;
  return { contract: 'bcs.survival-assessment', version: '1.0.0', passes, scope: 'provider-reported-evidence', arbitraryPlayerGuarantee: false };
}

function numberAt(value: Record<string, unknown>, key: string): number | undefined {
  const candidate = value[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
}
function capacityAt(value: Record<string, unknown>): { used: number; limit: number } | undefined {
  const capacity = value.capacity;
  if (!capacity || typeof capacity !== 'object' || Array.isArray(capacity)) return undefined;
  const raw = capacity as Record<string, unknown>;
  const used = numberAt(raw, 'used'), limit = numberAt(raw, 'limit');
  return used !== undefined && limit !== undefined && limit > 0 ? { used, limit } : undefined;
}
