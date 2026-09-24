import { z } from "zod";
import { KOCH_ORDER } from "../content/curriculum-data.ts";
import { normalizeCopy } from "../core/scoring.ts";
import { isValidTrainingSession } from "../core/session-validity.ts";
import { SETTING_RANGES } from "../core/settings.ts";
import type {
  CurriculumStateRecord,
  IntroductionsRecord,
  LegacyMigrationBundle,
  TrainingAttemptRecord,
  TrainingSessionRecord,
} from "./models.ts";
import {
  RECORD_SCHEMA_VERSION,
  SCORING_ALGORITHM_VERSION,
  type SchemaMetadataRecord,
} from "./models.ts";

const utcTimestampSchema = z.string().datetime({ offset: true });
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const capturedDateTimeSchema = z
  .object({
    utc: utcTimestampSchema,
    localDate: localDateSchema,
    utcOffsetMinutes: z
      .number()
      .int()
      .min(-14 * 60)
      .max(14 * 60),
    timeZone: z.string().min(1).optional(),
  })
  .strict();

const persistedRecordSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(RECORD_SCHEMA_VERSION),
  updatedAt: utcTimestampSchema,
});

const activeDateBucketSchema = z
  .object({
    localDate: localDateSchema,
    utcOffsetMinutes: z
      .number()
      .int()
      .min(-14 * 60)
      .max(14 * 60),
    timeZone: z.string().min(1).optional(),
    activeMs: z.number().finite().nonnegative(),
  })
  .strict();

export const trainingSessionRecordSchema = persistedRecordSchema
  .extend({
    source: z.enum(["learn", "copy-practice", "send-practice"]),
    mode: z.enum(["learn", "copy", "send", "review"]),
    status: z.enum(["active", "completed", "interrupted"]),
    startedAt: capturedDateTimeSchema,
    endedAt: capturedDateTimeSchema.optional(),
    activeMs: z.number().finite().nonnegative(),
    activeDateBuckets: z.array(activeDateBucketSchema),
    attemptCount: z.number().int().nonnegative(),
    completedCards: z.number().int().nonnegative(),
    valid: z.boolean(),
    charWpm: z.number().finite().positive(),
    effectiveWpm: z.number().finite().positive(),
    toneHz: z.number().finite().positive(),
    noiseLevel: z.number().finite().min(0).max(1),
    unlockedAtStart: z.array(z.string()),
    unlockedAtEnd: z.array(z.string()).optional(),
    appVersion: z.string().min(1),
    revision: z.number().int().nonnegative(),
    ownerTabId: z.string().min(1).optional(),
    leaseExpiresAt: utcTimestampSchema.optional(),
    finalizationKey: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((session, context) => {
    const allowedModes = {
      learn: ["learn", "review"],
      "copy-practice": ["copy"],
      "send-practice": ["send"],
    }[session.source];
    if (!allowedModes.includes(session.mode)) {
      context.addIssue({
        code: "custom",
        path: ["mode"],
        message: `${session.source} sessions cannot use ${session.mode} mode`,
      });
    }
    if (session.effectiveWpm > session.charWpm) {
      context.addIssue({
        code: "custom",
        path: ["effectiveWpm"],
        message: "effective WPM cannot exceed character WPM",
      });
    }
    const expectedValidity = isValidTrainingSession(session);
    if (session.valid !== expectedValidity) {
      context.addIssue({
        code: "custom",
        path: ["valid"],
        message:
          "valid must require at least 30 seconds active and one finalized attempt",
      });
    }
    const bucketTotal = session.activeDateBuckets.reduce(
      (total, bucket) => total + bucket.activeMs,
      0,
    );
    if (Math.abs(bucketTotal - session.activeMs) > 0.001) {
      context.addIssue({
        code: "custom",
        path: ["activeDateBuckets"],
        message: "active date buckets must sum to activeMs",
      });
    }
    if (session.status === "active" && session.endedAt !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "active sessions cannot have an end time",
      });
    }
    if (session.status !== "active" && session.endedAt === undefined) {
      context.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "terminal sessions require an end time",
      });
    }
    if (
      session.endedAt !== undefined &&
      session.endedAt.utc < session.startedAt.utc
    ) {
      context.addIssue({
        code: "custom",
        path: ["endedAt", "utc"],
        message: "session end cannot precede its start",
      });
    }
  });

