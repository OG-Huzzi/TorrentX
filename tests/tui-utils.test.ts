import { describe, expect, it } from "vitest";
import { createResult } from "../src/sources/source-utils.js";
import {
  nextResultSort,
  sortResults,
  visibleWindow,
  wrapIndex,
} from "../src/ui/tui-utils.js";

describe("TUI result behavior", () => {
  const low = createResult({
    title: "Low",
    source: "test",
    sourceReliability: 0.8,
    seeders: 2,
  });
  const high = createResult({
    title: "High",
    source: "test",
    sourceReliability: 0.8,
    seeders: 100,
  });
  low.score = 90;
  high.score = 50;

  it("cycles sorts and applies each order without mutating input", () => {
    const input = [low, high];
    expect(nextResultSort("rank")).toBe("seeds");
    expect(sortResults(input, "rank").map((result) => result.title)).toEqual(["Low", "High"]);
    expect(sortResults(input, "seeds").map((result) => result.title)).toEqual(["High", "Low"]);
    expect(input.map((result) => result.title)).toEqual(["Low", "High"]);
  });

  it("wraps navigation and keeps the selection inside the visible window", () => {
    expect(wrapIndex(0, -1, 5)).toBe(4);
    expect(wrapIndex(4, 1, 5)).toBe(0);
    expect(visibleWindow(7, 10, 4)).toBe(5);
    expect(visibleWindow(1, 10, 4)).toBe(0);
  });
});
