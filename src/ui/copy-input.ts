import { isSupportedCharacter } from "../core/morse.ts";

export function sanitizeCopyInput(value: string): string {
  return [...value.toUpperCase()].filter(isSupportedCharacter).join("");
}
