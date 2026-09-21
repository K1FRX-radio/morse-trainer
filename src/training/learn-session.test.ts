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

describe("LearnSession Stage A fixes", () => {
  function advanceToPhase(session: LearnSession, phase: string) {
    let card = session.next();
    while (card && card.phase !== phase) {
      session.submit(
        card.type === "introduce"
          ? ""
          : card.type === "send-character"
            ? true
            : card.target,
      );
      card = session.next();
    }
    return card;
  }

  it("persists only introductions actually completed", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const session = new LearnSession({ state, rng: createRng(1) });
    session.start(0);
    const first = session.next();
    expect(first?.type).toBe("introduce");
    session.submit(""); // complete only the K introduction
    expect(session.completedIntroductions).toEqual(["K"]);
    expect(session.newlyIntroduced).toEqual(["K", "M"]); // planned, not completed
  });

  it("does not update per-character mastery from group answers", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const session = new LearnSession({ state, rng: createRng(5) });
    session.start(0);
    const group = advanceToPhase(session, "groups");
    expect(group?.type).toBe("copy-group");
    const before = state.characters.map((c) => c.rx.recentResults.length);
    session.submit(group?.target ?? "");
    const after = state.characters.map((c) => c.rx.recentResults.length);
    expect(after).toEqual(before);
  });

  it("excludes assisted reinforcement cards from mastery and scoring", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const session = new LearnSession({ state, rng: createRng(1) });
    session.start(0);
    const acquire = advanceToPhase(session, "acquire");
    expect(acquire?.type).toBe("copy-character");
    session.submit(""); // miss -> inserts an assisted repeat
    const attemptsBefore = session.summary().attempts;
    const assisted = session.next();
    expect(assisted?.assisted).toBe(true);
    const focus = assisted?.focus ?? "";
    const rxBefore =
      state.characters.find((c) => c.character === focus)?.rx.recentResults
        .length ?? 0;
    session.submit(assisted?.target ?? ""); // correct, but assisted
    const rxAfter =
      state.characters.find((c) => c.character === focus)?.rx.recentResults
        .length ?? 0;
    expect(rxAfter).toBe(rxBefore);
    expect(session.summary().attempts).toBe(attemptsBefore);
  });

  it("excludes a replayed answer from mastery", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const session = new LearnSession({ state, rng: createRng(1) });
    session.start(0);
    const acquire = advanceToPhase(session, "acquire");
    const focus = acquire?.focus ?? "";
    const rxBefore =
      state.characters.find((c) => c.character === focus)?.rx.recentResults
        .length ?? 0;
    session.markReplayed();
    session.submit(acquire?.target ?? ""); // correct, but replayed
    const rxAfter =
      state.characters.find((c) => c.character === focus)?.rx.recentResults
        .length ?? 0;
    expect(rxAfter).toBe(rxBefore);
  });
});
