import type {
  ContractIssue,
  EffectPackManifest,
  CameraAssetMetadata,
  PluginPackageManifest,
  QualityReport,
  ResolvedRenderPlan,
} from './contracts.js';
import { BCS_CONTRACT_VERSION } from './contracts.js';
import type { GameRenderContract } from '../game-runtime/renderContract.js';
import { requiredSlotIds } from '../game-runtime/renderContract.js';

export interface QualityGateV2Options {
  strict?: boolean;
  requireHashes?: boolean;
  maxTextureMemoryMiB?: number;
  maxTriangleCount?: number;
  maxPluginMemoryMiB?: number;
  forbiddenPluginPermissions?: PluginPackageManifest['permissions'];
}

function issue(
  code: string,
  severity: ContractIssue['severity'],
  message: string,
  path: string,
  recoverable = true,
): ContractIssue {
  return { code, severity, message, path, recoverable };
}

export function runQualityGateV2(
  plan: ResolvedRenderPlan,
  contract: GameRenderContract,
  options: QualityGateV2Options = {},
): QualityReport {
  const issues: ContractIssue[] = [];
  const requireHashes = options.requireHashes ?? false;
  const strict = options.strict ?? false;
  const maxTextureMemoryMiB = options.maxTextureMemoryMiB ?? 512;
  const maxTriangleCount = options.maxTriangleCount ?? 1_000_000;
  const maxPluginMemoryMiB = options.maxPluginMemoryMiB ?? 256;
  const forbiddenPermissions = new Set(
    options.forbiddenPluginPermissions ?? [
      'network',
      'filesystem-read',
      'filesystem-write',
      'process-spawn',
      'dom',
    ],
  );

  const backend = contract.backends[plan.renderer];
  if (!backend) {
    issues.push(issue(
      'RENDERER_UNSUPPORTED',
      'error',
      `Render contract ${contract.id} does not declare backend ${plan.renderer}.`,
      `$.backends.${plan.renderer}`,
    ));
  } else {
    for (const slotId of requiredSlotIds(contract, plan.renderer)) {
      if (!plan.slots[slotId]) {
        issues.push(issue('REQUIRED_LOOK_SLOT_MISSING', 'error', `Required look slot ${slotId} is missing.`, `$.slots.${slotId}`));
      }
    }
  }

  const uniqueAssets = new Map<string, ResolvedRenderPlan['lookPack']>();
  const allAssets = plan.assets && Object.keys(plan.assets).length > 0
    ? Object.values(plan.assets)
    : [plan.layoutProfile, plan.cameraProfile, plan.lookPack, ...Object.values(plan.slots)];
  for (const asset of allAssets) uniqueAssets.set(`${asset.manifest.id}@${asset.manifest.version}`, asset);

  let textureMemoryMiB = 0;
  let triangleCount = 0;
  let pluginMemoryMiB = 0;

  for (const [key, asset] of uniqueAssets) {
    const manifest = asset.manifest;
    const path = `$.assets[${JSON.stringify(key)}]`;
    if (!manifest.runtime.renderers.includes(plan.renderer)) {
      issues.push(issue('ASSET_RENDERER_INCOMPATIBLE', 'error', `Asset ${key} does not support ${plan.renderer}.`, path));
    }
    if (!manifest.runtime.deterministic) {
      issues.push(issue('ASSET_NONDETERMINISTIC', strict ? 'error' : 'warning', `Asset ${key} is declared non-deterministic.`, path));
    }
    if (requireHashes && !manifest.contentHash) {
      issues.push(issue('ASSET_HASH_REQUIRED', 'error', `Asset ${key} does not declare contentHash.`, `${path}.contentHash`));
    }
    const budget = manifest.runtime.budget;
    textureMemoryMiB += budget?.textureMemoryMiB ?? 0;
    triangleCount += budget?.triangleCount ?? 0;
    pluginMemoryMiB += budget?.pluginMemoryMiB ?? 0;
    if (manifest.kind === 'plugin-package') {
      const plugin = manifest as PluginPackageManifest;
      for (const permission of plugin.permissions) {
        if (forbiddenPermissions.has(permission)) {
          issues.push(issue(
            'PLUGIN_PERMISSION_FORBIDDEN',
            'error',
            `Plugin ${key} requests forbidden permission ${permission}.`,
            `${path}.permissions`,
            false,
          ));
        }
      }
    }
  }

  if (plan.cameraProfile.manifest.kind !== 'camera-profile') {
    issues.push(issue('CAMERA_PROFILE_KIND_INVALID', 'error', 'Creative Master cameraProfileRef must resolve to a camera-profile.', '$.cameraProfile'));
  } else {
    const metadata = plan.cameraProfile.manifest.metadata as (Partial<CameraAssetMetadata> & Record<string, unknown>) | undefined;
    const design = metadata?.designResolution;
    if (!design || !Number.isFinite(design.width) || !Number.isFinite(design.height) || design.width <= 0 || design.height <= 0) {
      issues.push(issue('CAMERA_DESIGN_RESOLUTION_MISSING', strict ? 'error' : 'warning', 'Camera profile must declare a positive designResolution.', '$.cameraProfile.manifest.metadata.designResolution'));
    } else {
      const cameraAspect = design.width / design.height;
      const outputAspect = plan.output.width / plan.output.height;
      if (Math.abs(cameraAspect - outputAspect) > 0.001) {
        issues.push(issue(
          'CAMERA_OUTPUT_ASPECT_MISMATCH',
          'error',
          `Output aspect ${outputAspect.toFixed(4)} does not match camera composition aspect ${cameraAspect.toFixed(4)}.`,
          '$.output',
        ));
      }
    }
    if (plan.renderer === 'moving-camera-cinematic') {
      if (metadata?.motionMode !== 'keyframed' && metadata?.motionMode !== 'event-driven') {
        issues.push(issue('MOVING_CAMERA_MODE_MISSING', 'error', 'Moving-camera profiles must declare keyframed or event-driven motion.', '$.cameraProfile.manifest.metadata.motionMode'));
      }
      if (metadata?.allowTransformAnimation !== true) {
        issues.push(issue('MOVING_CAMERA_ANIMATION_DISABLED', 'error', 'Moving-camera profiles must explicitly enable transform animation.', '$.cameraProfile.manifest.metadata.allowTransformAnimation'));
      }
      if (metadata?.timeBase !== 'presentation-frame') {
        issues.push(issue('MOVING_CAMERA_TIMEBASE_INVALID', 'error', 'Moving-camera profiles must use presentation-frame time.', '$.cameraProfile.manifest.metadata.timeBase'));
      }
      if (metadata?.motionMode === 'keyframed' && (!Array.isArray(metadata.keyframes) || metadata.keyframes.length < 2)) {
        issues.push(issue('MOVING_CAMERA_KEYFRAMES_MISSING', 'error', 'Keyframed camera profiles require at least two keyframes.', '$.cameraProfile.manifest.metadata.keyframes'));
      }
      if (metadata?.motionMode === 'event-driven' && (!Array.isArray(metadata.eventBindings) || metadata.eventBindings.length === 0)) {
        issues.push(issue('MOVING_CAMERA_EVENTS_MISSING', 'error', 'Event-driven camera profiles require event bindings.', '$.cameraProfile.manifest.metadata.eventBindings'));
      }
    } else if (metadata?.allowOrbit !== false) {
      issues.push(issue('FIXED_CAMERA_ORBIT_NOT_LOCKED', 'error', 'Fixed-camera profiles must explicitly set allowOrbit=false.', '$.cameraProfile.manifest.metadata.allowOrbit'));
    }
  }

  const clearRole = backend?.requiredSlots.find((slot) => slot.role === 'clear-primary')?.slotId;
  const primaryClear = clearRole ? plan.slots[clearRole]?.manifest : undefined;
  if (primaryClear?.kind === 'effect-pack') {
    const effect = primaryClear as EffectPackManifest;
    const roles = new Set(effect.layers.map((layer) => layer.role));
    if (!roles.has('energy')) {
      issues.push(issue('CLEAR_ENERGY_LAYER_MISSING', strict ? 'error' : 'warning', 'Primary clear effect has no energy propagation layer.', `$.slots.${clearRole}`));
    }
    if (!roles.has('tile-exit') && !roles.has('large-fragments')) {
      issues.push(issue('CLEAR_TILE_EXIT_MISSING', 'error', 'Primary clear effect must remove or fragment cleared tiles.', `$.slots.${clearRole}`));
    }
  }

  if (plan.output.width <= 0 || plan.output.height <= 0 || plan.output.fps <= 0) {
    issues.push(issue('OUTPUT_INVALID', 'error', 'Output dimensions and fps must be positive.', '$.output'));
  }
  if (plan.output.width % 2 !== 0 || plan.output.height % 2 !== 0) {
    issues.push(issue('OUTPUT_DIMENSIONS_ODD', 'error', 'H.264 output dimensions must be even.', '$.output'));
  }
  if (plan.lockMode === 'frame-exact' && Object.keys(plan.directorOverrides).length > 0) {
    issues.push(issue('FRAME_EXACT_DIRECTOR_OVERRIDE', 'error', 'frame-exact plans cannot contain director overrides.', '$.directorOverrides'));
  }
  if (!plan.planHash.startsWith('fnv1a32:')) {
    issues.push(issue('PLAN_HASH_INVALID', 'error', 'Resolved render plan has an invalid planHash.', '$.planHash'));
  }

  if (textureMemoryMiB > maxTextureMemoryMiB) {
    issues.push(issue('TEXTURE_BUDGET_EXCEEDED', 'error', `Texture memory ${textureMemoryMiB} MiB exceeds ${maxTextureMemoryMiB} MiB.`, '$.metrics.textureMemoryMiB'));
  }
  if (triangleCount > maxTriangleCount) {
    issues.push(issue('TRIANGLE_BUDGET_EXCEEDED', 'error', `Triangle count ${triangleCount} exceeds ${maxTriangleCount}.`, '$.metrics.triangleCount'));
  }
  if (pluginMemoryMiB > maxPluginMemoryMiB) {
    issues.push(issue('PLUGIN_MEMORY_BUDGET_EXCEEDED', 'error', `Plugin memory ${pluginMemoryMiB} MiB exceeds ${maxPluginMemoryMiB} MiB.`, '$.metrics.pluginMemoryMiB'));
  }

  return {
    contract: 'bcs.quality-report',
    contractVersion: BCS_CONTRACT_VERSION,
    planId: plan.id,
    passed: !issues.some((candidate) => candidate.severity === 'error'),
    issues,
    metrics: {
      assetCount: uniqueAssets.size,
      textureMemoryMiB,
      triangleCount,
      pluginMemoryMiB,
    },
  };
}
