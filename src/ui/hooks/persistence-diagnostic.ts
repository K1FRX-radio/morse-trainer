export type PersistenceOperationCategory =
  "attempt" | "finalization" | "advancement" | "session-start";

export type PersistenceDiagnostic = {
  operation: PersistenceOperationCategory;
  retryCount: number;
  name?: string;
  message?: string;
  summary: string;
};

type ErrorLike = {
  name?: unknown;
  message?: unknown;
};

function stringField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function errorFields(cause: unknown): {
  name?: string;
  message?: string;
} {
  if (cause instanceof Error) {
    const name = stringField(cause.name);
    const message = stringField(cause.message);
    return {
      ...(name ? { name } : {}),
      ...(message ? { message } : {}),
    };
  }
  if (cause && typeof cause === "object") {
    const value = cause as ErrorLike;
    const name = stringField(value.name);
    const message = stringField(value.message);
    return {
      ...(name ? { name } : {}),
      ...(message ? { message } : {}),
    };
  }
  return {};
}

export function toPersistenceDiagnostic(
  operation: PersistenceOperationCategory,
  retryCount: number,
  cause: unknown,
): PersistenceDiagnostic {
  const { name, message } = errorFields(cause);
  const errorName = name ?? "UnknownError";
  const errorMessage = message ? ` - ${message}` : "";
  return {
    operation,
    retryCount,
    ...(name ? { name } : {}),
    ...(message ? { message } : {}),
    summary: `Save failed (${operation}): ${errorName}${errorMessage} | retries: ${retryCount}`,
  };
}