const alignmentObservationSchema = z
  .object({
    kind: z.enum(["match", "substitution", "deletion", "insertion"]),
    correct: z.boolean(),
    targetIndex: z.number().int().nonnegative().optional(),
    target: z.string().optional(),
    answerIndex: z.number().int().nonnegative().optional(),
    answer: z.string().optional(),
  })
  .strict()
  .superRefine((observation, context) => {
    const hasTarget =
      observation.target !== undefined && observation.targetIndex !== undefined;
    const hasAnswer =
      observation.answer !== undefined && observation.answerIndex !== undefined;
    const addIssue = (message: string): void => {
      context.addIssue({ code: "custom", message });
    };

    if (
      (observation.target === undefined) !==
      (observation.targetIndex === undefined)
    ) {
      addIssue("target and targetIndex must appear together");
    }
    if (
      (observation.answer === undefined) !==
      (observation.answerIndex === undefined)
    ) {
      addIssue("answer and answerIndex must appear together");
    }
    if (
      observation.target !== undefined &&
      [...observation.target].length !== 1
    ) {
      addIssue("target must contain exactly one character");
    }
    if (
      observation.answer !== undefined &&
      [...observation.answer].length !== 1
    ) {
      addIssue("answer must contain exactly one character");
    }

    switch (observation.kind) {
      case "match":
        if (
          !observation.correct ||
          !hasTarget ||
          !hasAnswer ||
          observation.target !== observation.answer
        ) {
          addIssue("matches require equal target and answer characters");
        }
        break;
      case "substitution":
        if (
          observation.correct ||
          !hasTarget ||
          !hasAnswer ||
          observation.target === observation.answer
        ) {
          addIssue(
            "substitutions require different target and answer characters",
          );
        }
        break;
      case "deletion":
        if (observation.correct || !hasTarget || hasAnswer) {
          addIssue("deletions require only a target character");
        }
        break;
      case "insertion":
        if (observation.correct || hasTarget || !hasAnswer) {
          addIssue("insertions require only an answer character");
        }
        break;
    }
  });

const encodedKeyingTimingSchema = z
  .object({
    encoding: z.literal("u32-ms-le-v1"),
    marks: z.string(),
    spaces: z.string(),
    originalMarkCount: z.number().int().nonnegative(),
    originalSpaceCount: z.number().int().nonnegative(),
    timingTruncated: z.boolean(),
    timingOverflowed: z.boolean(),
    ditEstimateMs: z.number().finite().positive().optional(),
  })
  .strict();

