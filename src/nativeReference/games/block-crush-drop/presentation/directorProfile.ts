import type { BlockCrushDropDirectorProfile } from './presentationAdapter';

const scalarKeys = [
  'leadInSeconds',
  'betweenActionsSeconds',
  'tailSeconds',
  'countdownStartSeconds',
  'clearExposureSeconds',
] as const;
const arrayKeys = [
  'phaseFramesByAction',
  'clearEffectFramesByAction',
  'clearMotionFramesByAction',
  'clearMotionStartOffsetFramesByAction',
  'clearMotionProgressByAction',
  'clearFragmentTiltScaleByAction',
  'clearFragmentMotionBlurByAction',
  'clearObservedFragmentMotionByAction',
  'clearFragmentAppearanceByAction',
  'clearFragmentFoldSpreadByAction',
  'clearResidualMotionByAction',
  'reconfigureProgressByAction',
  'settleBounceCellsByAction',
  'clearEffectStartOffsetFramesByAction',
  'clearRowStaggerFramesByAction',
  'scoreRevealByAction',
  'countdownTickFrames',
  'cycleTimingsByAction',
] as const;

const physicsBounds: Record<string, readonly [number, number]> = {
  meshBendCompliance: [0, 0.1],
  meshBreakStrain: [0.01, 10],
  meshBreakFrames: [0.25, 120],
  meshTearDelayFrames: [0, 120],
  meshAngularStiffness: [0, 400],
  meshAnchorStiffness: [0, 400],
  meshAttachmentStiffness: [0, 400],
  meshFractureEnergyRetention: [0, 1],
  fractureSpinSpeed: [0, 8],
  materialSeed: [0, 4294967295],
  gravity: [0, 100],
  damping: [0, 10],
  releaseFrontFrames: [0, 120],
  bondLifetimeFrames: [0, 120],
  radius: [0.05, 0.75],
  restitution: [0, 1],
  observationStrength: [0, 400],
  separationSpeed: [0, 12],
  separationVariation: [0, 1],
  bondReleaseDurationFrames: [0.25, 120],
  bondCompliance: [0, 0.1],
};
const appearanceBounds: Record<string, readonly [number, number]> = {
  exitFadeFrames: [0.25, 120],
  cutFaceAmbient: [0, 1],
  topFaceAmbient: [0, 1],
  cutFaceTint: [0, 16777215],
  baseScale: [0.1, 1.5],
  releaseGrowthScale: [0, 1],
  releaseGrowthEndLifetimeProgress: [0, 1],
  releaseGrowthFadeLifetimeProgress: [0.001, 1],
  clusterScatterCells: [0, 8],
  fragmentScatterCells: [0, 8],
  scatterStartReleaseAge: [0, 0.99],
  frontTextureEndBlend: [0, 1],
  frontTextureFadeStartLifetimeProgress: [0, 1],
  frontTextureFadeLifetimeProgress: [0.001, 1],
  relaxConstraintsAfterMotionStep: [0, 120],
  relaxedConstraintIterations: [0, 16],
};
const numericProperties = (bounds: Record<string, readonly [number, number]>) =>
  Object.fromEntries(
    Object.entries(bounds).map(([key, [minimum, maximum]]) => [
      key,
      { type: 'number', minimum, maximum },
    ]),
  );
const physicsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...numericProperties(physicsBounds),
    meshAngularRelease: {
      type: 'object',
      additionalProperties: false,
      required: ['holdFrames', 'fadeFrames', 'targetStiffness'],
      description:
        'Surviving-edge spring softening by latest node release age at canonical30fps; target must not exceed meshAngularStiffness. Requires a positive mesh angular spring and meshBendCompliance.',
      properties: {
        holdFrames: { type: 'integer', minimum: 0, maximum: 120 },
        fadeFrames: { type: 'integer', minimum: 1, maximum: 120 },
        targetStiffness: { type: 'number', minimum: 0, maximum: 400 },
      },
    },
    gravityEnvelope: {
      type: 'object',
      additionalProperties: false,
      required: ['startFrame', 'transitionFrames', 'targetGravity'],
      description:
        'Cue-local canonical30fps smoothstep external gravity field, independent of lifetime.',
      properties: {
        startFrame: { type: 'integer', minimum: 0, maximum: 900 },
        transitionFrames: { type: 'integer', minimum: 1, maximum: 900 },
        targetGravity: { type: 'number', minimum: 0, maximum: 100 },
      },
    },
    materialSeed: { type: 'integer', minimum: 0, maximum: 4294967295 },
    sharedContact: { type: 'boolean' },
    bondedContact: {
      type: 'boolean',
      description:
        'Opt-in existing bounded single-point contacts for released connected fragments. True requires effective contactShape box; missing/false preserves the old exclusion.',
    },
    contactShape: { type: 'string', enum: ['sphere', 'box'] },
    depthLayers: { type: 'integer', enum: [1, 2] },
    releaseSpinScale: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: { type: 'number', minimum: 0, maximum: 4 },
    },
    releaseSegments: {
      type: 'array',
      minItems: 2,
      maxItems: 64,
      description:
        'Spatial knots spanning normalized columns 0..1 in strictly increasing order. Absolute releaseFrame/detachFrame offsets are canonical 30fps; detach >= release. Linear spatial interpolation, smooth force release.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['at', 'releaseFrame', 'detachFrame'],
        properties: {
          at: { type: 'number', minimum: 0, maximum: 1 },
          releaseFrame: { type: 'number', minimum: 0, maximum: 900 },
          detachFrame: { type: 'number', minimum: 0, maximum: 900 },
        },
      },
    },
  },
};
const appearanceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...numericProperties(appearanceBounds),
    cutFaceTint: { type: 'integer', minimum: 0, maximum: 16777215 },
    inertialPhysics: physicsSchema,
  },
};
const cycleProperties = {
  phaseFrames: {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      ['commit', 'detect', 'resolve', 'reconfigure', 'settle', 'outcome'].map((key) => [
        key,
        { type: 'integer', minimum: 1, maximum: 900 },
      ]),
    ),
  },
  gravityFrames: { type: 'integer', minimum: 1, maximum: 900 },
  reconfigureProgress: {
    type: 'array',
    maxItems: 900,
    items: { type: 'number', minimum: 0, maximum: 1 },
  },
  clearEffectFrames: { type: 'integer', minimum: 1, maximum: 900 },
  clearMotionFrames: { type: 'integer', minimum: 1, maximum: 900 },
  clearEffectStartOffsetFrames: { type: 'integer', minimum: -900, maximum: 900 },
  clearMotionStartOffsetFrames: { type: 'integer', minimum: 0, maximum: 900 },
  fragmentAppearance: appearanceSchema,
};

