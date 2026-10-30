import { describe, expect, it } from "vitest";
import { HttpError } from "../src/services/http-client.js";
import {
  describeSourceFailure,
  sourceFailureLabel,
} from "../src/services/source-failure.js";

describe("source failure reporting", () => {
  it("classifies access denials separately from a network failure", () => {
    const failure = describeSourceFailure(
      new HttpError("HTTP 403", 403, "https://example.test"),
    );

    expect(failure).toEqual({ kind: "blocked", message: "Blocked (HTTP 403)" });
  });

  it("names bot-check pages instead of calling the site blocked or down", () => {
    const failure = describeSourceFailure(
      new HttpError("HTTP 403 (bot check)", 403, "https://example.test", undefined, true),
    );

    expect(failure.kind).toBe("blocked");
    expect(failure.message).toMatch(/Bot check \(HTTP 403\)/);
  });

  it("classifies paywalled sources as payment_required", () => {
    const failure = describeSourceFailure(
      new HttpError("HTTP 402", 402, "https://example.test"),
    );

    expect(failure).toEqual({
      kind: "payment_required",
      message: "Payment required (HTTP 402)",
    });
    expect(sourceFailureLabel({ error: failure.message, failureKind: failure.kind, resultCount: 0 })).toBe("paid");
  });

  it("classifies rate limits and syntax changes", () => {
    expect(
      describeSourceFailure(new HttpError("HTTP 429", 429, "https://example.test")),
    ).toEqual({ kind: "rate_limited", message: "Rate limited (HTTP 429)" });
    expect(
      describeSourceFailure(new SyntaxError("Unexpected token <")),
    ).toEqual({ kind: "invalid_response", message: "Invalid response" });
    expect(
      describeSourceFailure(new Error("socket hang up")),
    ).toEqual({ kind: "network", message: "socket hang up" });
    expect(
      describeSourceFailure(new HttpError("HTTP 500", 500, "https://example.test")),
    ).toEqual({ kind: "unavailable", message: "HTTP 500" });
  });

  it("reports a source deadline as a timeout", () => {
    const failure = describeSourceFailure(
      new DOMException("The operation was aborted", "AbortError"),
      true,
    );

    expect(failure).toEqual({ kind: "timeout", message: "Timed out" });
  });

  it("uses concise labels in the terminal status strip", () => {
    expect(
      sourceFailureLabel({
        error: "Timed out",
        failureKind: "timeout",
        resultCount: 0,
      }),
    ).toBe("timeout");
    expect(sourceFailureLabel({ resultCount: 3 })).toBe("3");
  });
});