export const trainingAttemptRecordSchema = persistedRecordSchema
  .extend({
    sessionId: z.string().min(1),
    occurredAt: capturedDateTimeSchema,
    source: z.enum(["learn", "copy-practice", "send-practice"]),
    direction: z.enum(["rx", "tx"]),
    exerciseType: z.enum([
      "copy-character",
      "copy-group",
      "copy-word",
      "continuous-copy",
      "send-character",
      "send-word",
    ]),
    rawTarget: z.string(),
    rawResponse: z.string(),
    normalizedTarget: z.string(),
    normalizedResponse: z.string(),
    correct: z.boolean(),
    assisted: z.boolean(),
    replayed: z.boolean(),
    abandoned: z.boolean(),
    scoringAlgorithmVersion: z.literal(SCORING_ALGORITHM_VERSION),
    observations: z.array(alignmentObservationSchema),
    schedulerReason: z
      .enum([
        "NEW_CHARACTER",
        "WEAK_RX",
        "WEAK_TX",
        "CONFUSION_REVIEW",
        "SPACED_REVIEW",
        "BALANCED_PRACTICE",
      ])
      .optional(),
    responseMs: z.number().finite().nonnegative().optional(),
    durationMs: z.number().finite().nonnegative().optional(),
    keying: encodedKeyingTimingSchema.optional(),
    charWpm: z.number().finite().positive(),
    effectiveWpm: z.number().finite().positive(),
    toneHz: z.number().finite().positive(),
    noiseLevel: z.number().finite().min(0).max(1),
  })
  .strict()
  .superRefine((attempt, context) => {
    const addIssue = (path: PropertyKey[], message: string): void => {
      context.addIssue({ code: "custom", path, message });
    };
    const expectedDirection = attempt.source === "send-practice" ? "tx" : "rx";
    if (attempt.direction !== expectedDirection) {
      addIssue(
        ["direction"],
        `${attempt.source} attempts require ${expectedDirection} direction`,
      );
    }
    const sending = attempt.exerciseType.startsWith("send-");
    if ((attempt.direction === "tx") !== sending) {
      addIssue(
        ["exerciseType"],
        `${attempt.direction} attempts use ${attempt.direction === "tx" ? "send" : "copy"} exercises`,
      );
    }

    const normalizedTarget = normalizeCopy(attempt.rawTarget);
    const normalizedResponse = normalizeCopy(attempt.rawResponse);
    if (attempt.normalizedTarget !== normalizedTarget) {
      addIssue(
        ["normalizedTarget"],
        "normalized target must match the raw target",
      );
    }
    if (attempt.normalizedResponse !== normalizedResponse) {
      addIssue(
        ["normalizedResponse"],
        "normalized response must match the raw response",
      );
    }
    if (normalizedTarget.length === 0) {
      addIssue(["rawTarget"], "attempt target cannot be empty");
    }

    if (attempt.abandoned) {
      if (attempt.correct) {
        addIssue(["correct"], "abandoned attempts cannot be correct");
      }
      if (attempt.observations.length > 0) {
        addIssue(
          ["observations"],
          "abandoned attempts cannot contain scored observations",
        );
      }
      return;
    }

    if (attempt.correct !== (normalizedTarget === normalizedResponse)) {
      addIssue(
        ["correct"],
        "attempt correctness must match normalized target and response",
      );
    }

    const targetCharacters = [...normalizedTarget];
    const responseCharacters = [...normalizedResponse];
    const targetIndexes = new Set<number>();
    const answerIndexes = new Set<number>();
    attempt.observations.forEach((observation, observationIndex) => {
      if (observation.targetIndex !== undefined) {
        if (targetIndexes.has(observation.targetIndex)) {
          addIssue(
            ["observations", observationIndex, "targetIndex"],
            "target indexes must be unique",
          );
        }
        targetIndexes.add(observation.targetIndex);
        if (targetCharacters[observation.targetIndex] !== observation.target) {
          addIssue(
            ["observations", observationIndex, "target"],
            "observation target must match normalizedTarget at targetIndex",
          );
        }
      }
      if (observation.answerIndex !== undefined) {
        if (answerIndexes.has(observation.answerIndex)) {
          addIssue(
            ["observations", observationIndex, "answerIndex"],
            "answer indexes must be unique",
          );
        }
        answerIndexes.add(observation.answerIndex);
        if (
          responseCharacters[observation.answerIndex] !== observation.answer
        ) {
          addIssue(
            ["observations", observationIndex, "answer"],
            "observation answer must match normalizedResponse at answerIndex",
          );
        }
      }
    });

    if (targetIndexes.size !== targetCharacters.length) {
      addIssue(
        ["observations"],
        "observations must cover every normalized target character",
      );
    }
    if (answerIndexes.size !== responseCharacters.length) {
      addIssue(
        ["observations"],
        "observations must cover every normalized response character",
      );
    }
  });

export const schemaMetadataRecordSchema = persistedRecordSchema
  .extend({
    id: z.literal("schema-metadata"),
    databaseVersion: z.number().int().positive(),
    datasetGeneration: z.string().min(1),
  })
  .strict();