function validateAppearance(
  appearance: unknown,
  angularPhysicsBase?: Record<string, unknown>,
): void {
  if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance))
    throw new Error('CRUSH_DIRECTOR_PROFILE_APPEARANCE_INVALID');
  for (const [key, value] of Object.entries(appearance)) {
    if (key === 'inertialPhysics') continue;
    const bounds = appearanceBounds[key];
    if (!Object.hasOwn(appearanceBounds, key))
      throw new Error(`CRUSH_DIRECTOR_PROFILE_APPEARANCE_FIELD_UNKNOWN: ${key}`);
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < bounds![0] ||
      value > bounds![1] ||
      (key === 'cutFaceTint' && !Number.isInteger(value))
    )
      throw new Error(`CRUSH_DIRECTOR_PROFILE_APPEARANCE_VALUE_INVALID: ${key}`);
  }
  const physics = (appearance as Record<string, unknown>).inertialPhysics;
  if (physics === undefined) return;
  if (!physics || typeof physics !== 'object' || Array.isArray(physics))
    throw new Error('CRUSH_DIRECTOR_PROFILE_PHYSICS_INVALID');
  const volume = physics as Record<string, unknown>;
  if (
    typeof volume.separationVariation === 'number' &&
    volume.separationVariation > 0 &&
    (!(typeof volume.separationSpeed === 'number' && volume.separationSpeed > 0) ||
      typeof volume.meshBendCompliance !== 'number')
  )
    throw new Error('CRUSH_DIRECTOR_PROFILE_SEPARATION_VARIATION_REQUIRES_MESH_SPLIT');
  if (
    typeof volume.fractureSpinSpeed === 'number' &&
    volume.fractureSpinSpeed > 0 &&
    volume.depthLayers !== 2
  )
    throw new Error('CRUSH_DIRECTOR_PROFILE_INTERNAL_SPIN_REQUIRES_VOLUME');
  if (
    typeof volume.meshFractureEnergyRetention === 'number' &&
    volume.meshFractureEnergyRetention > 0 &&
    !(typeof volume.meshAttachmentStiffness === 'number' && volume.meshAttachmentStiffness > 0)
  )
    throw new Error('CRUSH_DIRECTOR_PROFILE_RECOIL_REQUIRES_ATTACHMENT');
  if (
    typeof volume.meshAttachmentStiffness === 'number' &&
    volume.meshAttachmentStiffness > 0 &&
    (volume.depthLayers !== 2 || typeof volume.meshBendCompliance !== 'number')
  )
    throw new Error('CRUSH_DIRECTOR_PROFILE_ATTACHMENT_REQUIRES_VOLUME_MESH');
  for (const [key, value] of Object.entries(physics)) {
    if (key === 'meshAngularRelease') {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some((k) => !['holdFrames', 'fadeFrames', 'targetStiffness'].includes(k))
      )
        throw new Error('CRUSH_DIRECTOR_PROFILE_ANGULAR_RELEASE_INVALID');
      const { holdFrames, fadeFrames, targetStiffness } = value as Record<string, unknown>;
      if (
        typeof holdFrames !== 'number' ||
        !Number.isInteger(holdFrames) ||
        holdFrames < 0 ||
        holdFrames > 120 ||
        typeof fadeFrames !== 'number' ||
        !Number.isInteger(fadeFrames) ||
        fadeFrames < 1 ||
        fadeFrames > 120 ||
        typeof targetStiffness !== 'number' ||
        !Number.isFinite(targetStiffness) ||
        targetStiffness < 0 ||
        targetStiffness > 400
      )
        throw new Error('CRUSH_DIRECTOR_PROFILE_ANGULAR_RELEASE_INVALID');
      continue;
    }
    if (key === 'gravityEnvelope') {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some(
          (k) => !['startFrame', 'transitionFrames', 'targetGravity'].includes(k),
        )
      )
        throw new Error('CRUSH_DIRECTOR_PROFILE_GRAVITY_ENVELOPE_INVALID');
      const { startFrame, transitionFrames, targetGravity } = value as Record<string, unknown>;
      if (
        typeof startFrame !== 'number' ||
        !Number.isInteger(startFrame) ||
        startFrame < 0 ||
        startFrame > 900 ||
        typeof transitionFrames !== 'number' ||
        !Number.isInteger(transitionFrames) ||
        transitionFrames < 1 ||
        transitionFrames > 900 ||
        typeof targetGravity !== 'number' ||
        !Number.isFinite(targetGravity) ||
        targetGravity < 0 ||
        targetGravity > 100
      )
        throw new Error('CRUSH_DIRECTOR_PROFILE_GRAVITY_ENVELOPE_INVALID');
      continue;
    }
    if (key === 'contactShape') {
      if (value !== 'sphere' && value !== 'box')
        throw new Error('CRUSH_DIRECTOR_PROFILE_PHYSICS_VALUE_INVALID: contactShape');
      continue;
    }
    if (key === 'materialSeed' && (typeof value !== 'number' || !Number.isInteger(value)))
      throw new Error('CRUSH_DIRECTOR_PROFILE_PHYSICS_VALUE_INVALID: materialSeed');
    if (key === 'releaseSpinScale') {
      if (
        !Array.isArray(value) ||
        value.length !== 3 ||
        value.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 4)
      )
        throw new Error('CRUSH_DIRECTOR_PROFILE_PHYSICS_VALUE_INVALID: releaseSpinScale');
      continue;
    }
    if (key === 'depthLayers') {
      if (value !== 1 && value !== 2)
        throw new Error('CRUSH_DIRECTOR_PROFILE_PHYSICS_VALUE_INVALID: depthLayers');
      continue;
    }
    if (key === 'sharedContact' || key === 'bondedContact') {
      if (typeof value !== 'boolean')
        throw new Error(`CRUSH_DIRECTOR_PROFILE_PHYSICS_VALUE_INVALID: ${key}`);
      continue;
    }
    if (key === 'releaseSegments') {
      if (!Array.isArray(value) || value.length < 2 || value.length > 64)
        throw new Error('CRUSH_DIRECTOR_PROFILE_RELEASE_SEGMENTS_INVALID');
      let previous = -1;
      value.forEach((segment, index) => {
        if (
          !segment ||
          typeof segment !== 'object' ||
          Array.isArray(segment) ||
          Object.keys(segment).some((k) => !['at', 'releaseFrame', 'detachFrame'].includes(k))
        )
          throw new Error('CRUSH_DIRECTOR_PROFILE_RELEASE_SEGMENT_INVALID');
        const { at, releaseFrame, detachFrame } = segment;
        if (
          ![at, releaseFrame, detachFrame].every(
            (n) => typeof n === 'number' && Number.isFinite(n),
          ) ||
          at < 0 ||
          at > 1 ||
          at <= previous ||
          releaseFrame < 0 ||
          detachFrame < releaseFrame ||
          detachFrame > 900 ||
          (index === 0 && at !== 0) ||
          (index === value.length - 1 && at !== 1)
        )
          throw new Error('CRUSH_DIRECTOR_PROFILE_RELEASE_SEGMENT_INVALID');
        previous = at;
      });
      continue;
    }
    const bounds = physicsBounds[key];
    if (!Object.hasOwn(physicsBounds, key))
      throw new Error(`CRUSH_DIRECTOR_PROFILE_PHYSICS_FIELD_UNKNOWN: ${key}`);
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < bounds![0] ||
      value > bounds![1]
    )
      throw new Error(`CRUSH_DIRECTOR_PROFILE_PHYSICS_VALUE_INVALID: ${key}`);
  }
  // Cross-field dependencies follow the same action→cycle merge as runtime.
  const effective = { ...angularPhysicsBase, ...volume };
  if (effective.bondedContact === true && effective.contactShape !== 'box')
    throw new Error('CRUSH_DIRECTOR_PROFILE_BONDED_CONTACT_REQUIRES_BOX');
  if (effective.meshAngularRelease !== undefined) {
    const angular = effective.meshAngularRelease as Record<string, unknown>;
    if (
      !angular ||
      typeof angular !== 'object' ||
      Array.isArray(angular) ||
      typeof angular.targetStiffness !== 'number'
    )
      throw new Error('CRUSH_DIRECTOR_PROFILE_ANGULAR_RELEASE_INVALID');
    if (
      typeof effective.meshBendCompliance !== 'number' ||
      typeof effective.meshAngularStiffness !== 'number' ||
      effective.meshAngularStiffness <= 0
    )
      throw new Error('CRUSH_DIRECTOR_PROFILE_ANGULAR_RELEASE_REQUIRES_MESH_SPRING');
    if (angular.targetStiffness > effective.meshAngularStiffness)
      throw new Error('CRUSH_DIRECTOR_PROFILE_ANGULAR_RELEASE_CANNOT_HARDEN');
  }
}

