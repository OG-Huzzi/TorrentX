import { describe, expect, it } from "vitest";
import { applyFilters } from "../src/services/filter-service.js";
import type { SearchResult } from "../src/types/search.js";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: `id-${Math.random()}`,
    title: "Example",
    source: "yts",
    seeders: 50,
    leechers: 5,
    trusted: true,
    sourceReliability: 0.9,
    score: 0,
    ...overrides,
  };
}

describe("applyFilters", () => {
  it("applies the language filter only when the result language is known", () => {
    const hindi = result({ language: "hindi" });
    const english = result({ language: "english" });
    const unknown = result({});

    const out = applyFilters([hindi, english, unknown], { language: "hindi" });
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.language)).toContain("hindi");
    expect(out.some((r) => r.language === undefined)).toBe(true);
  });

  it("does not drop anything when no language filter is set", () => {
    const results = [result({ language: "hindi" }), result({ language: "english" }), result()];
    expect(applyFilters(results, {})).toHaveLength(3);
  });

  it("matches language case-insensitively and by substring", () => {
    const tamil = result({ language: "Tamil" });
    expect(applyFilters([tamil], { language: "tam" })).toHaveLength(1);
    expect(applyFilters([tamil], { language: "japanese" })).toHaveLength(0);
  });

  it("keeps filtering mediaType only when both sides are known", () => {
    const movie = result({ mediaType: "movie" });
    const unknown = result();
    expect(applyFilters([movie, unknown], { mediaType: "tv" })).toHaveLength(1);
  });
});
