import type { StudioProjectDocumentV2 } from '../../../game-runtime/projectEnvelope';
import type { GameReplayEnvelope } from '../../../game-runtime/replayEnvelope';
import type { BlockCrushDropDirectorProfile } from '../presentation/presentationAdapter';
import { blockCrushDropPresentationAdapter } from '../presentation/presentationAdapter';
import { parseBlockCrushDirectorProfile } from '../presentation/directorProfile';
import { resolveClearEffectBindings } from '../presentation/clearEffectLibrary';

type JsonRecord = Record<string, unknown>;

function numberIn(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const result = value === undefined ? fallback : value;
  if (
    typeof result !== 'number' ||
    !Number.isFinite(result) ||
    result < minimum ||
    result > maximum
  ) {
    throw new Error(`${label} must be a finite number between ${minimum} and ${maximum}.`);
  }
  return result;
}

function baseDirectorProfileFromProject(
  document: StudioProjectDocumentV2,
  take: GameReplayEnvelope,
): BlockCrushDropDirectorProfile {
  const value = document.direction?.rhythm;
  const rhythm: JsonRecord =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
  const profiles = rhythm.authoredProfilesByTake;
  if (
    profiles &&
    typeof profiles === 'object' &&
    !Array.isArray(profiles) &&
    Object.hasOwn(profiles, take.takeId)
  ) {
    return parseBlockCrushDirectorProfile(
      (profiles as JsonRecord)[take.takeId],
      take.actions.length,
    );
  }
  if (rhythm.authoredProfile !== undefined)
    return parseBlockCrushDirectorProfile(rhythm.authoredProfile, take.actions.length);
  const scale = numberIn(rhythm.phaseScale, 1, 0.1, 4, 'direction.rhythm.phaseScale');
  // PresentationAdapter converts canonical 30 Hz frame counts to output FPS once.
  const frame = (canonicalFrames: number) => Math.max(1, Math.round(canonicalFrames * scale));
  const clearSeconds = numberIn(rhythm.clearSeconds, 1.6, 0, 10, 'direction.rhythm.clearSeconds');
  const tilt = numberIn(rhythm.tilt, 1.45, 0, 2, 'direction.rhythm.tilt');
  const cascade = Boolean(
    (document.game.config.data as { rules?: { settlement?: string } }).rules?.settlement,
  );
  const collapseFrames =
    rhythm.collapseSeconds === undefined
      ? frame(cascade ? 15 : 12)
      : Math.max(
          1,
          Math.round(
            numberIn(rhythm.collapseSeconds, 0.5, 0.05, 3, 'direction.rhythm.collapseSeconds') * 30,
          ),
        );
  const hold = numberIn(rhythm.collapseHoldRatio, 0, 0, 0.95, 'direction.rhythm.collapseHoldRatio');
  return {
    ...(rhythm.stepMotionByAction === undefined
      ? {}
      : {
          stepProgressByAction: (() => {
            if (!Array.isArray(rhythm.stepMotionByAction) || rhythm.stepMotionByAction.length > 500)
              throw new Error('stepMotionByAction must be an array of at most 500 step maps.');
            return rhythm.stepMotionByAction.map((entry) => {
              if (!entry || typeof entry !== 'object' || Array.isArray(entry))
                throw new Error('Step motion must be an object.');
              return Object.fromEntries(
                Object.entries(entry).map(([key, value]) => {
                  if (
                    !/^(?:reconfigure|active-gravity):\d+$|^contact-stack:\d+:\d+$/.test(key) ||
                    !value ||
                    typeof value !== 'object' ||
                    Array.isArray(value)
                  )
                    throw new Error(`Invalid step motion ${key}.`);
                  const motion = value as JsonRecord;
                  if (
                    Object.keys(motion).some(
                      (k) =>
                        ![
                          'holdRatio',
                          'easing',
                          'leadSeconds',
                          'tailSeconds',
                          'progressCurve',
                        ].includes(k),
                    )
                  )
                    throw new Error(`Unknown step motion option ${key}.`);
                  const holdRatio = numberIn(
                    motion.holdRatio,
                    0,
                    0,
                    0.95,
                    `stepMotionByAction.${key}.holdRatio`,
                  );
                  const easing =
                    motion.easing ?? (key.startsWith('active-gravity:') ? 'gravity' : 'linear');
                  if (!['linear', 'gravity', 'smoothstep'].includes(easing as string))
                    throw new Error(`Invalid step motion easing ${key}.`);
                  if (motion.progressCurve !== undefined) {
                    if (!Array.isArray(motion.progressCurve))
                      throw new Error(`Invalid progressCurve ${key}.`);
                    return [key, motion.progressCurve as number[]];
                  }
                  return [
                    key,
                    Array.from({ length: 101 }, (_, i) => {
                      const u = Math.max(0, Math.min(1, (i / 100 - holdRatio) / (1 - holdRatio)));
                      return easing === 'gravity'
                        ? u * u
                        : easing === 'smoothstep'
                          ? u * u * (3 - 2 * u)
                          : u;
                    }),
                  ];
                }),
              );
            });
          })(),
          gravityLeadFramesByAction: (() =>
            (rhythm.stepMotionByAction as Array<Record<string, JsonRecord>>).map((entry) =>
              Object.fromEntries(
                Object.entries(entry).flatMap(([key, motion]) =>
                  motion.leadSeconds === undefined
                    ? []
                    : [
                        [
                          key,
                          numberIn(
                            motion.leadSeconds,
                            0,
                            0,
                            3,
                            `stepMotionByAction.${key}.leadSeconds`,
                          ) * 30,
                        ],
                      ],
                ),
              ),
            ))(),
          stepTailFramesByAction: (() =>
            (rhythm.stepMotionByAction as Array<Record<string, JsonRecord>>).map((entry) =>
              Object.fromEntries(
                Object.entries(entry).flatMap(([key, motion]) =>
                  motion.tailSeconds === undefined
                    ? []
                    : [
                        [
                          key,
                          numberIn(
                            motion.tailSeconds,
                            0,
                            0,
                            0.5,
                            `stepMotionByAction.${key}.tailSeconds`,
                          ) * 30,
                        ],
                      ],
                ),
              ),
            ))(),
        }),
    ...(rhythm.stepSecondsByAction === undefined
      ? {}
      : {
          stepFramesByAction: (() => {
            if (
              !Array.isArray(rhythm.stepSecondsByAction) ||
              rhythm.stepSecondsByAction.length > 500
            )
              throw new Error('stepSecondsByAction must be an array of at most 500 step maps.');
            return rhythm.stepSecondsByAction.map((entry) => {
              if (!entry || typeof entry !== 'object' || Array.isArray(entry))
                throw new Error('Step seconds must be an object.');
              return Object.fromEntries(
                Object.entries(entry).map(([key, value]) => [
                  key,
                  numberIn(
                    value,
                    0,
                    /^(?:detect|settle|field-advance):/.test(key) ? 0 : 1 / 30,
                    10,
                    `stepSecondsByAction.${key}`,
                  ) * 30,
                ]),
              );
            });
          })(),
        }),
    ...(rhythm.pieceSettleSeconds === undefined
      ? {}
      : {
          pieceSettleFramesByAction: take.actions.map(() =>
            Math.max(
              1,
              Math.round(
                numberIn(
                  rhythm.pieceSettleSeconds,
                  0.2,
                  1 / 30,
                  2,
                  'direction.rhythm.pieceSettleSeconds',
                ) * 30,
              ),
            ),
          ),
        }),
    reconfigureProgressByAction: take.actions.map(() =>
      Array.from({ length: 101 }, (_, i) => Math.max(0, (i / 100 - hold) / (1 - hold))),
    ),
    leadInSeconds: numberIn(rhythm.leadInSeconds, 0, 0, 10, 'direction.rhythm.leadInSeconds'),
    betweenActionsSeconds: numberIn(
      rhythm.betweenActionsSeconds,
      0,
      0,
      10,
      'direction.rhythm.betweenActionsSeconds',
    ),
    tailSeconds: numberIn(rhythm.tailSeconds, 1, 0, 10, 'direction.rhythm.tailSeconds'),
    phaseFramesByAction: take.actions.map(() => ({
      detect: frame(cascade ? 2 : 1),
      resolve: frame(cascade ? 4 : 3),
      reconfigure: collapseFrames,
      settle: frame(4),
      outcome: frame(1),
    })),
    clearEffectFramesByAction: take.actions.map(() => Math.round(clearSeconds * 30)),
    clearFragmentTiltScaleByAction: take.actions.map(() => tilt),
    clearRowStaggerFramesByAction: take.actions.map(() => Math.max(4, Math.round(30 * 0.22))),
  };
}

export function blockCrushDropDirectorProfileFromProject(
  document: StudioProjectDocumentV2,
  take: GameReplayEnvelope,
): BlockCrushDropDirectorProfile {
  return resolveClearEffectBindings(document, take, baseDirectorProfileFromProject(document, take));
}

export function compileBlockCrushDropProjectFrameSource(
  document: StudioProjectDocumentV2,
  take: GameReplayEnvelope,
) {
  return blockCrushDropPresentationAdapter.compile({
    project: document.game,
    replay: take,
    directorProfile: blockCrushDropDirectorProfileFromProject(document, take),
    fps: document.production.output.fps,
  });
}
