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
  return { session, state, advance: (ms: number) => (t += ms) };
}

/** Plays a full lesson submitting the correct answer to every card. */
function playPerfect(session: LearnSession, advance: (ms: number) => void) {
  advance(1000);
  let card = session.next();
  while (card) {
    if (card.type === "introduce") {
      session.submit("");
    } else if (card.type === "send-character") {
      session.submit(true);
    } else {
      session.submit(card.target);
    }
    advance(1000);
    card = session.next();
  }
}

describe("LearnSession active time", () => {
  it("accrues elapsed active time between events", () => {
    const { session } = freshSession();
    session.start(0);
    expect(session.end(10000).activeMs).toBe(10000);
  });

  it("clamps idle gaps to the idle threshold", () => {
    const { session } = freshSession();
    session.start(0);
    expect(session.end(200000).activeMs).toBe(60000);
  });

  it("excludes paused spans", () => {
    const { session } = freshSession();
    session.start(0);
    session.pause(30000);
    session.resume(80000);
    expect(session.end(85000).activeMs).toBe(35000);
  });

  it("marks a session invalid below the minimum active time", () => {
    const { session } = freshSession();
    session.start(0);
    expect(session.end(10000).valid).toBe(false);
  });
});

describe("LearnSession practice", () => {
  it("does not unlock characters from practice, even when perfect", () => {
    const { session, state, advance } = freshSession();
    session.start(0);
    playPerfect(session, advance);
    expect(session.unlockedNow).toEqual(["K", "M"]);
    expect(state.characters).toHaveLength(2);
  });

  it("introduces both starting characters and records no attempt for intros", () => {
    const { session, advance } = freshSession();
    session.start(0);

    let intros = 0;
    let card = session.next();
    while (card) {
      const before = session.summary().attempts;
      if (card.type === "introduce") {
        intros += 1;
        session.submit("");
        expect(session.summary().attempts).toBe(before); // no scored attempt
      } else if (card.type === "send-character") {
        session.submit(true);
      } else {
        session.submit(card.target);
      }
      advance(500);
      card = session.next();
    }
    expect(intros).toBe(2);
    expect(session.newlyIntroduced).toEqual(["K", "M"]);
  });

  it("counts cards and scored attempts separately", () => {
    const { session, advance } = freshSession();
    session.start(0);
    playPerfect(session, advance);
    const summary = session.summary();
    // Two introductions are cards but not scored attempts.
    expect(summary.cards).toBe(summary.attempts + 2);
  });

  it("inserts an immediate repeat after a missed isolated card", () => {
    const { session, advance } = freshSession();
    session.start(0);
    advance(1000);
    let card = session.next();
    while (card && card.phase !== "acquire") {
      session.submit("");
      advance(500);
      card = session.next();
    }
    expect(card?.type).toBe("copy-character");
    const before = session.totalCards;
    session.submit(""); // wrong answer
    expect(session.totalCards).toBe(before + 1);
  });

  it("does not re-introduce characters from earlier sessions", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const session = new LearnSession({
      state,
      rng: createRng(1),
      introduced: ["K", "M"],
    });
    expect(session.newlyIntroduced).toEqual([]);
  });
});
