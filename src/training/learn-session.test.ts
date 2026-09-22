import { describe, expect, it } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState, forceUnlockNext } from "../core/curriculum.ts";
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

  it("updates per-character mastery from group answers via alignment", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const session = new LearnSession({ state, rng: createRng(5) });
    session.start(0);
    const group = advanceToPhase(session, "groups");
    expect(group?.type).toBe("copy-group");
    const focus = group?.focus ?? "";
    const before =
      state.characters.find((c) => c.character === focus)?.rx.recentResults
        .length ?? 0;
    session.submit(group?.target ?? ""); // correct group
    const after =
      state.characters.find((c) => c.character === focus)?.rx.recentResults
        .length ?? 0;
    expect(after).toBeGreaterThan(before);
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

describe("LearnSession remediation", () => {
  function toAcquire(session: LearnSession) {
    let card = session.next();
    while (card && card.phase !== "acquire") {
      session.submit(card.type === "introduce" ? "" : card.target);
      card = session.next();
    }
    return card;
  }

  it("does not clear a review flag from a replayed correct response", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const session = new LearnSession({ state, rng: createRng(1) });
    session.start(0);
    const card = toAcquire(session);
    const focus = state.characters.find((c) => c.character === card?.focus);
    focus!.needsReview = true;
    focus!.reviewStreak = 2; // one clean correct away from clearing
    session.markReplayed();
    session.submit(card?.target ?? ""); // replayed correct must not count
    expect(focus!.needsReview).toBe(true);
    expect(focus!.reviewStreak).toBe(2);
  });

  it("does not clear a review flag from an assisted correct response", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const session = new LearnSession({ state, rng: createRng(1) });
    session.start(0);
    const card = toAcquire(session);
    const focus = state.characters.find((c) => c.character === card?.focus);
    focus!.needsReview = true;
    session.submit(""); // miss inserts an assisted repeat
    const assisted = session.next();
    expect(assisted?.assisted).toBe(true);
    focus!.reviewStreak = 2;
    session.submit(assisted?.target ?? ""); // assisted correct must not count
    expect(focus!.needsReview).toBe(true);
    expect(focus!.reviewStreak).toBe(2);
  });

  it("clears a review flag after a clean remediation streak", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    state.characters[0].needsReview = true; // K flagged
    const session = new LearnSession({
      state,
      rng: createRng(1),
      introduced: ["K", "M"],
    });
    session.start(0);
    let card = session.next();
    while (card) {
      session.submit(card.type === "introduce" ? "" : card.target); // all correct
      card = session.next();
    }
    expect(state.characters[0].needsReview).toBe(false);
  });

  it("leaves the review flag set when remediation is incomplete", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    state.characters[0].needsReview = true; // K flagged
    const session = new LearnSession({
      state,
      rng: createRng(1),
      introduced: ["K", "M"],
    });
    session.start(0);
    // Answer only the first remediation prompt, then stop early.
    let card = session.next();
    while (card && card.phase !== "remediate") {
      session.submit(card.type === "introduce" ? "" : card.target);
      card = session.next();
    }
    session.submit(card?.target ?? ""); // one clean correct only
    expect(state.characters[0].needsReview).toBe(true);
  });

  it("preserves incomplete remediation into the next lesson", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    state.characters[0].needsReview = true;
    const first = new LearnSession({
      state,
      rng: createRng(1),
      introduced: ["K", "M"],
    });
    first.start(0);
    const card = first.next();
    first.submit(card?.target ?? "");
    first.end(1000);

    const next = new LearnSession({
      state,
      rng: createRng(2),
      introduced: ["K", "M"],
    });
    next.start(0);
    expect(next.next()?.phase).toBe("remediate");
    expect(state.characters[0].needsReview).toBe(true);
  });

  it("does not clear isolated remediation from a correct group result", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const session = new LearnSession({ state, rng: createRng(5) });
    session.start(0);
    let group = session.next();
    while (group && group.phase !== "groups") {
      session.submit(group.type === "introduce" ? "" : group.target);
      group = session.next();
    }
    const progress = state.characters.find((character) =>
      group?.target.includes(character.character),
    );
    progress!.needsReview = true;
    progress!.reviewStreak = 2;

    session.submit(group?.target ?? "");
    expect(progress!.needsReview).toBe(true);
    expect(progress!.reviewStreak).toBe(2);
  });
});

describe("LearnSession adaptive acquisition", () => {
  it("marks a character for continued review after the acquisition cap", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    forceUnlockNext(state);
    const session = new LearnSession({
      state,
      rng: createRng(3),
      introduced: ["K", "M"],
    });
    session.start(0);

    let card = session.next();
    while (card && card.phase !== "contrast") {
      if (card.type === "introduce") session.submit("");
      else session.submit(card.assisted ? card.target : "");
      card = session.next();
    }

    const newest = state.characters.find(
      (character) => character.character === "U",
    );
    expect(newest?.needsReview).toBe(true);
    expect(newest?.reviewStreak).toBe(0);
    expect(card?.phase).toBe("contrast");
  });
});
