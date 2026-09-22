// Pure copy-grading helpers shared by Learn and Practice.

export type CopyGrade = {
  /** True only when the answer matches the target exactly, character for character. */
  correct: boolean;
  /** Per-position correctness against the target. */
  perChar: boolean[];
};

export type DetailedCopyGrade = CopyGrade & {
  targetCharacters: number;
  typedCharacters: number;
  alignedCorrect: number;
  insertions: number;
  deletions: number;
  substitutions: number;
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
  const detailed = gradeCopyDetailed(target, answer);
  return { correct: detailed.correct, perChar: detailed.perChar };
}

/**
 * Detailed deterministic edit-distance alignment. Distance calculation keeps
 * only two rows while one byte per matrix cell preserves the chosen backtrack
 * direction, keeping long continuous-copy streams responsive and bounded.
 */
export function gradeCopyDetailed(
  target: string,
  answer: string,
): DetailedCopyGrade {
  const t = normalizeCopy(target);
  const a = normalizeCopy(answer);
  const n = t.length;
  const m = a.length;

  // 0 = diagonal, 1 = target deletion, 2 = answer insertion.
  const directions = new Uint8Array(n * m);
  let previous = new Uint32Array(m + 1);
  let current = new Uint32Array(m + 1);
  for (let j = 0; j <= m; j++) previous[j] = j;
  for (let i = 1; i <= n; i++) {
    current[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = t[i - 1] === a[j - 1] ? 0 : 1;
      const diagonal = previous[j - 1] + cost;
      const deletion = previous[j] + 1;
      const insertion = current[j - 1] + 1;
      const index = (i - 1) * m + (j - 1);
      if (diagonal <= deletion && diagonal <= insertion) {
        current[j] = diagonal;
        directions[index] = 0;
      } else if (deletion <= insertion) {
        current[j] = deletion;
        directions[index] = 1;
      } else {
        current[j] = insertion;
        directions[index] = 2;
      }
    }
    [previous, current] = [current, previous];
  }

  // Backtrack, crediting target positions that align to an equal answer char.
  const perChar = new Array<boolean>(n).fill(false);
  let alignedCorrect = 0;
  let insertions = 0;
  let deletions = 0;
  let substitutions = 0;
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const direction = directions[(i - 1) * m + (j - 1)];
    if (direction === 0) {
      if (t[i - 1] === a[j - 1]) {
        perChar[i - 1] = true;
        alignedCorrect += 1;
      } else {
        substitutions += 1;
      }
      i -= 1;
      j -= 1;
    } else if (direction === 1) {
      deletions += 1;
      i -= 1;
    } else {
      insertions += 1;
      j -= 1;
    }
  }
  deletions += i;
  insertions += j;

  return {
    correct: a === t,
    perChar,
    targetCharacters: n,
    typedCharacters: m,
    alignedCorrect,
    insertions,
    deletions,
    substitutions,
  };
}
