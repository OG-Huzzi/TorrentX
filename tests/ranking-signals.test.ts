import { describe, expect, it } from "vitest";
import { inferSearchIntent } from "../src/core/query-intelligence.js";
import { rankResults, scoreResult } from "../src/services/ranking-service.js";
import { createResult } from "../src/sources/source-utils.js";

const intent = inferSearchIntent("example");

function base(overrides: Partial<Parameters<typeof createResult>[0]> & { title: string }) {
  return createResult({
    source: "x",
    sourceReliability: 0.8,
    seeders: 100,
    leechers: 10,
    trusted: true,
    ...overrides,
  });
}

describe("ranking signals", () => {
  it("penalizes spam/fake titles below clean ones", () => {
    const ranked = rankResults(
      [
        base({ title: "Photoshop 2024 keygen only" }),
        base({ title: "Photoshop 2024 Full Install" }),
      ],
      intent,
    );
    expect(ranked[0]?.title).toBe("Photoshop 2024 Full Install");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("rewards trusted release groups", () => {
    const withGroup = scoreResult(
      base({ title: "Some.Game.Repack-FitGirl", mediaType: "game", sizeBytes: 5_000_000_000 }),
      intent,
    );
    const withoutGroup = scoreResult(
      base({ title: "Some Game Edition", mediaType: "game", sizeBytes: 5_000_000_000 }),
      intent,
    );
    expect(withGroup).toBeGreaterThan(withoutGroup);
  });

  it("penalizes movies that are implausibly small", () => {
    const tiny = scoreResult(
      base({ title: "Big Movie", mediaType: "movie", sizeBytes: 10 * 1024 * 1024 }),
      intent,
    );
    const normal = scoreResult(
      base({ title: "Big Movie", mediaType: "movie", sizeBytes: 2 * 1024 * 1024 * 1024 }),
      intent,
    );
    expect(tiny).toBeLessThan(normal);
  });

  it("pushes dead (zero-seeder) torrents down", () => {
    const ranked = rankResults(
      [
        base({ title: "Alive", seeders: 300, leechers: 40 }),
        base({ title: "Dead", seeders: 0, leechers: 0 }),
      ],
      intent,
    );
    expect(ranked[0]?.title).toBe("Alive");
    expect(ranked.at(-1)?.title).toBe("Dead");
  });
});
