import { BCS_CONTRACT_VERSION, type PreparedResources, type ResourceReadiness } from '../headless/contracts';
import { RenderBackendError } from './backendRegistry';

export interface PreparedRenderResources extends PreparedResources {
  runtimeAssets?: unknown;
  cameraMicroAdjustment?: import('./cameraMicroAdjustment').CameraMicroAdjustment;
}

export function readyRenderResources(
  planHash: string,
  extras: { runtimeAssets?: unknown; slots?: PreparedResources['slots'] } = {},
): PreparedRenderResources {
  const resources: PreparedRenderResources = {
    contract: 'bcs.prepared-resources',
    contractVersion: BCS_CONTRACT_VERSION,
    planHash,
    readiness: 'ready',
    slots: extras.slots ?? [],
    missing: [],
  };
  if (extras.runtimeAssets !== undefined) resources.runtimeAssets = extras.runtimeAssets;
  return resources;
}

export function assertPreparedResourcesReady(
  resources: PreparedRenderResources,
  input: {
    expectedPlanHash: string;
    requiredSlotIds: readonly string[];
  },
): void {
  if (!resources.planHash) {
    throw new RenderBackendError('RESOURCES_PLAN_HASH_MISSING', 'Prepared resources must include planHash.', '$.planHash');
  }
  if (resources.planHash !== input.expectedPlanHash) {
    throw new RenderBackendError(
      'RESOURCES_PLAN_HASH_MISMATCH',
      `Prepared resources planHash ${resources.planHash} does not match expected ${input.expectedPlanHash}.`,
      '$.planHash',
    );
  }
  if (resources.readiness !== 'ready') {
    throw new RenderBackendError(
      'RESOURCES_NOT_READY',
      `Prepared resources readiness is ${resources.readiness}, expected ready.`,
      '$.readiness',
    );
  }
  if (resources.missing.length > 0) {
    throw new RenderBackendError(
      'RESOURCES_MISSING',
      `Prepared resources still missing: ${resources.missing.map((item) => item.slotId).join(', ')}.`,
      '$.missing',
    );
  }
  for (const slotId of input.requiredSlotIds) {
    const slot = resources.slots.find((item) => item.slotId === slotId);
    const ready: ResourceReadiness = 'ready';
    if (!slot || slot.readiness !== ready) {
      throw new RenderBackendError(
        'REQUIRED_SLOT_UNPREPARED',
        `Required resource slot ${slotId} is not ready.`,
        `$.slots.${slotId}`,
      );
    }
  }
}
