import { z } from "zod";
import type { TrainingAttemptRecord, TrainingSessionRecord } from "./models.ts";

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
  schemaVersion: z.number().int().positive(),
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
  .strict();

const alignmentObservationSchema = z
  .object({
    kind: z.enum(["match", "substitution", "deletion", "insertion"]),
    correct: z.boolean(),
    targetIndex: z.number().int().nonnegative().optional(),
    target: z.string().optional(),
    answerIndex: z.number().int().nonnegative().optional(),
    answer: z.string().optional(),
  })
  .strict();

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
    scoringAlgorithmVersion: z.string().min(1),
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
