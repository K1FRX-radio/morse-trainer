// Pure copy-grading helpers shared by Learn and Practice.

export type CopyGrade = {
  /** True only when the answer matches the target exactly, character for character. */
  correct: boolean;
  /** Per-position correctness against the target. */
  perChar: boolean[];
};

/** Uppercases and removes whitespace so copy answers compare cleanly. */
export function normalizeCopy(text: string): string {
  return text.toUpperCase().replace(/\s+/g, "");
}

/** Grades a copy answer against a target, aligning by character position. */
export function gradeCopy(target: string, answer: string): CopyGrade {
  const t = normalizeCopy(target);
  const a = normalizeCopy(answer);
  const perChar = [...t].map((char, index) => a[index] === char);
  const correct = a.length === t.length && perChar.every(Boolean);
  return { correct, perChar };
}

/**
 * Aligns each target character to the answer with edit-distance alignment, so an
 * inserted or dropped character does not mark everything after it wrong. perChar
 * credits target positions matched by the alignment; correct still requires an
 * exact match. Use for multi-character groups and words.
 *
 * Tie-breaking is deterministic: backtracking runs from the end and, among
 * equal-cost steps, prefers a diagonal match/substitution, then a target
 * deletion, then an answer insertion. For repeated characters this credits the
 * right-most matching occurrences, and a single insertion or deletion stays
 * confined to one target position instead of shifting all later characters.
 */
export function gradeCopyAligned(target: string, answer: string): CopyGrade {
  const t = normalizeCopy(target);
  const a = normalizeCopy(answer);
  const n = t.length;
  const m = a.length;

  // Edit-distance DP table.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = t[i - 1] === a[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  // Backtrack, crediting target positions that align to an equal answer char.
  const perChar = new Array<boolean>(n).fill(false);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const cost = t[i - 1] === a[j - 1] ? 0 : 1;
    if (dp[i][j] === dp[i - 1][j - 1] + cost) {
      if (cost === 0) perChar[i - 1] = true;
      i -= 1;
      j -= 1;
    } else if (dp[i][j] === dp[i - 1][j] + 1) {
      i -= 1; // target character dropped from the answer
    } else {
      j -= 1; // extra character inserted in the answer
    }
  }

  return { correct: a === t, perChar };
}
