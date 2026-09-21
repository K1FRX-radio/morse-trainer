import { describe, expect, it } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState } from "../core/curriculum.ts";
import { createRng } from "../core/rng.ts";
import { LearnSession } from "./learn-session.ts";

function freshSession(overrides = {}) {
  const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
  let t = 0;
  const now = () => t;
  const session = new LearnSession({
    state,
    rng: createRng(42),
    now,
    ...overrides,
  });
  return { session, state, advance: (ms: number) => (t += ms), at: () => t };
}

describe("LearnSession active time", () => {
  it("accrues elapsed active time between events", () => {
    const { session } = freshSession();
    session.start(0);
    const summary = session.end(10000);
    expect(summary.activeMs).toBe(10000);
  });

  it("clamps idle gaps to the idle threshold", () => {
    const { session } = freshSession();
    session.start(0);
    // A 200 s gap counts only up to the 60 s idle threshold.
    const summary = session.end(200000);
    expect(summary.activeMs).toBe(60000);
  });

  it("excludes paused spans", () => {
    const { session } = freshSession();
    session.start(0);
    session.pause(30000); // 30 s active so far
    session.resume(80000); // 50 s paused, excluded
    const summary = session.end(85000); // 5 s more active
    expect(summary.activeMs).toBe(35000);
  });

  it("marks a session invalid below the minimum active time", () => {
    const { session } = freshSession();
    session.start(0);
    const summary = session.end(10000);
    expect(summary.valid).toBe(false);
  });
});

describe("LearnSession progression", () => {
  it("unlocks the next character from correct RX copy", () => {
    const { session, advance } = freshSession({
      // Force single-character RX copy so RX observations accumulate.
      exerciseOptions: { txShare: 0, wordShare: 0, groupShare: 0 },
    });
    session.start(0);

    let unlocked: string | undefined;
    for (let i = 0; i < 400 && !unlocked; i++) {
      advance(2000);
      const exercise = session.next();
      const outcome = session.submit(
        exercise.type === "introduce" ? "" : exercise.target,
      );
      unlocked = outcome.unlockedCharacter;
    }

    expect(unlocked).toBe("U"); // K, M unlocked at start; U is next.
    expect(session.unlockedNow).toContain("U");
  });

  it("does not let TX failures block RX-driven unlocks", () => {
    const { session, advance } = freshSession({
      exerciseOptions: { txShare: 0.5, wordShare: 0, groupShare: 0 },
    });
    session.start(0);

    let unlocked: string | undefined;
    for (let i = 0; i < 800 && !unlocked; i++) {
      advance(1000);
      const exercise = session.next();
      if (exercise.type === "send-character") {
        session.submit(false); // always fail sending
      } else if (exercise.type === "introduce") {
        session.submit("");
      } else {
        const outcome = session.submit(exercise.target); // correct copy
        unlocked = outcome.unlockedCharacter;
      }
    }

    expect(unlocked).toBe("U");
  });

  it("records no attempt for an introduction", () => {
    const { session } = freshSession();
    session.start(0);
    // The first featured newest character is an introduction.
    let exercise = session.next();
    while (exercise.type !== "introduce") {
      session.submit(exercise.target);
      exercise = session.next();
    }
    const before = session.summary().attempts;
    session.submit("");
    expect(session.summary().attempts).toBe(before);
  });
});
