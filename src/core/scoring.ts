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
