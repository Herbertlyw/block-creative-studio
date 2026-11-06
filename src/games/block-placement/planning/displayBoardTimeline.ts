/**
 * Display-board sampling is independent of the committed rules state.  A
 * placement can already have cleared in the game while its un-cleared tiles
 * remain visible until a later presentation boundary.
 */
export type BBDisplayBoard = Array<Array<string | null>>;
export type BBDisplayBoardStep = {
  actionId: string;
  commitSeconds: number;
  /** First instant at which the final board, rather than the placed board, is shown. */
  finalBoardSeconds: number;
  placed: BBDisplayBoard;
  after: BBDisplayBoard;
};
export type BBDisplayBoardTimeline = { initial: BBDisplayBoard; steps: BBDisplayBoardStep[] };

export function createBBDisplayBoardTimeline(
  initial: BBDisplayBoard,
  steps: BBDisplayBoardStep[],
): BBDisplayBoardTimeline {
  const width = initial[0]?.length;
  if (!width || initial.some((row) => row.length !== width))
    throw new Error('BB_DISPLAY_BOARD_INVALID');
  const valid = (board: BBDisplayBoard) =>
    board.length === initial.length &&
    board.every(
      (row) =>
        row.length === width && row.every((cell) => cell === null || typeof cell === 'string'),
    );
  if (!valid(initial)) throw new Error('BB_DISPLAY_BOARD_INVALID');
  let last = -Infinity;
  const ids = new Set<string>();
  for (const step of steps) {
    if (
      !step.actionId ||
      ids.has(step.actionId) ||
      !Number.isFinite(step.commitSeconds) ||
      !Number.isFinite(step.finalBoardSeconds) ||
      step.commitSeconds <= last ||
      step.finalBoardSeconds < step.commitSeconds ||
      !valid(step.placed) ||
      !valid(step.after)
    )
      throw new Error(`BB_DISPLAY_STEP_INVALID:${step.actionId}`);
    ids.add(step.actionId);
    last = step.commitSeconds;
  }
  return structuredClone({ initial, steps });
}

/** Uses the already sampled rule commit count; it does not run the rules again. */
export function evaluateBBDisplayBoard(
  plan: BBDisplayBoardTimeline,
  completedCount: number,
  timeSeconds: number,
): BBDisplayBoard {
  if (
    !Number.isInteger(completedCount) ||
    completedCount < 0 ||
    completedCount > plan.steps.length ||
    !Number.isFinite(timeSeconds) ||
    timeSeconds < 0
  )
    throw new Error('BB_DISPLAY_TIME_INVALID');
  if (completedCount === 0) return plan.initial.map((row) => [...row]);
  const step = plan.steps[completedCount - 1];
  if (!step || timeSeconds < step.commitSeconds) throw new Error('BB_DISPLAY_COMMIT_MISMATCH');
  return (timeSeconds < step.finalBoardSeconds ? step.placed : step.after).map((row) => [...row]);
}
