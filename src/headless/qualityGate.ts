import type {
  ContractIssue,
  EffectPackManifest,
  FixedCameraAssetMetadata,
  PluginPackageManifest,
  QualityReport,
  ResolvedRenderPlan,
} from './contracts.js';
import { BCS_CONTRACT_VERSION } from './contracts.js';
import { REQUIRED_LOOK_SLOTS } from './variantCompiler.js';

export interface QualityGateOptions {
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

export function runQualityGate(
  plan: ResolvedRenderPlan,
  options: QualityGateOptions = {},
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

  for (const slot of REQUIRED_LOOK_SLOTS) {
    if (!plan.slots[slot]) {
      issues.push(issue('REQUIRED_LOOK_SLOT_MISSING', 'error', `Required look slot ${slot} is missing.`, `$.slots.${slot}`));
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
    const metadata = plan.cameraProfile.manifest.metadata as Partial<FixedCameraAssetMetadata> | undefined;
    const design = metadata?.designResolution;
    if (!design || !Number.isFinite(design.width) || !Number.isFinite(design.height) || design.width <= 0 || design.height <= 0) {
      issues.push(issue('CAMERA_DESIGN_RESOLUTION_MISSING', strict ? 'error' : 'warning', 'Fixed-camera profile must declare a positive designResolution.', '$.cameraProfile.manifest.metadata.designResolution'));
    } else {
      const cameraAspect = design.width / design.height;
      const outputAspect = plan.output.width / plan.output.height;
      if (Math.abs(cameraAspect - outputAspect) > 0.001) {
        issues.push(issue(
          'CAMERA_OUTPUT_ASPECT_MISMATCH',
          'error',
          `Output aspect ${outputAspect.toFixed(4)} does not match fixed camera aspect ${cameraAspect.toFixed(4)}.`,
          '$.output',
        ));
      }
    }
    if (metadata?.allowOrbit !== false) {
      issues.push(issue('FIXED_CAMERA_ORBIT_NOT_LOCKED', 'error', 'Fixed-camera profiles must explicitly set allowOrbit=false.', '$.cameraProfile.manifest.metadata.allowOrbit'));
    }
    const boardRect = metadata?.boardScreenRect;
    if (boardRect && design) {
      const inside = boardRect.x >= 0
        && boardRect.y >= 0
        && boardRect.width > 0
        && boardRect.height > 0
        && boardRect.x + boardRect.width <= design.width
        && boardRect.y + boardRect.height <= design.height;
      if (!inside) {
        issues.push(issue('CAMERA_BOARD_RECT_OUT_OF_BOUNDS', 'error', 'boardScreenRect must remain inside designResolution.', '$.cameraProfile.manifest.metadata.boardScreenRect'));
      }
    }
  }

  const primaryClear = plan.slots['clear.primary']?.manifest;
  if (primaryClear?.kind === 'effect-pack') {
    const effect = primaryClear as EffectPackManifest;
    const roles = new Set(effect.layers.map((layer) => layer.role));
    if (!roles.has('energy')) {
      issues.push(issue('CLEAR_ENERGY_LAYER_MISSING', strict ? 'error' : 'warning', 'Primary clear effect has no energy propagation layer.', '$.slots.clear.primary'));
    }
    if (!roles.has('tile-exit') && !roles.has('large-fragments')) {
      issues.push(issue('CLEAR_TILE_EXIT_MISSING', 'error', 'Primary clear effect must remove or fragment cleared tiles.', '$.slots.clear.primary'));
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
