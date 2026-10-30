import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createConfig } from "../src/core/config.js";
import { SearchEngine } from "../src/core/search-engine.js";
import { CacheService } from "../src/services/cache-service.js";
import { SourceHealthTracker } from "../src/services/source-health.js";
import { createResult } from "../src/sources/source-utils.js";
import type { SourceAdapter } from "../src/types/search.js";

describe("SearchEngine", () => {
  it("raises per-source timeouts to the configured floor (Tor/proxy latency)", async () => {
    const hanging: SourceAdapter = {
      id: "hanging",
      name: "Hanging",
      reliability: 0.5,
      mediaTypes: ["other"],
      regions: ["global"],
      async search(request) {
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      },
    };
    const directory = await mkdtemp(path.join(os.tmpdir(), "torrentx-test-"));
    const config = createConfig({
      tmdbApiKey: undefined,
      omdbApiKey: undefined,
      sourceTimeoutMs: 150,
      timeoutFloorMs: 600,
    });
    const engine = new SearchEngine(
      [hanging],
      config,
      new CacheService(config.cacheTtlMs, directory),
    );

    const startedAt = Date.now();
    const report = await engine.search("example", { enrich: false, cache: false, expandQuery: false });

    expect(report.sources[0]?.failureKind).toBe("timeout");
    // The floor (600ms) must win over the smaller base timeout (150ms).
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(500);
  });

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
    expect(report.sources.find((source) => source.source === "broken")?.failureKind).toBe("network");
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

  it("does not record a health failure when the search is cancelled by the user", async () => {
    const flaky: SourceAdapter = {
      id: "flaky",
      name: "Flaky",
      reliability: 0.8,
      mediaTypes: ["movie"],
      regions: ["global"],
      async search(request) {
        await waitUntilAborted(request.signal ?? new AbortController().signal);
        return [];
      },
    };
    const directory = await mkdtemp(path.join(os.tmpdir(), "torrentx-abort-test-"));
    const config = createConfig({ tmdbApiKey: undefined, omdbApiKey: undefined });
    const engine = new SearchEngine(
      [flaky],
      config,
      new CacheService(config.cacheTtlMs, directory),
    );
    const controller = new AbortController();

    const searchPromise = engine.search("example", {
      enrich: false,
      cache: false,
      signal: controller.signal,
    });
    controller.abort();

    await expect(searchPromise).rejects.toThrow(/aborted/i);
    expect(engine.getHealthTracker().getLearnedReliability("flaky")).toBeUndefined();
  });

  it("still records failures that come from real errors, not aborts", async () => {
    const broken: SourceAdapter = {
      id: "still-broken",
      name: "Still Broken",
      reliability: 0.5,
      mediaTypes: ["movie"],
      regions: ["global"],
      async search() {
        throw new Error("offline");
      },
    };
    const directory = await mkdtemp(path.join(os.tmpdir(), "torrentx-failure-test-"));
    const config = createConfig({ tmdbApiKey: undefined, omdbApiKey: undefined });
    const engine = new SearchEngine(
      [broken],
      config,
      new CacheService(config.cacheTtlMs, directory),
    );

    await engine.search("example", { enrich: false, cache: false });

    expect(engine.getHealthTracker().getLearnedReliability("still-broken")).toBeLessThan(0.5);
  });
});

function waitUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("The operation was aborted", "AbortError")),
      { once: true },
    );
  });
}

describe("SearchEngine cancellation", () => {
  it("cancels sources at once when the search signal is already aborted", async () => {
    let sawAborted = false;
    const hanging: SourceAdapter = {
      id: "hanging",
      name: "Hanging",
      reliability: 0.5,
      mediaTypes: ["other"],
      regions: ["global"],
      async search(request) {
        sawAborted = request.signal?.aborted === true;
        return new Promise((_resolve, reject) => {
          if (request.signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
          request.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      },
    };
    const directory = await mkdtemp(path.join(os.tmpdir(), "torrentx-test-"));
    const config = createConfig({ sourceTimeoutMs: 5_000 });
    const health = new SourceHealthTracker(path.join(directory, "health.json"));
    const engine = new SearchEngine(
      [hanging],
      config,
      new CacheService(config.cacheTtlMs, directory),
      health,
    );

    const controller = new AbortController();
    controller.abort();
    const startedAt = Date.now();
    await expect(
      engine.search("example", {
        enrich: false,
        cache: false,
        expandQuery: false,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/i);

    expect(sawAborted).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    // A cancelled run must not count against the source.
    expect(health.getLearnedReliability("hanging")).toBeUndefined();
  });
});