const practiceSettingsSchema = z
  .object({
    charWpm: z
      .number()
      .finite()
      .min(SETTING_RANGES.charWpm.min)
      .max(SETTING_RANGES.charWpm.max),
    effectiveWpm: z
      .number()
      .finite()
      .min(SETTING_RANGES.effectiveWpm.min)
      .max(SETTING_RANGES.effectiveWpm.max),
    toneHz: z
      .number()
      .finite()
      .min(SETTING_RANGES.toneHz.min)
      .max(SETTING_RANGES.toneHz.max),
    volume: z
      .number()
      .finite()
      .min(SETTING_RANGES.volume.min)
      .max(SETTING_RANGES.volume.max),
    noiseLevel: z
      .number()
      .finite()
      .min(SETTING_RANGES.noiseLevel.min)
      .max(SETTING_RANGES.noiseLevel.max),
    pacing: z.enum(["auto", "manual"]),
    continuousCopyDurationMs: z.union([
      z.literal(60000),
      z.literal(180000),
      z.literal(300000),
      z.literal(600000),
    ]),
  })
  .strict()
  .refine((settings) => settings.effectiveWpm <= settings.charWpm, {
    path: ["effectiveWpm"],
    message: "effective WPM cannot exceed character WPM",
  });

const skillProgressSchema = z
  .object({
    totalAttempts: z.number().int().nonnegative(),
    recentResults: z.array(z.boolean()),
  })
  .strict();

const characterProgressSchema = z
  .object({
    character: z.string().min(1),
    state: z.enum(["locked", "learning", "mastered"]),
    needsReview: z.boolean(),
    reviewStreak: z.number().int().nonnegative().optional(),
    rx: skillProgressSchema,
    tx: skillProgressSchema,
    unlockedAt: utcTimestampSchema.optional(),
    masteredAt: utcTimestampSchema.optional(),
    lastPracticedAt: utcTimestampSchema.optional(),
  })
  .strict();

const portableSettingsRecordSchema = persistedRecordSchema
  .extend({
    id: z.literal("portable-settings"),
    value: practiceSettingsSchema,
  })
  .strict();

const curriculumStateRecordSchema = persistedRecordSchema
  .extend({
    id: z.literal("curriculum-state"),
    order: z.array(z.string()).min(1),
    startCount: z.number().int().positive(),
    windowSize: z.number().int().positive(),
    minNewCharObservations: z.number().int().positive(),
    reviewDecayAccuracy: z.number().finite().min(0).max(1),
    characters: z.array(characterProgressSchema),
  })
  .strict()
  .superRefine((curriculum, context) => {
    if (
      curriculum.order.length !== KOCH_ORDER.length ||
      curriculum.order.some(
        (character, index) => character !== KOCH_ORDER[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["order"],
        message: "curriculum order must match the supported Koch order",
      });
    }
    if (
      curriculum.startCount > curriculum.order.length ||
      curriculum.characters.length < curriculum.startCount ||
      curriculum.characters.length > curriculum.order.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["characters"],
        message: "curriculum character count is outside its configured bounds",
      });
    }
    curriculum.characters.forEach((progress, index) => {
      if (progress.character !== curriculum.order[index]) {
        context.addIssue({
          code: "custom",
          path: ["characters", index, "character"],
          message: "curriculum characters must be an ordered prefix",
        });
      }
      if (progress.state === "locked") {
        context.addIssue({
          code: "custom",
          path: ["characters", index, "state"],
          message: "persisted curriculum characters must be unlocked",
        });
      }
      for (const direction of ["rx", "tx"] as const) {
        const skill = progress[direction];
        if (skill.recentResults.length > curriculum.windowSize) {
          context.addIssue({
            code: "custom",
            path: ["characters", index, direction, "recentResults"],
            message: "recent results exceed the curriculum window",
          });
        }
        if (skill.totalAttempts < skill.recentResults.length) {
          context.addIssue({
            code: "custom",
            path: ["characters", index, direction, "totalAttempts"],
            message: "total attempts cannot be smaller than recent results",
          });
        }
      }
    });
  });

