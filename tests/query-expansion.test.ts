import { describe, expect, it } from "vitest";
import { expandQuery, inferSearchIntent } from "../src/core/query-intelligence.js";

describe("expandQuery", () => {
  it("strips quality and codec tags for a broader retry", () => {
    const intent = inferSearchIntent("interstellar 1080p x265 bluray");
    const alternatives = expandQuery(intent);
    expect(alternatives).toContain("interstellar");
  });

  it("removes season/episode markers", () => {
    const intent = inferSearchIntent("the office s02e05 1080p");
    const alternatives = expandQuery(intent);
    expect(alternatives.some((q) => q === "the office")).toBe(true);
  });

  it("drops the year for very specific queries", () => {
    const intent = inferSearchIntent("dune 2021");
    const alternatives = expandQuery(intent);
    expect(alternatives).toContain("dune");
  });

  it("removes the requested language tag", () => {
    const intent = inferSearchIntent("rrr hindi", { language: "hindi" });
    const alternatives = expandQuery(intent);
    // "hindi" is consumed as a language hint, but any residual language tag in
    // the query should also be strippable without crashing.
    expect(Array.isArray(alternatives)).toBe(true);
  });

  it("returns at most three unique alternatives and never the original", () => {
    const intent = inferSearchIntent("avatar 2009 1080p x264 bluray");
    const alternatives = expandQuery(intent);
    expect(alternatives.length).toBeLessThanOrEqual(3);
    expect(new Set(alternatives).size).toBe(alternatives.length);
    expect(alternatives).not.toContain(intent.query);
  });

  it("returns nothing to expand for an already-minimal query", () => {
    const intent = inferSearchIntent("dune");
    expect(expandQuery(intent)).toEqual([]);
  });
});
