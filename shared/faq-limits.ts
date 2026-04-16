export const FAQ_PAIR_MAX_CHARS = 2_000;
export const FAQ_SET_MAX_CHARS = 10_000;
export const FAQ_DESCRIPTION_MAX_CHARS = 500;

export function getFaqPairLength(pair: { question: string; answer: string }): number {
  return pair.question.length + pair.answer.length;
}

export function getFaqSetTotalLength(
  pairs: Array<{ question: string; answer: string }>,
): number {
  return pairs.reduce((sum, pair) => sum + getFaqPairLength(pair), 0);
}

export function isFaqSetOverLimit(
  pairs: Array<{ question: string; answer: string }>,
): boolean {
  return getFaqSetTotalLength(pairs) > FAQ_SET_MAX_CHARS;
}

export function isFaqPairOverLimit(pair: {
  question: string;
  answer: string;
}): boolean {
  return getFaqPairLength(pair) > FAQ_PAIR_MAX_CHARS;
}
