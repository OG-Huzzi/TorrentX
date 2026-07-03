import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createConfig } from "../src/core/config.js";
import { SearchEngine } from "../src/core/search-engine.js";
import { CacheService } from "../src/services/cache-service.js";
import { createResult } from "../src/sources/source-utils.js";
import type { SourceAdapter } from "../src/types/search.js";

describe("SearchEngine", () => {
  it("isolates failed adapters and filters successful results", async () => {
    const good: SourceAdapter = {
      id: "good",
      name: "Good",
      reliability: 0.9,
      mediaTypes: ["movie"],
      regions: ["global"],
      async search() {
        return [
          createResult({
            title: "Example 1080p",
            source: "good",
            sourceReliability: 0.9,
            seeders: 120,
          }),
          createResult({
            title: "Example 720p",
            source: "good",
            sourceReliability: 0.9,
            seeders: 2,
          }),
        ];
      },
    };
    const broken: SourceAdapter = {
      id: "broken",
      name: "Broken",
      reliability: 0.5,
      mediaTypes: ["other"],
      regions: ["global"],
      async search() {
        throw new Error("offline");
      },
    };
    const directory = await mkdtemp(path.join(os.tmpdir(), "torrentx-test-"));
    const config = createConfig({ tmdbApiKey: undefined, omdbApiKey: undefined });
    const engine = new SearchEngine(
      [good, broken],
      config,
      new CacheService(config.cacheTtlMs, directory),
    );

    const report = await engine.search("example", {
      quality: "1080p",
      minSeeders: 10,
      enrich: false,
      cache: false,
    });

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.title).toContain("1080p");
    expect(report.sources.find((source) => source.source === "broken")?.error).toBe("offline");
  });

  it("publishes partial ranked results as sources finish", async () => {
    const adapter = (id: string, delay: number, seeders: number): SourceAdapter => ({
      id,
      name: id,
      reliability: 0.8,
      mediaTypes: ["movie"],
      regions: ["global"],
      async search() {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return [
          createResult({
            title: `${id} result`,
            source: id,
            sourceReliability: 0.8,
            seeders,
          }),
        ];
      },
    });
    const directory = await mkdtemp(path.join(os.tmpdir(), "torrentx-progress-test-"));
    const config = createConfig({ tmdbApiKey: undefined, omdbApiKey: undefined });
    const engine = new SearchEngine(
      [adapter("fast", 1, 5), adapter("slow", 20, 50)],
      config,
      new CacheService(config.cacheTtlMs, directory),
    );
    const snapshots: Array<{ completed: number; titles: string[] }> = [];

    await engine.search(
      "example",
      { enrich: false, cache: false },
      (progress) => snapshots.push({
        completed: progress.completedSources,
        titles: progress.results.map((result) => result.title),
      }),
    );

    expect(snapshots[0]).toEqual({ completed: 0, titles: [] });
    expect(snapshots.some((snapshot) =>
      snapshot.completed === 1 && snapshot.titles.includes("fast result"),
    )).toBe(true);
    expect(snapshots.at(-1)?.titles).toEqual(["slow result", "fast result"]);
  });
});
