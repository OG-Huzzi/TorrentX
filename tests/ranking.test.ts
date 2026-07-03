import { describe, expect, it } from "vitest";
import { inferSearchIntent } from "../src/core/query-intelligence.js";
import { rankResults } from "../src/services/ranking-service.js";
import { createResult } from "../src/sources/source-utils.js";

describe("ranking", () => {
  it("raises healthy trusted results above dead results", () => {
    const intent = inferSearchIntent("movie interstellar");
    const ranked = rankResults(
      [
        createResult({
          title: "Interstellar 1080p x265",
          source: "yts",
          sourceReliability: 0.9,
          seeders: 500,
          leechers: 20,
          trusted: true,
          mediaType: "movie",
        }),
        createResult({
          title: "Interstellar 4K",
          source: "unknown",
          sourceReliability: 0.4,
          seeders: 0,
          leechers: 3,
          trusted: false,
          mediaType: "movie",
        }),
      ],
      intent,
    );

    expect(ranked[0]?.source).toBe("yts");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });
});
