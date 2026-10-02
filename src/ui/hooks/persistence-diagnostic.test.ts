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
      name: "AbortError",
      message: "transaction was aborted",
      summary:
        "Save failed (attempt): AbortError - transaction was aborted | retries: 1",
    });
  });

  it("safely handles unknown causes", () => {
    expect(toPersistenceDiagnostic("finalization", 0, undefined)).toMatchObject(
      {
        operation: "finalization",
        retryCount: 0,
        summary: "Save failed (finalization): UnknownError | retries: 0",
      },
    );
  });
});
