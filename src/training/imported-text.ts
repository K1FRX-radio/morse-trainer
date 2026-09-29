import { isSupportedCharacter } from "../core/morse.ts";

export const MAX_IMPORTED_TEXT_LENGTH = 10000;

export type ImportedTextPlan = {
  normalizedText: string;
  chunks: string[];
  totalWords: number;
  unsupportedCharacters: string[];
};

export function createImportedTextPlan(
  input: string,
  maxLength = MAX_IMPORTED_TEXT_LENGTH,
): ImportedTextPlan {
  if (input.length > maxLength) {
    throw new RangeError(`input length cannot exceed ${maxLength} characters`);
  }

  const normalizedWhitespace = input.replace(/\s+/g, " ").trim();
  if (normalizedWhitespace.length === 0) {
    return {
      normalizedText: "",
      chunks: [],
      totalWords: 0,
      unsupportedCharacters: [],
    };
  }

  const unsupportedCharacters: string[] = [];
  const unsupportedSeen = new Set<string>();
  const accepted: string[] = [];

  for (const raw of normalizedWhitespace) {
    if (raw === " ") {
      accepted.push(raw);
      continue;
    }
    const upper = raw.toUpperCase();
    if (isSupportedCharacter(upper)) {
      accepted.push(upper);
      continue;
    }
    if (!unsupportedSeen.has(raw)) {
      unsupportedSeen.add(raw);
      unsupportedCharacters.push(raw);
    }
  }

  const normalizedText = accepted.join("").replace(/ +/g, " ").trim();
  if (normalizedText.length === 0) {
    return {
      normalizedText: "",
      chunks: [],
      totalWords: 0,
      unsupportedCharacters,
    };
  }

  const words = normalizedText.split(" ");
  const chunks = words.map((word, index) =>
    index === words.length - 1 ? word : `${word} `,
  );

  return {
    normalizedText,
    chunks,
    totalWords: words.length,
    unsupportedCharacters,
  };
}