export const blockCrushDirectorProfileSchema = {
  type: 'object',
  additionalProperties: false,
  description:
    'Measured presentation profile. Frame units are canonical 30 fps; gameplay and impact ticks are preserved.',
  properties: {
    ...Object.fromEntries(
      scalarKeys.map((key) => [
        key,
        {
          type: 'number',
          minimum: 0,
          maximum:
            key === 'clearExposureSeconds'
              ? 1 / 30
              : key.endsWith('Seconds') && key !== 'countdownStartSeconds'
                ? 10
                : 100000,
        },
      ]),
    ),
    ...Object.fromEntries(
      arrayKeys.map((key) => [
        key,
        { type: 'array', maxItems: key === 'countdownTickFrames' ? 900 : 500 },
      ]),
    ),
    clearFragmentAppearanceByAction: {
      type: 'array',
      maxItems: 500,
      items: { anyOf: [{ type: 'null' }, appearanceSchema] },
    },
    cycleTimingsByAction: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'array',
        maxItems: 32,
        items: { type: 'object', additionalProperties: false, properties: cycleProperties },
      },
    },
  },
};

/** Bound persisted measurements before the tolerant presentation compiler consumes them. */
export function parseBlockCrushDirectorProfile(
  value: unknown,
  actionCount: number,
): BlockCrushDropDirectorProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('CRUSH_DIRECTOR_PROFILE_INVALID');
  const source = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(source)) {
    if (!Object.hasOwn(blockCrushDirectorProfileSchema.properties, key))
      throw new Error(`CRUSH_DIRECTOR_PROFILE_FIELD_UNKNOWN: ${key}`);
    if ((scalarKeys as readonly string[]).includes(key)) {
      const maximum =
        key === 'clearExposureSeconds' ? 1 / 30 : key === 'countdownStartSeconds' ? 100000 : 10;
      if (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > maximum)
        throw new Error(`CRUSH_DIRECTOR_PROFILE_VALUE_INVALID: ${key}`);
    } else if (
      !Array.isArray(item) ||
      item.length > (key === 'countdownTickFrames' ? 900 : actionCount)
    ) {
      throw new Error(`CRUSH_DIRECTOR_PROFILE_ACTION_COUNT: ${key}`);
    }
  }
  const numericArrays = [
    'clearEffectFramesByAction',
    'clearMotionFramesByAction',
    'clearMotionStartOffsetFramesByAction',
    'clearFragmentTiltScaleByAction',
    'settleBounceCellsByAction',
    'clearEffectStartOffsetFramesByAction',
    'clearRowStaggerFramesByAction',
    'countdownTickFrames',
  ];
  for (const key of numericArrays) {
    for (const item of (source[key] as unknown[] | undefined) ?? []) {
      if (item === null || item === undefined) continue;
      if (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 900)
        throw new Error(`CRUSH_DIRECTOR_PROFILE_VALUE_INVALID: ${key}`);
    }
  }
  for (const item of (source.phaseFramesByAction as unknown[] | undefined) ?? []) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('CRUSH_DIRECTOR_PROFILE_PHASE_INVALID');
    for (const [key, value] of Object.entries(item)) {
      if (
        !['commit', 'detect', 'resolve', 'reconfigure', 'settle', 'outcome'].includes(key) ||
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 900
      )
        throw new Error(`CRUSH_DIRECTOR_PROFILE_PHASE_INVALID: ${key}`);
    }
  }
  for (const key of ['clearMotionProgressByAction', 'reconfigureProgressByAction']) {
    for (const curve of (source[key] as unknown[] | undefined) ?? []) {
      if (curve === null || curve === undefined) continue;
      if (
        !Array.isArray(curve) ||
        curve.length > 900 ||
        curve.some(
          (value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1,
        )
      )
        throw new Error(`CRUSH_DIRECTOR_PROFILE_CURVE_INVALID: ${key}`);
    }
  }
  for (const [actionIndex, cycles] of (
    (source.cycleTimingsByAction as unknown[] | undefined) ?? []
  ).entries()) {
    if (!Array.isArray(cycles) || cycles.length > 32)
      throw new Error('CRUSH_DIRECTOR_PROFILE_CYCLES_INVALID');
    for (const cycle of cycles) {
      if (!cycle || typeof cycle !== 'object' || Array.isArray(cycle))
        throw new Error('CRUSH_DIRECTOR_PROFILE_CYCLE_INVALID');
      for (const [key, item] of Object.entries(cycle)) {
        if (!Object.hasOwn(cycleProperties, key))
          throw new Error(`CRUSH_DIRECTOR_PROFILE_CYCLE_FIELD_UNKNOWN: ${key}`);
        if (key === 'fragmentAppearance') {
          const actionAppearance = (
            source.clearFragmentAppearanceByAction as Record<string, unknown>[] | undefined
          )?.[actionIndex];
          const actionPhysics = actionAppearance?.inertialPhysics;
          validateAppearance(
            item,
            actionPhysics && typeof actionPhysics === 'object' && !Array.isArray(actionPhysics)
              ? (actionPhysics as Record<string, unknown>)
              : undefined,
          );
        } else if (key === 'phaseFrames') {
          if (!item || typeof item !== 'object' || Array.isArray(item))
            throw new Error('CRUSH_DIRECTOR_PROFILE_PHASE_INVALID');
          for (const [phase, frames] of Object.entries(item)) {
            if (
              !['commit', 'detect', 'resolve', 'reconfigure', 'settle', 'outcome'].includes(
                phase,
              ) ||
              !Number.isInteger(frames) ||
              frames < 1 ||
              frames > 900
            )
              throw new Error('CRUSH_DIRECTOR_PROFILE_PHASE_INVALID');
          }
        } else if (key === 'reconfigureProgress') {
          if (
            !Array.isArray(item) ||
            item.length > 900 ||
            item.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)
          )
            throw new Error('CRUSH_DIRECTOR_PROFILE_CURVE_INVALID');
        } else if (
          typeof item !== 'number' ||
          !Number.isInteger(item) ||
          item > 900 ||
          item <
            (key === 'clearEffectStartOffsetFrames'
              ? -900
              : key === 'clearMotionStartOffsetFrames'
                ? 0
                : 1)
        )
          throw new Error(`CRUSH_DIRECTOR_PROFILE_CYCLE_VALUE_INVALID: ${key}`);
      }
    }
  }
  for (const appearance of (source.clearFragmentAppearanceByAction as unknown[] | undefined) ??
    []) {
    if (appearance === null || appearance === undefined) continue;
    validateAppearance(appearance);
  }
  let nodes = 0;
  const inspect = (item: unknown, depth: number): void => {
    if (++nodes > 250000 || depth > 10) throw new Error('CRUSH_DIRECTOR_PROFILE_BUDGET');
    if (item === null || item === undefined) return; // JSON null is an unassigned per-action override.
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Math.abs(item) > 100000)
        throw new Error('CRUSH_DIRECTOR_PROFILE_NON_FINITE');
    } else if (Array.isArray(item)) {
      if (item.length > 5000) throw new Error('CRUSH_DIRECTOR_PROFILE_BUDGET');
      item.forEach((child) => inspect(child, depth + 1));
    } else if (typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if ((key === 'sharedContact' || key === 'bondedContact') && typeof child === 'boolean')
          continue;
        if (key === 'contactShape' && (child === 'sphere' || child === 'box')) continue;
        if (
          key === 'cutFaceTint' &&
          typeof child === 'number' &&
          Number.isInteger(child) &&
          child >= 0 &&
          child <= 0xffffff
        )
          continue;
        if (key === 'coordinateSpace' && child === 'source-stage-pixels') continue;
        if (key === 'name' && typeof child === 'string' && child.length <= 120) continue;
        inspect(child, depth + 1);
      }
    } else throw new Error('CRUSH_DIRECTOR_PROFILE_VALUE_INVALID');
  };
  inspect(source, 0);
  return structuredClone(source) as BlockCrushDropDirectorProfile;
}
