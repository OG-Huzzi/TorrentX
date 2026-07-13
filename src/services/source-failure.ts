import type { SourceFailureKind, SourceRun } from "../types/search.js";
import { HttpError } from "./http-client.js";

export interface SourceFailure {
  kind: SourceFailureKind;
  message: string;
}

export function describeSourceFailure(
  error: unknown,
  timedOut = false,
): SourceFailure {
  if (timedOut) {
    return { kind: "timeout", message: "Timed out" };
  }

  if (error instanceof HttpError) {
    if (error.status === 429) {
      return { kind: "rate_limited", message: "Rate limited (HTTP 429)" };
    }
    if (error.status === 401 || error.status === 403 || error.status === 451) {
      return { kind: "blocked", message: `Blocked (HTTP ${error.status})` };
    }
    return { kind: "unavailable", message: `HTTP ${error.status}` };
  }

  if (hasName(error, "AbortError")) {
    return { kind: "cancelled", message: "Cancelled" };
  }
  if (hasName(error, "SyntaxError")) {
    return { kind: "invalid_response", message: "Invalid response" };
  }

  return { kind: "network", message: errorMessage(error) };
}

export function sourceFailureLabel(
  run: Pick<SourceRun, "error" | "failureKind" | "resultCount">,
): string {
  if (!run.error) return String(run.resultCount);

  switch (run.failureKind) {
    case "blocked":
      return "blocked";
    case "cancelled":
      return "cancelled";
    case "invalid_response":
      return "changed";
    case "rate_limited":
      return "limited";
    case "timeout":
      return "timeout";
    case "unavailable":
      return "unavailable";
    case "network":
    default:
      return "unreachable";
  }
}

function hasName(value: unknown, name: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    (value as { name?: unknown }).name === name
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Network request failed";
}
