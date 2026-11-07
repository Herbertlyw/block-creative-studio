import type { ReferencePassId } from '../headless/contracts';
import { REFERENCE_PASS_ORDER } from '../headless/contracts';

export { REFERENCE_PASS_ORDER };
export type { ReferencePassId };

export function isPassEnabled(enabled: readonly ReferencePassId[] | undefined, pass: ReferencePassId): boolean {
  if (!enabled || enabled.length === 0) return true;
  return enabled.includes(pass);
}

export const PRAISE_PASS: ReferencePassId = 'feedback';

export const PASS_RESPONSIBILITIES: Record<ReferencePassId, string> = {
  background: 'Background gradient, uploaded image, ambient petals',
  board: 'Board frame, slots and empty cell wells',
  tile: 'Occupied tile bodies and faces',
  tray: 'Candidate rack pieces',
  interaction: 'Pickup, drag, ghost and pre-clear fill',
  placement: 'Placement confirmation glow and thumb',
  clear: 'Clear sweep, sparks and cell exit',
  feedback: 'HUD, score, praise and combo',
  endgame: 'Continue / game-over modal',
};
