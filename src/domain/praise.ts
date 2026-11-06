export type BlastPraiseTierId = 'good' | 'great' | 'amazing' | 'fantastic' | 'unbelievable';

/** Reference candy-blast tiers. Combo and line count share this ladder; cell count is not a tier input. */
export function blastPraiseTier(combo: number, lineCount: number): BlastPraiseTierId {
  if (combo >= 8 || lineCount >= 4) return 'unbelievable';
  if (combo >= 6 || lineCount >= 3) return 'fantastic';
  if (combo >= 4) return 'amazing';
  if (combo >= 3) return 'great';
  return 'good';
}

export function praiseLabel(combo: number, lineCount: number): string {
  const tier = blastPraiseTier(combo, lineCount);
  if (tier === 'good') return 'Good!';
  if (tier === 'great') return 'Great!';
  if (tier === 'amazing') return 'Amazing!';
  if (tier === 'fantastic') return 'Fantastic!';
  return 'Unbelievable!';
}
