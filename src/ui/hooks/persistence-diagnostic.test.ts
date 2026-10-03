import { describe, expect, it } from "vitest";
import { toPersistenceDiagnostic } from "./persistence-diagnostic.ts";

describe("toPersistenceDiagnostic", () => {
  it("preserves stable error names and messages", () => {
    const error = Object.assign(new Error("transaction was aborted"), {
      name: "AbortError",
    });

    expect(toPersistenceDiagnostic("attempt", 1, error)).toMatchObject({
      operation: "attempt",
      retryCount: 1,
      retryable: true,
      userMessage:
        "Your session could not be saved. Check storage access and try again.",
      name: "AbortError",
      message: "transaction was aborted",
      summary:
        "Save failed (attempt): AbortError - transaction was aborted | retries: 1",
    });
  });

  it("marks explicit non-retryable causes and maps to internal-save guidance", () => {
    const error = Object.assign(
      new Error("invalid Learn persistence snapshot"),
      {
        name: "LearnPersistencePreflightError",
        retryable: false,
      },
    );

    expect(toPersistenceDiagnostic("finalization", 0, error)).toMatchObject({
      operation: "finalization",
      retryable: false,
      userMessage:
        "This lesson could not be saved because of an internal save error. End this lesson and start a new one.",
      name: "LearnPersistencePreflightError",
    });
  });

  it("safely handles unknown causes", () => {
    expect(toPersistenceDiagnostic("finalization", 0, undefined)).toMatchObject(
      {
        operation: "finalization",
        retryCount: 0,
        retryable: true,
        userMessage:
          "Your session could not be saved. Check storage access and try again.",
        summary: "Save failed (finalization): UnknownError | retries: 0",
      },
    );
  });
});
