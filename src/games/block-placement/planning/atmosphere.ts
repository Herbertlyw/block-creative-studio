import { resolvePraiseWord, PRAISE_WORDS } from '../../../nativeReference/domain/praiseWords';

/** Resolve eligibility once; effects retain their own independent sampling. */
export function screenAtmosphereAllowed(
  label: string,
  combo: number,
  lines: number,
  perfect = false,
): boolean {
  if (lines <= 0) return false;
  if (perfect) return true;
  const word = label.toLowerCase().replace(/[^a-z]/g, '');
  if ((PRAISE_WORDS as readonly string[]).includes(word)) return word !== 'good';
  return resolvePraiseWord(combo, lines) !== 'good';
}
