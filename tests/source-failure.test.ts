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
