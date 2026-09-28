import { describe, expect, it } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState, forceUnlockNext } from "../core/curriculum.ts";
import { createRng } from "../core/rng.ts";
import { LearnSession, type LessonEvent } from "./learn-session.ts";
import {
  DEFAULT_LESSON_CONFIG,
  type LessonPhase,
  type PlannedExercise,
} from "./lesson-plan.ts";

function isExercise(event: LessonEvent): event is PlannedExercise {
  return (
    event.type !== "transition" &&
    event.type !== "notification" &&
    event.type !== "continuous-copy"
  );
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
  } else if (event.type === "continuous-copy") {
    session.completeContinuousCopy(
      event.plan.gradingTarget,
      event.plan.scheduledDurationMs,
    );
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
  it("exposes stable phase identity for exercises and interstitials", () => {
    const { session } = freshSession();
    session.start(0);

    const introduction = session.next();
    expect(introduction?.phase).toBe("introduce");
    expect(session.currentPhaseId).toBe("introduce");

    const groups = advanceToPhase(session, "groups-2");
    expect(groups?.phase).toBe("groups-2");
    expect(session.currentPhaseId).toBe("groups-2");
  });

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

  it("reports card and aligned-character work separately", () => {
    const { session, advance } = freshSession({
      continuousCopyDurationMs: 1000,
    });
    session.start(0);
    playPerfect(session, advance);
    const summary = session.summary();

    expect(summary.isolatedPrompts).toBe(32);
    expect(summary.eligibleIsolatedObservations).toBe(32);
    expect(summary.eligibleIsolatedCorrect).toBe(32);
    expect(summary.isolatedAccuracy).toBe(1);
    expect(summary.hasMinimumIsolatedSample).toBe(true);
    expect(summary.groups).toBe(16);
    expect(summary.words).toBe(0);
    expect(summary.continuousCopyDurationMs).toBeGreaterThanOrEqual(1000);
    expect(summary.continuousRandomGroupTokens).toBeGreaterThan(0);
    expect(summary.continuousWordTokens).toBe(0);
    expect(summary.continuousTotalTokens).toBe(
      summary.continuousRandomGroupTokens + summary.continuousWordTokens,
    );
    expect(summary.continuousInsertions).toBe(0);
    expect(summary.continuousDeletions).toBe(0);
    expect(summary.continuousSubstitutions).toBe(0);
    expect(summary.charactersTransmitted).toBeGreaterThan(40);
    expect(summary.charactersTyped).toBe(summary.charactersTransmitted);
    expect(summary.alignedCorrectCharacters).toBe(
      summary.charactersTransmitted,
    );
    expect(summary.alignedCharacterAccuracy).toBe(1);
    expect(summary.excludedFromMastery).toBe(0);
    expect(summary.charactersNeedingReview).toEqual([]);
    expect(summary.advancementAssessment?.reason).toBe(
      "INSUFFICIENT_TOTAL_EVIDENCE",
    );
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

describe("LearnSession modes", () => {
  it("runs one continuous-copy event in review mode and still assesses readiness", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const session = new LearnSession({
      state,
      mode: "review",
      rng: createRng(17),
      continuousCopyDurationMs: 60000,
      sessionConfig: { idleThresholdMs: 60000, minActiveMs: 30000 },
      now: (() => {
        let now = 0;
        return () => (now += 30000);
      })(),
    });
    session.start(0);

    const event = session.next();
    expect(event?.type).toBe("continuous-copy");
    expect(session.next()).toBe(event);
    expect(session.totalCards).toBe(0);
    expect(session.newlyIntroduced).toEqual([]);
    if (event?.type !== "continuous-copy") {
      throw new Error("expected continuous copy");
    }

    session.completeContinuousCopy(
      event.plan.gradingTarget,
      event.plan.scheduledDurationMs,
    );

    expect(session.next()).toBeUndefined();
    expect(session.summary()).toMatchObject({
      mode: "review",
      cards: 0,
      attempts: 0,
      finalizedAttempts: 1,
      valid: true,
      isolatedPrompts: 0,
      groups: 0,
      words: 0,
      advancementAssessment: {
        eligible: true,
        reason: "READY",
        activeCharacters: ["K", "M"],
      },
    });
    expect(state.characters.map(({ character }) => character)).toEqual([
      "K",
      "M",
    ]);
  });

  it("generates a fresh continuous-copy stream for each review session", () => {
    const reviewPlan = (seed: number) => {
      const session = new LearnSession({
        state: createInitialState(DEFAULT_CURRICULUM_CONFIG),
        mode: "review",
        rng: createRng(seed),
        continuousCopyDurationMs: 60000,
      });
      session.start(0);
      const event = session.next();
      if (event?.type !== "continuous-copy") {
        throw new Error("expected continuous copy");
      }
      return event.plan;
    };

    const first = reviewPlan(17);
    const second = reviewPlan(18);
    expect(first.gradingTarget).not.toBe(second.gradingTarget);
    expect(new Set(first.gradingTarget)).toEqual(new Set(["K", "M"]));
    expect(new Set(second.gradingTarget)).toEqual(new Set(["K", "M"]));
  });

  it("keeps a full lesson as the default mode", () => {
    const session = new LearnSession({
      state: createInitialState(DEFAULT_CURRICULUM_CONFIG),
      rng: createRng(17),
    });
    session.start(0);

    expect(session.next()?.type).toBe("introduce");
    expect(session.summary().mode).toBe("learn");
    expect(session.totalCards).toBeGreaterThan(0);
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
    expect(session.summary().excludedFromMastery).toBe(1);
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
      phase: "groups-2",
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
      phase: "groups-3",
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

  it("transitions into one retained continuous-copy stream after groups", () => {
    const { session } = freshSession({
      introduced: ["K", "M"],
      continuousCopyDurationMs: 1000,
    });
    session.start(0);

    let event = session.next();
    while (
      event &&
      !(event.type === "transition" && event.id === "continuous-copy")
    ) {
      completeCorrect(session, event);
      event = session.next();
    }

    expect(event).toEqual({
      type: "transition",
      id: "continuous-copy",
      phase: "continuous-copy",
      title: "Ready for continuous copy?",
      text: "Type continuously while you listen. Keep going if you miss a character; the sound will not pause.",
      destinationPhase: "continuous-copy",
      actionLabel: "Go",
    });
    expect(session.phaseLabel).toBe("3-character groups");
    expect(session.next()).toBe(event);
    expect(session.continueTransition()).toBe(true);

    const stream = session.next();
    expect(stream?.type).toBe("continuous-copy");
    expect(session.phaseLabel).toBe("Continuous copy");
    expect(session.next()).toBe(stream);
    expect(session.currentExercise).toBeUndefined();
    expect(() => session.submit("")).toThrow(
      "submit called for a lesson interstitial",
    );
  });

  it("applies a completed stream without unlocking or clearing remediation", () => {
    const { session, state } = freshSession({
      introduced: ["K", "M"],
      continuousCopyDurationMs: 1000,
    });
    session.start(0);

    let event = session.next();
    while (event?.type !== "continuous-copy") {
      if (!event) throw new Error("expected continuous copy");
      completeCorrect(session, event);
      event = session.next();
    }
    state.characters[0].needsReview = true;
    state.characters[0].reviewStreak = 2;
    const unlockedBefore = state.characters.length;
    const result = session.completeContinuousCopy(
      event.plan.gradingTarget,
      event.plan.scheduledDurationMs,
    );

    expect(result.accuracy).toBe(1);
    expect(state.characters).toHaveLength(unlockedBefore);
    expect(state.characters[0].needsReview).toBe(true);
    expect(state.characters[0].reviewStreak).toBe(2);
    expect(session.summary().continuousCopyResult).toBe(result);
    expect(session.summary().advancementAssessment).toMatchObject({
      eligible: false,
      reason: "NEEDS_REVIEW",
      weakCharacter: "K",
    });
    expect(session.next()).toBeUndefined();
  });

  it("assesses a qualifying completed stream without unlocking", () => {
    const { session, state } = freshSession({
      introduced: ["K", "M"],
      continuousCopyDurationMs: 60000,
    });
    session.start(0);

    let event = session.next();
    while (event?.type !== "continuous-copy") {
      if (!event) throw new Error("expected continuous copy");
      completeCorrect(session, event);
      event = session.next();
    }
    const unlockedBefore = state.characters.map(
      (character) => character.character,
    );
    session.completeContinuousCopy(
      event.plan.gradingTarget,
      event.plan.scheduledDurationMs,
    );

    expect(session.summary().advancementAssessment).toMatchObject({
      eligible: true,
      reason: "READY",
      activeCharacters: ["K", "M"],
      nextCharacter: "U",
    });
    expect(state.characters.map((character) => character.character)).toEqual(
      unlockedBefore,
    );
  });

  it("records an abandoned stream without mastery observations", () => {
    const { session, state } = freshSession({
      introduced: ["K", "M"],
      continuousCopyDurationMs: 1000,
    });
    session.start(0);

    let event = session.next();
    while (event?.type !== "continuous-copy") {
      if (!event) throw new Error("expected continuous copy");
      completeCorrect(session, event);
      event = session.next();
    }
    const attemptsBefore = state.characters.map(
      (character) => character.rx.totalAttempts,
    );
    const result = session.completeContinuousCopy("K", 250, true);

    expect(result.abandoned).toBe(true);
    expect(result.accuracy).toBeNull();
    expect(
      state.characters.map((character) => character.rx.totalAttempts),
    ).toEqual(attemptsBefore);
    expect(session.summary().continuousCopyResult).toBe(result);
    expect(session.summary().advancementAssessment?.reason).toBe("ABANDONED");
    expect(session.summary().finalizedAttempts).toBe(
      session.summary().attempts,
    );
  });

  it("omits word copy when the active vocabulary pool is too small", () => {
    const { session } = freshSession({
      introduced: ["K", "M"],
      continuousCopyDurationMs: 1000,
    });
    session.start(0);
    let event = session.next();
    while (event) {
      completeCorrect(session, event);
      event = session.next();
    }
    expect(session.currentEvent).toBeUndefined();
  });

  it("runs eligible focused words before mixed continuous copy", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    while (state.characters.length < 10) forceUnlockNext(state);
    const active = state.characters.map((character) => character.character);
    const session = new LearnSession({
      state,
      rng: createRng(8),
      introduced: active,
      continuousCopyDurationMs: 60000,
    });
    session.start(0);

    let event = session.next();
    while (!(event?.type === "transition" && event.id === "word-copy")) {
      if (!event) throw new Error("expected word transition");
      completeCorrect(session, event);
      event = session.next();
    }

    expect(event).toEqual({
      type: "transition",
      id: "word-copy",
      phase: "words",
      title: "Ready to copy words?",
      text: "Now listen for complete word rhythms instead of separate characters.",
      destinationPhase: "words",
      actionLabel: "Go",
    });
    expect(session.phaseLabel).toBe("3-character groups");
    expect(session.next()).toBe(event);
    expect(session.continueTransition()).toBe(true);

    const words: string[] = [];
    event = session.next();
    while (event && isExercise(event)) {
      expect(event.type).toBe("copy-word");
      expect(event.phase).toBe("words");
      expect(
        [...event.target].every((character) => active.includes(character)),
      ).toBe(true);
      words.push(event.target);
      session.submit(event.target);
      event = session.next();
    }
    expect(words).toHaveLength(DEFAULT_LESSON_CONFIG.wordCopyCount);
    expect(new Set(words)).toHaveLength(words.length);
    expect(event).toEqual({
      type: "transition",
      id: "continuous-copy",
      phase: "continuous-copy",
      title: "Ready for continuous copy?",
      text: "Type continuously while you listen. Keep going if you miss a character; the sound will not pause.",
      destinationPhase: "continuous-copy",
      actionLabel: "Go",
    });
    expect(session.phaseLabel).toBe("Word copy");
    session.continueTransition();
    const stream = session.next();
    expect(stream?.type).toBe("continuous-copy");
    if (stream?.type === "continuous-copy") {
      expect(stream.plan.tokens.some((token) => token.kind === "word")).toBe(
        true,
      );
    }
  });

  it("keeps the word transition attempt-neutral", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    while (state.characters.length < 10) forceUnlockNext(state);
    const active = state.characters.map((character) => character.character);
    const session = new LearnSession({
      state,
      rng: createRng(18),
      introduced: active,
      continuousCopyDurationMs: 1000,
    });
    session.start(0);

    let event = session.next();
    while (!(event?.type === "transition" && event.id === "word-copy")) {
      if (!event) throw new Error("expected word transition");
      completeCorrect(session, event);
      event = session.next();
    }
    const before = session.summary();
    const observations = state.characters.map(
      (character) => character.rx.totalAttempts,
    );

    expect(session.continueTransition()).toBe(true);
    expect(session.summary()).toEqual(before);
    expect(
      state.characters.map((character) => character.rx.totalAttempts),
    ).toEqual(observations);
  });

  it("excludes replayed word copy from mastery and remediation", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    while (state.characters.length < 10) forceUnlockNext(state);
    const active = state.characters.map((character) => character.character);
    const session = new LearnSession({
      state,
      rng: createRng(9),
      introduced: active,
      continuousCopyDurationMs: 1000,
    });
    session.start(0);

    let event = session.next();
    while (!(event?.type === "transition" && event.id === "word-copy")) {
      if (!event) throw new Error("expected word transition");
      completeCorrect(session, event);
      event = session.next();
    }
    session.continueTransition();
    const word = session.next();
    if (!word || !isExercise(word)) throw new Error("expected word exercise");
    const observations = state.characters.map(
      (character) => character.rx.totalAttempts,
    );
    const reviewed = state.characters.find((character) =>
      word.target.includes(character.character),
    )!;
    reviewed.needsReview = true;
    reviewed.reviewStreak = 2;
    session.markReplayed();
    session.submit(word.target);

    expect(
      state.characters.map((character) => character.rx.totalAttempts),
    ).toEqual(observations);
    expect(reviewed.needsReview).toBe(true);
    expect(reviewed.reviewStreak).toBe(2);
  });
});
