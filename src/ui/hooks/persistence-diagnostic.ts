export type PersistenceOperationCategory =
  "attempt" | "finalization" | "advancement" | "session-start";

export type PersistenceDiagnostic = {
  operation: PersistenceOperationCategory;
  retryCount: number;
  retryable: boolean;
  userMessage: string;
  name?: string;
  message?: string;
  summary: string;
};

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  retryable?: unknown;
};

const RETRYABLE_MESSAGE =
  "Your session could not be saved. Check storage access and try again.";
const NON_RETRYABLE_MESSAGE =
  "This lesson could not be saved because of an internal save error. End this lesson and start a new one.";

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

function isRetryable(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return true;
  const maybeError = cause as ErrorLike;
  return maybeError.retryable !== false;
}

export function toPersistenceDiagnostic(
  operation: PersistenceOperationCategory,
  retryCount: number,
  cause: unknown,
): PersistenceDiagnostic {
  const { name, message } = errorFields(cause);
  const retryable = isRetryable(cause);
  const errorName = name ?? "UnknownError";
  const errorMessage = message ? ` - ${message}` : "";
  return {
    operation,
    retryCount,
    retryable,
    userMessage: retryable ? RETRYABLE_MESSAGE : NON_RETRYABLE_MESSAGE,
    ...(name ? { name } : {}),
    ...(message ? { message } : {}),
    summary: `Save failed (${operation}): ${errorName}${errorMessage} | retries: ${retryCount}`,
  };
}
