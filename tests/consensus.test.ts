import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createConfig } from "../src/core/config.js";
import { SearchEngine } from "../src/core/search-engine.js";
import { CacheService } from "../src/services/cache-service.js";
import { createResult } from "../src/sources/source-utils.js";
import type { SearchResult, SourceAdapter } from "../src/types/search.js";

const SHARED_HASH = "a".repeat(40);
const UNIQUE_HASH = "b".repeat(40);

function adapter(id: string, result: SearchResult): SourceAdapter {
  return {
    id,
    name: id,
    reliability: 0.8,
    mediaTypes: ["movie"],
    regions: ["global"],
    async search() {
      return [result];
    },
  };
}

describe("cross-source consensus boost", () => {
  it("ranks a torrent confirmed by multiple sources above an equal solo torrent", async () => {
    const shared = (source: string) =>
      createResult({
        title: "Consensus Movie",
        source,
        sourceReliability: 0.8,
        seeders: 50,
        leechers: 5,
        magnetUri: `magnet:?xt=urn:btih:${SHARED_HASH}&dn=consensus`,
      });
    const solo = createResult({
      title: "Solo Movie",
      source: "c",
      sourceReliability: 0.8,
      seeders: 50,
      leechers: 5,
      magnetUri: `magnet:?xt=urn:btih:${UNIQUE_HASH}&dn=solo`,
    });

    const directory = await mkdtemp(path.join(os.tmpdir(), "torrentx-consensus-"));
    const config = createConfig({ tmdbApiKey: undefined, omdbApiKey: undefined });
    const engine = new SearchEngine(
      [adapter("a", shared("a")), adapter("b", shared("b")), adapter("c", solo)],
      config,
      new CacheService(config.cacheTtlMs, directory),
    );

    const report = await engine.search("movie", { enrich: false, cache: false });

    // Two distinct results survive dedupe (shared collapses to one).
    expect(report.results).toHaveLength(2);
    expect(report.results[0]?.title).toBe("Consensus Movie");
    expect(report.results[0]!.score).toBeGreaterThan(report.results[1]!.score);
  });
});