const introductionsRecordSchema = persistedRecordSchema
  .extend({
    id: z.literal("completed-introductions"),
    characters: z.array(z.string()),
  })
  .strict();

const progressionEventRecordSchema = persistedRecordSchema
  .extend({
    idempotencyKey: z.string().min(1),
    type: z.enum([
      "advancement-accepted",
      "mastery-recorded",
      "curriculum-completed",
    ]),
    occurredAt: capturedDateTimeSchema,
    sessionId: z.string().min(1).optional(),
    evidenceAttemptId: z.string().min(1).optional(),
    activeCharacters: z.array(z.string()),
    masteredCharacters: z.array(z.string()),
    unlockedCharacter: z.string().optional(),
    migrationDerived: z.boolean(),
  })
  .strict();

const milestoneRecordSchema = persistedRecordSchema
  .extend({
    idempotencyKey: z.string().min(1),
    eventId: z.string().min(1),
    type: z.enum([
      "character-mastered",
      "character-unlocked",
      "curriculum-completed",
    ]),
    occurredAt: capturedDateTimeSchema,
    character: z.string().optional(),
    migrationDerived: z.boolean(),
  })
  .strict();

const migrationLedgerRecordSchema = persistedRecordSchema
  .extend({
    kind: z.literal("migration"),
    migration: z.string().min(1),
    completedAt: utcTimestampSchema,
  })
  .strict();

const legacyMigrationBundleSchema = z
  .object({
    settings: portableSettingsRecordSchema,
    curriculum: curriculumStateRecordSchema,
    introductions: introductionsRecordSchema,
    progressionEvents: z.array(progressionEventRecordSchema),
    milestones: z.array(milestoneRecordSchema),
    ledger: migrationLedgerRecordSchema,
  })
  .strict()
  .superRefine((bundle, context) => {
    const eventIds = new Set<string>();
    const eventKeys = new Set<string>();
    bundle.progressionEvents.forEach((event, index) => {
      if (eventIds.has(event.id)) {
        context.addIssue({
          code: "custom",
          path: ["progressionEvents", index, "id"],
          message: `duplicate progression event id ${event.id}`,
        });
      }
      if (eventKeys.has(event.idempotencyKey)) {
        context.addIssue({
          code: "custom",
          path: ["progressionEvents", index, "idempotencyKey"],
          message: `duplicate progression event key ${event.idempotencyKey}`,
        });
      }
      eventIds.add(event.id);
      eventKeys.add(event.idempotencyKey);
    });

    const milestoneIds = new Set<string>();
    const milestoneKeys = new Set<string>();
    bundle.milestones.forEach((milestone, index) => {
      if (milestoneIds.has(milestone.id)) {
        context.addIssue({
          code: "custom",
          path: ["milestones", index, "id"],
          message: `duplicate milestone id ${milestone.id}`,
        });
      }
      if (milestoneKeys.has(milestone.idempotencyKey)) {
        context.addIssue({
          code: "custom",
          path: ["milestones", index, "idempotencyKey"],
          message: `duplicate milestone key ${milestone.idempotencyKey}`,
        });
      }
      if (!eventIds.has(milestone.eventId)) {
        context.addIssue({
          code: "custom",
          path: ["milestones", index, "eventId"],
          message: `milestone references unknown event ${milestone.eventId}`,
        });
      }
      milestoneIds.add(milestone.id);
      milestoneKeys.add(milestone.idempotencyKey);
    });

    const activeCharacters = new Set(
      bundle.curriculum.characters.map((progress) => progress.character),
    );
    bundle.introductions.characters.forEach((character, index) => {
      if (!activeCharacters.has(character)) {
        context.addIssue({
          code: "custom",
          path: ["introductions", "characters", index],
          message: `introduced character ${character} is not unlocked`,
        });
      }
      if (bundle.introductions.characters.indexOf(character) !== index) {
        context.addIssue({
          code: "custom",
          path: ["introductions", "characters", index],
          message: `introduced character ${character} is duplicated`,
        });
      }
    });
  });

