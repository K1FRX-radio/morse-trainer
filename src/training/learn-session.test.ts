import { describe, expect, it } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState, forceUnlockNext } from "../core/curriculum.ts";
import { createRng } from "../core/rng.ts";
import { LearnSession, type LessonEvent } from "./learn-session.ts";
import type { LessonPhase, PlannedExercise } from "./lesson-plan.ts";

function isExercise(event: LessonEvent): event is PlannedExercise {
  return event.type !== "transition" && event.type !== "notification";
}

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

function completeCorrect(session: LearnSession, event: LessonEvent): void {
  if (event.type === "transition") {
    session.continueTransition();
  } else if (event.type === "notification") {
    session.continueNotification();
  } else if (event.type === "introduce") {
    session.submit("");
  } else if (event.type === "send-character") {
    session.submit(true);
  } else {
    session.submit(event.target);
  }
}

function advanceToPhase(
  session: LearnSession,
  phase: LessonPhase,
): PlannedExercise | undefined {
  let event = session.next();
  while (event) {
    if (isExercise(event) && event.phase === phase) return event;
    completeCorrect(session, event);
    event = session.next();
  }
  return undefined;
}

/** Plays a full lesson submitting the correct answer to every card. */
function playPerfect(session: LearnSession, advance: (ms: number) => void) {
  advance(1000);
  let card = session.next();
  while (card) {
    completeCorrect(session, card);
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
      if (!isExercise(card)) {
        completeCorrect(session, card);
        expect(session.summary().attempts).toBe(before);
      } else if (card.type === "introduce") {
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
    const card = advanceToPhase(session, "acquire");
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
    const group = advanceToPhase(session, "groups-2");
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
    const assistedEvent = session.next();
    expect(assistedEvent && isExercise(assistedEvent)).toBe(true);
    if (!assistedEvent || !isExercise(assistedEvent)) {
      throw new Error("expected assisted exercise");
    }
    const assisted = assistedEvent;
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
    return advanceToPhase(session, "acquire");
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
    const assistedEvent = session.next();
    expect(assistedEvent && isExercise(assistedEvent)).toBe(true);
    if (!assistedEvent || !isExercise(assistedEvent)) {
      throw new Error("expected assisted exercise");
    }
    const assisted = assistedEvent;
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
      completeCorrect(session, card);
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
    const card = advanceToPhase(session, "remediate");
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
    expect(card && isExercise(card)).toBe(true);
    if (!card || !isExercise(card)) {
      throw new Error("expected remediation exercise");
    }
    first.submit(card.target);
    first.end(1000);

    const next = new LearnSession({
      state,
      rng: createRng(2),
      introduced: ["K", "M"],
    });
    next.start(0);
    const nextEvent = next.next();
    expect(nextEvent && isExercise(nextEvent)).toBe(true);
    if (nextEvent && isExercise(nextEvent)) {
      expect(nextEvent?.phase).toBe("remediate");
    }
    expect(state.characters[0].needsReview).toBe(true);
  });

  it("does not clear isolated remediation from a correct group result", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const session = new LearnSession({ state, rng: createRng(5) });
    session.start(0);
    const group = advanceToPhase(session, "groups-2");
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

    let event = session.next();
    while (event && (!isExercise(event) || event.phase !== "contrast")) {
      if (!isExercise(event)) completeCorrect(session, event);
      else if (event.type === "introduce") session.submit("");
      else session.submit(event.assisted ? event.target : "");
      event = session.next();
    }

    const newest = state.characters.find(
      (character) => character.character === "U",
    );
    expect(newest?.needsReview).toBe(true);
    expect(newest?.reviewStreak).toBe(0);
    expect(event?.phase).toBe("contrast");
  });
});

describe("LearnSession transitions", () => {
  function toMultiCharacterTransition(session: LearnSession) {
    let event = session.next();
    while (event && event.type !== "transition") {
      completeCorrect(session, event);
      event = session.next();
    }
    return event;
  }

  it("emits stable transition metadata before the first group", () => {
    const { session } = freshSession();
    session.start(0);

    expect(toMultiCharacterTransition(session)).toEqual({
      type: "transition",
      id: "multi-character-copy",
      title: "Ready for something longer?",
      text: "You’ve learned the individual sounds. Now copy several characters without stopping between them.",
      destinationPhase: "groups-2",
      actionLabel: "Go",
    });
  });

  it("records no card, attempt, or mastery data for a transition", () => {
    const { session, state } = freshSession();
    session.start(0);
    const transition = toMultiCharacterTransition(session);
    const before = session.summary();
    const observations = state.characters.map(
      (character) => character.rx.totalAttempts,
    );

    expect(() => session.submit("")).toThrow(
      "submit called for a lesson interstitial",
    );
    expect(session.summary()).toEqual(before);
    session.continueTransition();
    expect(session.summary()).toEqual(before);
    expect(
      state.characters.map((character) => character.rx.totalAttempts),
    ).toEqual(observations);
    expect(transition?.type).toBe("transition");
  });

  it("advances to the retained group only after the transition continues", () => {
    const { session } = freshSession();
    session.start(0);
    toMultiCharacterTransition(session);

    expect(session.currentExercise).toBeUndefined();
    expect(session.next()?.type).toBe("transition");
    expect(session.continueTransition()).toBe(true);
    expect(session.continueTransition()).toBe(false);
    const group = session.next();
    expect(group?.type).toBe("copy-group");
    if (group?.type === "copy-group") {
      expect(group.phase).toBe("groups-2");
    }
  });

  it("reports persistent labels from the current lesson event", () => {
    const { session } = freshSession();
    session.start(0);
    const first = session.next();
    expect(first?.type).toBe("introduce");
    expect(session.phaseLabel).toBe("Learning K");

    while (session.currentEvent?.type !== "transition") {
      const event = session.currentEvent;
      if (event) completeCorrect(session, event);
      session.next();
    }
    expect(session.phaseLabel).toBe("Single-character copy");

    session.continueTransition();
    const group = session.next();
    expect(group?.type).toBe("copy-group");
    if (group?.type === "copy-group") {
      expect(session.phaseLabel).toBe(
        `${group.target.length}-character groups`,
      );
    }
  });

  it("announces three-character groups without recording an attempt", () => {
    const { session, state } = freshSession({ introduced: ["K", "M"] });
    session.start(0);
    toMultiCharacterTransition(session);
    session.continueTransition();

    let event = session.next();
    while (event && event.type !== "notification") {
      completeCorrect(session, event);
      event = session.next();
    }
    const before = session.summary();
    const observations = state.characters.map(
      (character) => character.rx.totalAttempts,
    );

    expect(event).toEqual({
      type: "notification",
      id: "three-character-groups",
      title: "Now copying 3-character groups",
      destinationPhase: "groups-3",
      actionLabel: "Go",
      delayMs: 1800,
    });
    expect(session.next()).toBe(event);
    expect(() => session.submit("")).toThrow(
      "submit called for a lesson interstitial",
    );
    expect(session.summary()).toEqual(before);
    expect(session.continueNotification()).toBe(true);
    expect(session.continueNotification()).toBe(false);
    expect(
      state.characters.map((character) => character.rx.totalAttempts),
    ).toEqual(observations);
    const group = session.next();
    expect(group?.type).toBe("copy-group");
    if (group?.type === "copy-group") {
      expect(group.phase).toBe("groups-3");
      expect(group.target).toHaveLength(3);
      expect(session.phaseLabel).toBe("3-character groups");
    }
  });
});
