import {
  CLEAR_SEQUENCE_MODEL,
  makeClearSequenceEffect,
  validateClearSequenceAsset,
  type ClearSequenceReference,
} from './clearSequence';
import type { StudioProjectDocumentV2 } from '../../../game-runtime/projectEnvelope';
import type { GameReplayEnvelope } from '../../../game-runtime/replayEnvelope';
import { stableHash } from '../../../headless/stableHash';
import { blockCrushDropDefinition } from '../definition';
import { parseBlockCrushDirectorProfile, blockCrushDirectorProfileSchema } from './directorProfile';
import {
  BLOCK_CRUSH_DROP_DEFAULT_FRAGMENT_APPEARANCE,
  type BlockCrushDropDirectorProfile,
  type BlockCrushDropFragmentAppearanceOverride,
} from './presentationAdapter';

export const CLEAR_EFFECT_MODEL = 'block-crush-drop.native-fragments.v1';
export type ClearEffectAppearance = BlockCrushDropFragmentAppearanceOverride;
export interface NativeClearEffect {
  id: string;
  version: '1.0.0';
  model: typeof CLEAR_EFFECT_MODEL;
  appearance: ClearEffectAppearance;
  contentHash: string;
}
export type ClearEffect =
  | NativeClearEffect
  | {
      id: string;
      version: '1.0.0';
      model: typeof CLEAR_SEQUENCE_MODEL;
      sequence: ClearSequenceReference;
      contentHash: string;
    };
export interface ClearEffectBinding {
  effectId: string;
  takeId: string;
  actionIndex?: number;
  cycleIndex?: number;
}
export interface ClearEffectLibrary {
  version: '1.0.0';
  effects: ClearEffect[];
  bindings: ClearEffectBinding[];
}
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('CLEAR_EFFECT_OBJECT_REQUIRED');
  return v as Record<string, unknown>;
};
const exact = (v: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(v).some((k) => !keys.includes(k))) throw new Error('CLEAR_EFFECT_UNKNOWN_FIELD');
};
export const clearEffectAppearanceSchema =
  blockCrushDirectorProfileSchema.properties.clearFragmentAppearanceByAction.items.anyOf[1]!;
