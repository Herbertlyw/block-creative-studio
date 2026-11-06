import type { HeadlessRendererId, ResolvedRenderPlan } from '../headless/contracts';
import type { GameRenderContract } from '../game-runtime/renderContract';
import { requiredSlotIds } from '../game-runtime/renderContract';
import type { RenderBackendAdapter } from './backendRegistry';
import { RenderBackendError } from './backendRegistry';
import {
  assertPreparedResourcesReady,
  readyRenderResources,
  type PreparedRenderResources,
} from './preparedRenderResources';

/** The runtime resource gate only needs plan identity, renderer, and slot keys. */
export interface PlanBoundRenderPlan {
  planHash: ResolvedRenderPlan['planHash'];
  renderer: HeadlessRendererId;
  slots: Readonly<Record<string, unknown>>;
}

export type RenderResourcePolicy =
  | {
      mode: 'plan-bound';
      planHash: string;
      resources: PreparedRenderResources;
      requiredSlotIds: readonly string[];
    }
  | {
      mode: 'procedural-no-assets';
      reason: string;
      runtimeAssets?: unknown;
    }
  | {
      mode: 'bundled-assets';
      bundleId: string;
      reason: string;
      runtimeAssets: unknown;
    };

function sameSlotIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((id) => expected.has(id));
}

export function deriveRequiredRuntimeSlotIds(
  plan: PlanBoundRenderPlan,
  renderContract: GameRenderContract,
  backend: RenderBackendAdapter,
): string[] {
  if (plan.renderer !== backend.renderer) {
    throw new RenderBackendError(
      'PLAN_RENDERER_MISMATCH',
      `Plan renderer ${plan.renderer} does not match backend ${backend.renderer}.`,
      '$.plan.renderer',
    );
  }
  if (!renderContract.backends[backend.renderer]) {
    throw new RenderBackendError(
      'BACKEND_NOT_IN_CONTRACT',
      `Render contract ${renderContract.id} does not declare backend ${backend.renderer}.`,
      `$.backends.${backend.renderer}`,
    );
  }
  const required = requiredSlotIds(renderContract, backend.renderer);
  for (const slotId of required) {
    if (!(slotId in plan.slots)) {
      throw new RenderBackendError(
        'PLAN_REQUIRED_SLOT_MISSING',
        `Resolved render plan is missing required slot ${slotId}.`,
        `$.plan.slots.${slotId}`,
      );
    }
  }
  return required;
}

export function bindPreparedResources(input: {
  plan: PlanBoundRenderPlan;
  resources: PreparedRenderResources;
  renderContract: GameRenderContract;
  backend: RenderBackendAdapter;
}): Extract<RenderResourcePolicy, { mode: 'plan-bound' }> {
  const requiredSlotIdsForJob = deriveRequiredRuntimeSlotIds(input.plan, input.renderContract, input.backend);
  return {
    mode: 'plan-bound',
    planHash: input.plan.planHash,
    resources: input.resources,
    requiredSlotIds: requiredSlotIdsForJob,
  };
}

export function assertRenderResourcePolicy(
  policy: RenderResourcePolicy,
  input: {
    plan?: PlanBoundRenderPlan;
    renderContract?: GameRenderContract;
    backend: RenderBackendAdapter;
  },
): PreparedRenderResources {
  if (policy.mode === 'procedural-no-assets') {
    if (!policy.reason.trim()) {
      throw new RenderBackendError(
        'PROCEDURAL_REASON_REQUIRED',
        'procedural-no-assets requires a reason.',
        '$.resourcePolicy.reason',
      );
    }
    return readyRenderResources(
      'procedural-no-assets',
      policy.runtimeAssets !== undefined ? { runtimeAssets: policy.runtimeAssets } : {},
    );
  }

  if (policy.mode === 'bundled-assets') {
    if (!policy.bundleId.trim()) {
      throw new RenderBackendError(
        'BUNDLED_ASSET_ID_REQUIRED',
        'bundled-assets requires a bundleId.',
        '$.resourcePolicy.bundleId',
      );
    }
    if (!policy.reason.trim()) {
      throw new RenderBackendError(
        'BUNDLED_ASSET_REASON_REQUIRED',
        'bundled-assets requires a reason.',
        '$.resourcePolicy.reason',
      );
    }
    if (policy.runtimeAssets === undefined) {
      throw new RenderBackendError(
        'BUNDLED_RUNTIME_ASSETS_REQUIRED',
        'bundled-assets requires explicit runtimeAssets.',
        '$.resourcePolicy.runtimeAssets',
      );
    }
    return readyRenderResources(`bundled-assets:${policy.bundleId}`, {
      runtimeAssets: policy.runtimeAssets,
    });
  }

  if (!input.plan || !input.renderContract) {
    throw new RenderBackendError(
      'PLAN_BINDING_REQUIRED',
      'plan-bound resource policy requires the resolved render plan and game render contract.',
      '$.plan',
    );
  }
  if (policy.planHash !== input.plan.planHash) {
    throw new RenderBackendError(
      'PLAN_HASH_MISMATCH',
      `Resource policy planHash ${policy.planHash} does not match resolved plan ${input.plan.planHash}.`,
      '$.resourcePolicy.planHash',
    );
  }
  if (!policy.resources) {
    throw new RenderBackendError(
      'PREPARED_RESOURCES_MISSING',
      'plan-bound resource policy requires PreparedResources.',
      '$.resourcePolicy.resources',
    );
  }
  if (policy.resources.planHash !== policy.planHash) {
    throw new RenderBackendError(
      'RESOURCES_PLAN_HASH_MISMATCH',
      `Prepared resources planHash ${policy.resources.planHash} does not match policy ${policy.planHash}.`,
      '$.resourcePolicy.resources.planHash',
    );
  }
  const derived = deriveRequiredRuntimeSlotIds(input.plan, input.renderContract, input.backend);
  if (!sameSlotIds(policy.requiredSlotIds, derived)) {
    throw new RenderBackendError(
      'REQUIRED_SLOTS_NOT_DERIVED',
      'plan-bound requiredSlotIds must be derived from the render plan, game render contract, and backend.',
      '$.resourcePolicy.requiredSlotIds',
    );
  }
  assertPreparedResourcesReady(policy.resources, {
    expectedPlanHash: policy.planHash,
    requiredSlotIds: derived,
  });
  return policy.resources;
}
