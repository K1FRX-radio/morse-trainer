import { describe, expect, it } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import {
  createInitialState,
  newestCharacter,
  recordAttempt,
  unlockNext,
  unlockedCharacters,
  type CurriculumState,
} from "./curriculum.ts";
import { nextExercise } from "./exercises.ts";
import { createRng } from "./rng.ts";

function stateWithUnlocked(count: number): CurriculumState {
  const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
  while (state.characters.length < count) {
    const newest = newestCharacter(state);
    if (!newest) break;
    for (let i = 0; i < DEFAULT_CURRICULUM_CONFIG.minNewCharObservations; i++) {
      recordAttempt(state, newest.character, "rx", true);
    }
    unlockNext(state);
  }
  return state;
}

describe("nextExercise", () => {
  it("is deterministic for a seed", () => {
    const state = stateWithUnlocked(8);
    const a = nextExercise(state, createRng(11));
    const b = nextExercise(state, createRng(11));
    expect(a).toEqual(b);
  });

  it("never targets a locked character across 10,000 seeded draws", () => {
    const state = stateWithUnlocked(8);
    const allowed = new Set(unlockedCharacters(state));
    const rng = createRng(2024);
    for (let i = 0; i < 10000; i++) {
      const exercise = nextExercise(state, rng);
      for (const char of exercise.target) {
        expect(allowed.has(char)).toBe(true);
      }
    }
  });

  it("introduces the newest character first, then stops once introduced", () => {
    const fresh = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const newest = newestCharacter(fresh)?.character;

    const rng = createRng(7);
    let firstIntro;
    for (let i = 0; i < 200 && !firstIntro; i++) {
      const exercise = nextExercise(fresh, rng);
      if (exercise.type === "introduce") {
        firstIntro = exercise;
      }
    }
    expect(firstIntro).toBeDefined();
    expect(firstIntro?.target).toBe(newest);
    expect(firstIntro?.direction).toBe("rx");
    expect(firstIntro?.reason).toBe("NEW_CHARACTER");

    // Once the newest is marked introduced, no introduction is emitted.
    const introduced = new Set(newest ? [newest] : []);
    const rng2 = createRng(7);
    for (let i = 0; i < 200; i++) {
      const exercise = nextExercise(fresh, rng2, { introduced });
      expect(exercise.type).not.toBe("introduce");
    }
  });

  it("emits sending drills with tx direction", () => {
    const state = stateWithUnlocked(6);
    const rng = createRng(3);
    let sawTx = false;
    for (let i = 0; i < 200; i++) {
      const exercise = nextExercise(state, rng, { introduced: new Set() });
      if (exercise.type === "send-character") {
        expect(exercise.direction).toBe("tx");
        sawTx = true;
      } else {
        expect(exercise.direction).toBe("rx");
      }
    }
    expect(sawTx).toBe(true);
  });

  it("produces word exercises drawn only from unlocked characters", () => {
    const state = stateWithUnlocked(8);
    const allowed = new Set(unlockedCharacters(state));
    const rng = createRng(99);
    let sawWord = false;
    for (let i = 0; i < 500; i++) {
      const exercise = nextExercise(state, rng, { wordShare: 1, txShare: 0 });
      if (exercise.type === "copy-word") {
        sawWord = true;
        for (const char of exercise.target) {
          expect(allowed.has(char)).toBe(true);
        }
      }
    }
    expect(sawWord).toBe(true);
  });
});