export function clearEffectId(v: unknown): string {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(v))
    throw new Error('CLEAR_EFFECT_ID_INVALID');
  return v;
}
export function clearEffectAppearance(v: unknown): ClearEffectAppearance {
  const parsed = parseBlockCrushDirectorProfile({ clearFragmentAppearanceByAction: [v] }, 1);
  return structuredClone(parsed.clearFragmentAppearanceByAction![0]!) as ClearEffectAppearance;
}
export function makeClearEffect(id: unknown, appearance: unknown): NativeClearEffect {
  const data = {
    id: clearEffectId(id),
    version: '1.0.0' as const,
    model: CLEAR_EFFECT_MODEL as typeof CLEAR_EFFECT_MODEL,
    appearance: clearEffectAppearance(appearance),
  };
  return { ...data, contentHash: stableHash(data) };
}
export function clearEffectCycles(
  document: StudioProjectDocumentV2,
  take: GameReplayEnvelope,
): number[][] {
  let state = blockCrushDropDefinition.schemas.state.parse(document.game.initialState.data);
  return take.actions.map((item, index) => {
    const result = blockCrushDropDefinition.runtime.resolve(
      state,
      blockCrushDropDefinition.schemas.action.parse(item.action),
      { seed: take.seed, stepIndex: index },
    );
    state = result.after;
    return result.trace.steps
      .filter((step) => step.phase === 'resolve')
      .map((step) => step.cycleIndex);
  });
}
export function validateClearEffectTarget(
  document: StudioProjectDocumentV2,
  b: ClearEffectBinding,
): void {
  const take = document.takes.find((t) => t.takeId === b.takeId);
  if (!take) throw new Error(`CLEAR_EFFECT_TAKE_MISSING: ${b.takeId}`);
  if (b.cycleIndex !== undefined && b.actionIndex === undefined)
    throw new Error('CLEAR_EFFECT_CYCLE_REQUIRES_ACTION');
  if (
    b.actionIndex !== undefined &&
    (!Number.isInteger(b.actionIndex) || b.actionIndex < 0 || b.actionIndex >= take.actions.length)
  )
    throw new Error('CLEAR_EFFECT_ACTION_INVALID');
  if (
    b.cycleIndex !== undefined &&
    (!Number.isInteger(b.cycleIndex) || b.cycleIndex < 0 || b.cycleIndex > 31)
  )
    throw new Error('CLEAR_EFFECT_CYCLE_INVALID');
  const cycles = clearEffectCycles(document, take);
  const chosen =
    b.actionIndex === undefined ? cycles : cycles.slice(b.actionIndex, b.actionIndex + 1);
  if (!chosen.some((c) => (b.cycleIndex === undefined ? c.length > 0 : c.includes(b.cycleIndex))))
    throw new Error('CLEAR_EFFECT_TARGET_HAS_NO_CLEAR');
}
export function readClearEffectLibrary(document: StudioProjectDocumentV2): ClearEffectLibrary {
  const style = document.direction?.style;
  const value =
    style && typeof style === 'object' && !Array.isArray(style)
      ? (style as Record<string, unknown>).clearEffectLibrary
      : undefined;
  if (value === undefined) return { version: '1.0.0', effects: [], bindings: [] };
  const record = obj(value);
  exact(record, ['version', 'effects', 'bindings']);
  if (
    record.version !== '1.0.0' ||
    !Array.isArray(record.effects) ||
    !Array.isArray(record.bindings) ||
    record.effects.length > 100 ||
    record.bindings.length > 500
  )
    throw new Error('CLEAR_EFFECT_LIBRARY_INVALID');
  const effects = record.effects.map((raw) => {
    const e = obj(raw);
    exact(
      e,
      e.model === CLEAR_SEQUENCE_MODEL
        ? ['id', 'version', 'model', 'sequence', 'contentHash']
        : ['id', 'version', 'model', 'appearance', 'contentHash'],
    );
    const parsed =
      e.model === CLEAR_SEQUENCE_MODEL
        ? makeClearSequenceEffect(clearEffectId(e.id), e.sequence)
        : makeClearEffect(e.id, e.appearance);
    if (parsed.model === CLEAR_SEQUENCE_MODEL)
      validateClearSequenceAsset(document, parsed.sequence);
    if (
      e.version !== parsed.version ||
      e.model !== parsed.model ||
      e.contentHash !== parsed.contentHash
    )
      throw new Error(`CLEAR_EFFECT_VERSION_OR_HASH_MISMATCH: ${parsed.id}`);
    return parsed;
  });
  if (new Set(effects.map((e) => e.id)).size !== effects.length)
    throw new Error('CLEAR_EFFECT_DUPLICATE_ID');
  const bindings = record.bindings.map((raw) => {
    const r = obj(raw);
    exact(r, ['effectId', 'takeId', 'actionIndex', 'cycleIndex']);
    const b = { ...r, effectId: clearEffectId(r.effectId) } as unknown as ClearEffectBinding;
    if (!effects.some((e) => e.id === b.effectId))
      throw new Error(`CLEAR_EFFECT_BINDING_REFERENCE_MISSING: ${b.effectId}`);
    try {
      validateClearEffectTarget(document, b);
    } catch (error) {
      throw new Error(
        `消除效果「${b.effectId}」Take「${b.takeId}」${b.actionIndex === undefined ? '全部动作' : `第 ${b.actionIndex + 1} 步`}${b.cycleIndex === undefined ? '' : ` 第 ${b.cycleIndex + 1} 波`}：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return b;
  });
  if (new Set(bindings.map(clearEffectTargetKey)).size !== bindings.length)
    throw new Error('CLEAR_EFFECT_DUPLICATE_TARGET');
  return { version: '1.0.0', effects, bindings };
}
export const clearEffectTargetKey = (
  b: Pick<ClearEffectBinding, 'takeId' | 'actionIndex' | 'cycleIndex'>,
) => JSON.stringify([b.takeId, b.actionIndex ?? null, b.cycleIndex ?? null]);
export function writeClearEffectLibrary(
  document: StudioProjectDocumentV2,
  library: ClearEffectLibrary,
): StudioProjectDocumentV2 {
  const style = document.direction?.style;
  return {
    ...document,
    direction: {
      ...(document.direction ?? { rhythm: {} }),
      style: {
        ...(style && typeof style === 'object' && !Array.isArray(style) ? style : {}),
        clearEffectLibrary: structuredClone(library),
      },
    },
  };
}
export function mergeClearEffectAppearance(
  a: ClearEffectAppearance | undefined,
  b: ClearEffectAppearance,
): ClearEffectAppearance {
  return {
    ...a,
    ...b,
    ...(a?.inertialPhysics || b.inertialPhysics
      ? { inertialPhysics: { ...a?.inertialPhysics, ...b.inertialPhysics } }
      : {}),
  };
}
/** Cross-field physical requirements apply to the merged effect, not a patch. */
export function patchClearEffectAppearance(
  existing: ClearEffectAppearance,
  patch: unknown,
): ClearEffectAppearance {
  const record = obj(patch);
  if (record.inertialPhysics !== undefined) obj(record.inertialPhysics);
  return clearEffectAppearance(
    mergeClearEffectAppearance(existing, record as ClearEffectAppearance),
  );
}
/** Apply library selections only to presentation. Timing, rules and actions stay intact. */
export function resolveClearEffectBindings(
  document: StudioProjectDocumentV2,
  take: GameReplayEnvelope,
  base: BlockCrushDropDirectorProfile,
): BlockCrushDropDirectorProfile {
  const library = readClearEffectLibrary(document),
    bindings = library.bindings.filter((b) => b.takeId === take.takeId);
  if (!bindings.length) return base;
  const selectedSequences: Array<{
    actionIndex: number;
    cycleIndex: number;
    sequence: ClearSequenceReference;
  }> = [];
  const profile = structuredClone(base),
    cycles = clearEffectCycles(document, take);
  const timings = Array.from({ length: take.actions.length }, (_, i) =>
    structuredClone(profile.cycleTimingsByAction?.[i] ?? []),
  );
  for (const [actionIndex, cycleIndexes] of cycles.entries())
    for (const cycleIndex of cycleIndexes) {
      const candidates = bindings.filter(
        (b) =>
          (b.actionIndex === undefined || b.actionIndex === actionIndex) &&
          (b.cycleIndex === undefined || b.cycleIndex === cycleIndex),
      );
      candidates.sort(
        (a, b) =>
          Number(a.actionIndex !== undefined) +
          Number(a.cycleIndex !== undefined) -
          Number(b.actionIndex !== undefined) -
          Number(b.cycleIndex !== undefined),
      );
      if (!candidates.length) continue;
      const binding = candidates.at(-1)!,
        effect = library.effects.find((e) => e.id === binding.effectId)!;
      if (effect.model === CLEAR_SEQUENCE_MODEL) {
        selectedSequences.push({ actionIndex, cycleIndex, sequence: effect.sequence });
        continue;
      }
      const inherited = mergeClearEffectAppearance(
        profile.clearFragmentAppearanceByAction?.[actionIndex] ?? undefined,
        timings[actionIndex]![cycleIndex]?.fragmentAppearance ?? {},
      );
      // Effect values win over all director per-cycle values. Missing effect
      // fields inherit the calibrated action/cycle; this dependence is explicit.
      while (timings[actionIndex]!.length <= cycleIndex) timings[actionIndex]!.push({});
      timings[actionIndex]![cycleIndex] = {
        ...timings[actionIndex]![cycleIndex],
        fragmentAppearance: mergeClearEffectAppearance(inherited, effect.appearance),
      };
    }
  profile.cycleTimingsByAction = timings;
  // Internal timing maps come from the checked legacy rhythm compiler; they
  // are intentionally not accepted in authored director JSON. Validate their
  // shape here too, then keep them separate while checking every public field.
  const publicProfile = { ...profile };
  for (const key of [
    'stepFramesByAction',
    'stepProgressByAction',
    'gravityLeadFramesByAction',
    'stepTailFramesByAction',
    'pieceSettleFramesByAction',
  ] as const) {
    const entries = profile[key];
    delete publicProfile[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length > take.actions.length)
      throw new Error(`CLEAR_EFFECT_COMPILED_TIMING_INVALID: ${key}`);
    for (const entry of entries) {
      if (entry === undefined || entry === null) continue;
      if (key === 'pieceSettleFramesByAction') {
        if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 || entry > 900)
          throw new Error(`CLEAR_EFFECT_COMPILED_TIMING_INVALID: ${key}`);
        continue;
      }
      if (typeof entry !== 'object' || Array.isArray(entry))
        throw new Error(`CLEAR_EFFECT_COMPILED_TIMING_INVALID: ${key}`);
      for (const [step, value] of Object.entries(entry)) {
        if (
          !/^(?:commit|detect|resolve|reconfigure|settle|outcome|field-advance|active-gravity)(?::\d+)?$|^contact-stack:\d+:\d+$/.test(
            step,
          )
        )
          throw new Error(`CLEAR_EFFECT_COMPILED_TIMING_INVALID: ${key}/${step}`);
        const values = key === 'stepProgressByAction' ? value : [value];
        if (
          !Array.isArray(values) ||
          values.length > 900 ||
          values.some(
            (v) =>
              typeof v !== 'number' ||
              !Number.isFinite(v) ||
              v < 0 ||
              v > (key === 'stepProgressByAction' ? 1 : 900),
          )
        )
          throw new Error(`CLEAR_EFFECT_COMPILED_TIMING_INVALID: ${key}/${step}`);
      }
    }
  }
  const checked = parseBlockCrushDirectorProfile(publicProfile, take.actions.length);
  const parsed = { ...profile, ...checked };
  // Internal resolved metadata; cannot bypass validated library references via director JSON.
  for (const { actionIndex, cycleIndex, sequence } of selectedSequences) {
    const row = ((parsed.cycleTimingsByAction ??= [])[actionIndex] ??= []);
    parsed.cycleTimingsByAction[actionIndex] = row;
    while (row.length <= cycleIndex) row.push({});
    row[cycleIndex] = { ...row[cycleIndex], sequence };
  }
  return parsed;
}
export function defaultClearEffectAppearance(): ClearEffectAppearance {
  return {
    ...BLOCK_CRUSH_DROP_DEFAULT_FRAGMENT_APPEARANCE,
    baseScale: 0.48,
    releaseGrowthScale: 0.02,
    frontTextureEndBlend: 0.8,
    exitFadeFrames: 2,
    inertialPhysics: {
      depthLayers: 2,
      contactShape: 'box',
      gravity: 38,
      damping: 0.35,
      releaseFrontFrames: 30,
      bondLifetimeFrames: 6,
      radius: 0.25,
      restitution: 0.05,
      observationStrength: 0,
      bondCompliance: 0.00025,
      bondReleaseDurationFrames: 4,
      meshBendCompliance: 0.003,
      meshBreakStrain: 0.02,
      meshBreakFrames: 0.25,
      meshAngularStiffness: 0,
      meshAnchorStiffness: 0,
      meshTearDelayFrames: 4,
      meshAttachmentStiffness: 1,
      meshFractureEnergyRetention: 0.25,
      releaseSpinScale: [2, 3, 2],
      fractureSpinSpeed: 3,
      materialSeed: 29976,
      separationSpeed: 3,
      separationVariation: 1,
      sharedContact: true,
    },
  };
}
