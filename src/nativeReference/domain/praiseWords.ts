import { blastPraiseTier, type BlastPraiseTierId } from './types';

export const PRAISE_WORDS = ['good', 'great', 'excellent', 'amazing', 'perfect', 'fantastic', 'unbelievable'] as const;
export type PraiseWord = typeof PRAISE_WORDS[number];
export type PraiseWordMap = Partial<Record<BlastPraiseTierId, PraiseWord>>;
export const PRAISE_TIERS = ['good', 'great', 'amazing', 'fantastic', 'unbelievable'] as const;
export const PRAISE_WORD_MAP_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: Object.fromEntries(PRAISE_TIERS.map(tier => [tier, { enum: [...PRAISE_WORDS] }])),
} as const;

export function parsePraiseWords(value: unknown): PraiseWordMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PRAISE_WORDS_INVALID');
  const result: PraiseWordMap = {};
  for (const [tier, word] of Object.entries(value)) {
    if (!PRAISE_TIERS.includes(tier as BlastPraiseTierId) || !PRAISE_WORDS.includes(word as PraiseWord)) {
      throw new Error(`PRAISE_WORD_INVALID: ${tier}=${String(word)}`);
    }
    result[tier as BlastPraiseTierId] = word as PraiseWord;
  }
  return result;
}

export function resolvePraiseWord(combo: number, lines: number, words?: PraiseWordMap): PraiseWord {
  const tier = blastPraiseTier(combo, lines);
  return words?.[tier] ?? tier;
}

export function praiseWordLabel(word: PraiseWord): string {
  return `${word[0]!.toUpperCase()}${word.slice(1)}!`;
}
