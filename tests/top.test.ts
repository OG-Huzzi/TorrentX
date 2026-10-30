import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createConfig } from "../src/core/config.js";
import { SearchEngine } from "../src/core/search-engine.js";
import { CacheService } from "../src/services/cache-service.js";
import { createResult, periodMs, topSlice, withinPeriod } from "../src/sources/source-utils.js";
import { executeTop, parseTopPeriod } from "../src/commands/top.js";
import type { SearchRequest, SearchReport, SourceAdapter } from "../src/types/search.js";

describe("top period helpers", () => {
  it("scopes periods to 24h and 7 days", () => {
    expect(periodMs("today")).toBe(24 * 60 * 60_000);
    expect(periodMs("week")).toBe(7 * 24 * 60 * 60_000);

    const now = Date.parse("2026-01-10T12:00:00Z");
    expect(withinPeriod("2026-01-10T06:00:00Z", "today", now)).toBe(true);
    expect(withinPeriod("2026-01-09T06:00:00Z", "today", now)).toBe(false);
    expect(withinPeriod("2026-01-09T06:00:00Z", "week", now)).toBe(true);
    expect(withinPeriod("2025-12-01T06:00:00Z", "week", now)).toBe(false);
  });

  it("keeps undated items and sorts the period by seeders", () => {
    const now = Date.now();
    const fresh = new Date(now - 60_000).toISOString();
    const old = new Date(now - 30 * 24 * 60 * 60_000).toISOString();
    const results = [
      createResult({ title: "stale", source: "x", sourceReliability: 0.5, seeders: 999, uploadedAt: old }),
      createResult({ title: "fresh low", source: "x", sourceReliability: 0.5, seeders: 5, uploadedAt: fresh }),
      createResult({ title: "fresh high", source: "x", sourceReliability: 0.5, seeders: 50, uploadedAt: fresh }),
      createResult({ title: "undated", source: "x", sourceReliability: 0.5, seeders: 30 }),
    ];

    const top = topSlice(results, "week", 10);
    expect(top.map((r) => r.title)).toEqual(["fresh high", "undated", "fresh low"]);
  });

  it("parses and validates the period argument", () => {
    expect(parseTopPeriod(undefined)).toBe("week");
    expect(parseTopPeriod("Today")).toBe("today");
    expect(parseTopPeriod("week")).toBe("week");
    expect(() => parseTopPeriod("decade")).toThrow(/today, week/);
  });
});

describe("executeTop", () => {
  function fakeEngine(report: Partial<SearchReport>) {
    const search = vi.fn().mockResolvedValue({
      query: "",
      intent: { query: "", preferredSources: [], terms: [] },
      results: [],
      sources: [],
      durationMs: 1,
      cached: false,
      ...report,
    });
    return { search } as unknown as SearchEngine & { search: typeof search };
  }

  it("requests the period as a top browse and emits JSON", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const engine = fakeEngine({
        results: [
          createResult({ title: "Top Entry", source: "yts", sourceReliability: 0.9, seeders: 10 }),
        ],
      });
      await executeTop(engine, "today", { json: true });

      expect(engine.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ top: "today", expandQuery: false }),
      );
      const printed = log.mock.calls.flat().join("\n");
      expect(printed).toContain("Top Entry");
    } finally {
      log.mockRestore();
    }
  });

  it("defaults to the week and rejects unknown periods", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const engine = fakeEngine({});
      await executeTop(engine, undefined, { json: true });
      expect(engine.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ top: "week" }),
      );
      await expect(executeTop(engine, "decade", {})).rejects.toThrow(/today, week/);
    } finally {
      log.mockRestore();
    }
  });
});

describe("SearchEngine top mode", () => {
  function fakeAdapter(
    id: string,
    supportsTop: boolean,
    log: SearchRequest[],
  ): SourceAdapter {
    return {
      id,
      name: id,
      reliability: 0.5,
      mediaTypes: ["movie", "tv", "anime", "game", "software", "documentary", "other"],
      regions: ["global"],
      supportsTop,
      async search(request) {
        log.push(request);
        return [
          createResult({
            title: `${id} entry`,
            source: id,
            sourceReliability: 0.5,
            seeders: 10,
          }),
        ];
      },
    };
  }

  it("routes top requests only to top-capable sources and passes the period", async () => {
    const log: SearchRequest[] = [];
    const withTop = fakeAdapter("toppy", true, log);
    const withoutTop = fakeAdapter("plainy", false, log);
    const directory = await mkdtemp(path.join(os.tmpdir(), "torrentx-test-"));
    const config = createConfig({ tmdbApiKey: undefined, omdbApiKey: undefined });
    const engine = new SearchEngine(
      [withoutTop, withTop],
      config,
      new CacheService(config.cacheTtlMs, directory),
    );

    const report = await engine.search("", {
      top: "today",
      cache: false,
      enrich: false,
    });

    expect(log.map((r) => r.top)).toEqual(["today"]);
    expect(log[0]?.query).toBe("");
    expect(report.sources.map((s) => s.source)).toEqual(["toppy"]);
    expect(report.results).toHaveLength(1);
  });

  it("still queries every source for regular searches", async () => {
    const log: SearchRequest[] = [];
    const directory = await mkdtemp(path.join(os.tmpdir(), "torrentx-test-"));
    const config = createConfig({ tmdbApiKey: undefined, omdbApiKey: undefined });
    const engine = new SearchEngine(
      [fakeAdapter("a", true, log), fakeAdapter("b", false, log)],
      config,
      new CacheService(config.cacheTtlMs, directory),
    );

    await engine.search("something", { cache: false, enrich: false, expandQuery: false });
    expect(log).toHaveLength(2);
    expect(log.every((r) => r.top === undefined)).toBe(true);
  });
});
