// Standard international Morse mapping and pure encode/decode helpers.
// This module is framework- and DOM-free.

const CHAR_TO_PATTERN: Readonly<Record<string, string>> = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
  "0": "-----",
  "1": ".----",
  "2": "..---",
  "3": "...--",
  "4": "....-",
  "5": ".....",
  "6": "-....",
  "7": "--...",
  "8": "---..",
  "9": "----.",
  ".": ".-.-.-",
  ",": "--..--",
  "?": "..--..",
  "/": "-..-.",
  "!": "-.-.--",
  ":": "---...",
  "'": ".----.",
  "-": "-....-",
  "(": "-.--.",
  ")": "-.--.-",
  "+": ".-.-.",
  "=": "-...-",
  '"': ".-..-.",
};

const PATTERN_TO_CHAR: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(CHAR_TO_PATTERN).map(([char, pattern]) => [pattern, char]),
  ),
);

export const MORSE_CHARACTERS: readonly string[] = Object.freeze(
  Object.keys(CHAR_TO_PATTERN),
);

/** Returns the dit/dah pattern for a character, or undefined if unsupported. */
export function encodeCharacter(character: string): string | undefined {
  return CHAR_TO_PATTERN[character.toUpperCase()];
}

/** Returns the character for a dit/dah pattern, or undefined if unknown. */
export function decodePattern(pattern: string): string | undefined {
  return PATTERN_TO_CHAR[pattern];
}

/** True when the character has a defined Morse mapping. */
export function isSupportedCharacter(character: string): boolean {
  return encodeCharacter(character) !== undefined;
}

export type EncodedCharacter = {
  character: string;
  pattern: string;
};

/**
 * Encodes text into per-character patterns. A single space is treated as a
 * word boundary and encoded as `{ character: " ", pattern: "" }`. Unsupported
 * characters are skipped.
 */
export function encodeText(text: string): EncodedCharacter[] {
  const result: EncodedCharacter[] = [];
  for (const raw of text.toUpperCase()) {
    if (raw === " ") {
      result.push({ character: " ", pattern: "" });
      continue;
    }
    const pattern = CHAR_TO_PATTERN[raw];
    if (pattern !== undefined) {
      result.push({ character: raw, pattern });
    }
  }
  return result;
}
