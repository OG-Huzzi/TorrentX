import { describe, expect, it } from "vitest";
import { dedupeResults } from "../src/services/dedupe-service.js";
import type { SearchResult } from "../src/types/search.js";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: `id-${Math.random()}`,
    title: "Some.Torrent.1080p",
    source: "yts",
    seeders: 10,
    leechers: 1,
    trusted: true,
    sourceReliability: 0.9,
    score: 0,
    ...overrides,
  };
}

describe("dedupeResults", () => {
  it("keeps the best-seeded copy when the same infohash appears twice", () => {
    const weak = result({
      magnetUri: "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      seeders: 5,
      source: "yts",
    });
    const strong = result({
      magnetUri: "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      seeders: 250,
      source: "nyaa",
    });

    const out = dedupeResults([weak, strong]);
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe("nyaa");
    expect(out[0]?.seeders).toBe(250);
  });

  it("breaks seeders ties by score", () => {
    const lowScore = result({
      magnetUri: "magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      seeders: 50,
      score: 10,
    });
    const highScore = result({
      magnetUri: "magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      seeders: 50,
      score: 90,
    });

    const out = dedupeResults([lowScore, highScore]);
    expect(out).toHaveLength(1);
    expect(out[0]?.score).toBe(90);
  });

  it("keeps the best-seeded copy of title+size duplicates", () => {
    const weak = result({ title: "Same Movie", sizeBytes: 1_500_000_000, seeders: 3 });
    const strong = result({ title: "Same Movie", sizeBytes: 1_500_000_000, seeders: 300 });

    const out = dedupeResults([weak, strong]);
    expect(out).toHaveLength(1);
    expect(out[0]?.seeders).toBe(300);
  });

  it("keeps distinct infohashes even with identical titles", () => {
    const a = result({
      title: "Same Title",
      magnetUri: "magnet:?xt=urn:btih:cccccccccccccccccccccccccccccccccccccccc",
    });
    const b = result({
      title: "Same Title",
      magnetUri: "magnet:?xt=urn:btih:dddddddddddddddddddddddddddddddddddddddd",
    });

    expect(dedupeResults([a, b])).toHaveLength(2);
  });
});
