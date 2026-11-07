import type { SemanticEventCategory } from './presentationPacket';

export const ELIMINATION_RESOLUTION_TRACE_CONTRACT = 'bcs.elimination-resolution-trace' as const;
export const ELIMINATION_RESOLUTION_TRACE_VERSION = '1.0.0' as const;

export type EliminationResolutionPhase = Exclude<SemanticEventCategory, 'interaction'>;

export interface LogicalPose2D {
  x: number;
  y: number;
  rotationQuarterTurns?: 0 | 1 | 2 | 3;
}

export type EliminationEntityDelta =
  | { kind: 'spawn'; entityId: string; from?: LogicalPose2D; to: LogicalPose2D }
  | { kind: 'move'; entityId: string; from: LogicalPose2D; to: LogicalPose2D }
  | { kind: 'remove'; entityId: string; from: LogicalPose2D }
  | {
      kind: 'transform';
      entityId: string;
      from?: LogicalPose2D;
      to?: LogicalPose2D;
      state: string;
    };

export interface EliminationMetricDelta {
  score?: number;
  combo?: number;
  timeMs?: number;
  objectives?: Record<string, number>;
  status?: string;
}

export interface EliminationResolutionStep {
  id: string;
  phase: EliminationResolutionPhase;
  cycleIndex: number;
  entityIds: string[];
  deltas: EliminationEntityDelta[];
  metrics?: EliminationMetricDelta;
  tags: string[];
}

export interface EliminationResolutionTrace {
  contract: typeof ELIMINATION_RESOLUTION_TRACE_CONTRACT;
  contractVersion: typeof ELIMINATION_RESOLUTION_TRACE_VERSION;
  actionId: string;
  beforeStateHash: string;
  afterStateHash: string;
  steps: EliminationResolutionStep[];
}

export interface EliminationTraceIssue {
  code: string;
  path: string;
  message: string;
}

const PHASES = new Set<EliminationResolutionPhase>([
  'commit',
  'detect',
  'resolve',
  'reconfigure',
  'settle',
  'outcome',
]);

function issue(code: string, path: string, message: string): EliminationTraceIssue {
  return { code, path, message };
}

export function validateEliminationResolutionTrace(
  trace: EliminationResolutionTrace,
): EliminationTraceIssue[] {
  const issues: EliminationTraceIssue[] = [];
  if (trace.contract !== ELIMINATION_RESOLUTION_TRACE_CONTRACT) {
    issues.push(
      issue(
        'TRACE_CONTRACT_INVALID',
        '$.contract',
        `Expected ${ELIMINATION_RESOLUTION_TRACE_CONTRACT}.`,
      ),
    );
  }
  if (trace.contractVersion !== ELIMINATION_RESOLUTION_TRACE_VERSION) {
    issues.push(
      issue(
        'TRACE_VERSION_INVALID',
        '$.contractVersion',
        `Expected ${ELIMINATION_RESOLUTION_TRACE_VERSION}.`,
      ),
    );
  }
  for (const [field, value] of [
    ['actionId', trace.actionId],
    ['beforeStateHash', trace.beforeStateHash],
    ['afterStateHash', trace.afterStateHash],
  ] as const) {
    if (typeof value !== 'string' || value.length === 0) {
      issues.push(issue('TRACE_ID_INVALID', `$.${field}`, `${field} must be a non-empty string.`));
    }
  }
  if (!Array.isArray(trace.steps) || trace.steps.length === 0) {
    issues.push(issue('TRACE_STEPS_EMPTY', '$.steps', 'At least one resolution step is required.'));
    return issues;
  }

  const stepIds = new Set<string>();
  let previousCycle = 0;
  trace.steps.forEach((step, index) => {
    const path = `$.steps[${index}]`;
    if (stepIds.has(step.id)) {
      issues.push(issue('TRACE_STEP_ID_DUPLICATE', `${path}.id`, `Duplicate step id ${step.id}.`));
    }
    stepIds.add(step.id);
    if (
      !Number.isInteger(step.cycleIndex) ||
      step.cycleIndex < 0 ||
      step.cycleIndex < previousCycle
    ) {
      issues.push(
        issue(
          'TRACE_CYCLE_INVALID',
          `${path}.cycleIndex`,
          'cycleIndex must be a non-negative, monotonic integer.',
        ),
      );
    } else {
      previousCycle = step.cycleIndex;
    }
    if (!PHASES.has(step.phase)) {
      issues.push(
        issue('TRACE_PHASE_INVALID', `${path}.phase`, `Unsupported phase ${String(step.phase)}.`),
      );
    }
    const entityIds = new Set(step.entityIds);
    for (const delta of step.deltas) {
      if (!entityIds.has(delta.entityId)) {
        issues.push(
          issue(
            'TRACE_DELTA_ENTITY_UNDECLARED',
            `${path}.deltas`,
            `Delta entity ${delta.entityId} must be listed in entityIds.`,
          ),
        );
      }
    }
  });
  return issues;
}

export function assertEliminationResolutionTrace(
  trace: EliminationResolutionTrace,
): EliminationResolutionTrace {
  const issues = validateEliminationResolutionTrace(trace);
  if (issues.length > 0) {
    throw new Error(
      issues.map((item) => `${item.code} at ${item.path}: ${item.message}`).join('; '),
    );
  }
  return trace;
}