const trainingDatasetSchema = z
  .object({
    sessions: z.array(trainingSessionRecordSchema),
    attempts: z.array(trainingAttemptRecordSchema),
  })
  .strict()
  .superRefine((dataset, context) => {
    const sessionsById = new Map<string, (typeof dataset.sessions)[number]>();
    for (const [index, session] of dataset.sessions.entries()) {
      if (sessionsById.has(session.id)) {
        context.addIssue({
          code: "custom",
          path: ["sessions", index, "id"],
          message: `duplicate session id ${session.id}`,
        });
      }
      sessionsById.set(session.id, session);
    }

    const attemptIds = new Set<string>();
    const attemptsPerSession = new Map<string, number>();
    for (const [index, attempt] of dataset.attempts.entries()) {
      if (attemptIds.has(attempt.id)) {
        context.addIssue({
          code: "custom",
          path: ["attempts", index, "id"],
          message: `duplicate attempt id ${attempt.id}`,
        });
      }
      attemptIds.add(attempt.id);

      const session = sessionsById.get(attempt.sessionId);
      if (!session) {
        context.addIssue({
          code: "custom",
          path: ["attempts", index, "sessionId"],
          message: `attempt references unknown session ${attempt.sessionId}`,
        });
        continue;
      }
      if (attempt.source !== session.source) {
        context.addIssue({
          code: "custom",
          path: ["attempts", index, "source"],
          message: "attempt source must match its session source",
        });
      }
      attemptsPerSession.set(
        attempt.sessionId,
        (attemptsPerSession.get(attempt.sessionId) ?? 0) + 1,
      );
    }

    dataset.sessions.forEach((session, index) => {
      const storedAttempts = attemptsPerSession.get(session.id) ?? 0;
      if (session.attemptCount !== storedAttempts) {
        context.addIssue({
          code: "custom",
          path: ["sessions", index, "attemptCount"],
          message: `attemptCount ${session.attemptCount} does not match ${storedAttempts} stored attempts`,
        });
      }
    });
  });

export function parseTrainingSessions(value: unknown): TrainingSessionRecord[] {
  return z
    .array(trainingSessionRecordSchema)
    .parse(value) as TrainingSessionRecord[];
}

export function parseTrainingSession(value: unknown): TrainingSessionRecord {
  return trainingSessionRecordSchema.parse(value) as TrainingSessionRecord;
}

export function parseTrainingAttempts(value: unknown): TrainingAttemptRecord[] {
  return z
    .array(trainingAttemptRecordSchema)
    .parse(value) as TrainingAttemptRecord[];
}

export function parseTrainingAttempt(value: unknown): TrainingAttemptRecord {
  return trainingAttemptRecordSchema.parse(value) as TrainingAttemptRecord;
}

export function parseTrainingDataset(
  sessions: unknown,
  attempts: unknown,
): {
  sessions: TrainingSessionRecord[];
  attempts: TrainingAttemptRecord[];
} {
  return trainingDatasetSchema.parse({ sessions, attempts }) as {
    sessions: TrainingSessionRecord[];
    attempts: TrainingAttemptRecord[];
  };
}

export function parseSchemaMetadata(value: unknown): SchemaMetadataRecord {
  return schemaMetadataRecordSchema.parse(value) as SchemaMetadataRecord;
}

export function parseLegacyMigrationBundle(
  value: unknown,
): LegacyMigrationBundle {
  return legacyMigrationBundleSchema.parse(value) as LegacyMigrationBundle;
}

export function parseMigrationLedger(value: unknown) {
  return migrationLedgerRecordSchema.parse(value);
}

export function parseCurriculumStateRecord(
  value: unknown,
): CurriculumStateRecord {
  return curriculumStateRecordSchema.parse(value) as CurriculumStateRecord;
}

export function parseIntroductionsRecord(value: unknown): IntroductionsRecord {
  return introductionsRecordSchema.parse(value) as IntroductionsRecord;
}
