import { z } from "zod";
import { normalizeCopy } from "../core/scoring.ts";
import type { TrainingAttemptRecord, TrainingSessionRecord } from "./models.ts";
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

export function parseTrainingSessions(value: unknown): TrainingSessionRecord[] {
  return z
    .array(trainingSessionRecordSchema)
    .parse(value) as TrainingSessionRecord[];
}

export function parseTrainingAttempts(value: unknown): TrainingAttemptRecord[] {
  return z
    .array(trainingAttemptRecordSchema)
    .parse(value) as TrainingAttemptRecord[];
}

export function parseSchemaMetadata(value: unknown): SchemaMetadataRecord {
  return schemaMetadataRecordSchema.parse(value) as SchemaMetadataRecord;
}
