import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `torrentx-test-cmds-${Date.now()}`);
process.env.TORRENTX_STATE_DIR = TEST_DIR;

const { toSearchOptions } = await import("../src/commands/search.js");
const { executeDownloadsList } = await import("../src/commands/downloads.js");
const { executeStoredAction } = await import("../src/commands/actions.js");
const { ResultStore } = await import("../src/services/result-store.js");

function makeResult(overrides: Record<string, unknown> = {}): import("../src/types/search.js").SearchResult {
  return {
    id: "r1",
    title: "Some Movie",
    source: "yts",
    magnetUri: "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    seeders: 10,
    leechers: 1,
    trusted: true,
    sourceReliability: 0.9,
    score: 0,
    ...overrides,
  } as import("../src/types/search.js").SearchResult;
}

describe("toSearchOptions", () => {
  it("applies 4k shortcut and passes through filters", () => {
    const options = toSearchOptions({
      fourK: true,
      source: "yts, NYAA",
      minSeeds: "50",
      codec: "x265",
      language: "hindi",
      type: "movie",
    });
    expect(options.quality).toBe("2160p");
    expect(options.source).toEqual(["yts", "nyaa"]);
    expect(options.minSeeders).toBe(50);
    expect(options.codec).toBe("x265");
    expect(options.language).toBe("hindi");
    expect(options.mediaType).toBe("movie");
  });

  it("rejects invalid numeric flags", () => {
    expect(() => toSearchOptions({ limit: "0" })).toThrow(/--limit/);
    expect(() => toSearchOptions({ minSeeds: "-3" })).toThrow(/--min-seeds/);
    expect(() => toSearchOptions({ minSeeds: "abc" })).toThrow(/--min-seeds/);
  });

  it("rejects invalid media types", () => {
    expect(() => toSearchOptions({ type: "banana" })).toThrow(/--type/);
    expect(toSearchOptions({ type: "tv" }).mediaType).toBe("tv");
  });

  it("rejects unparseable sizes", () => {
    expect(() => toSearchOptions({ minSize: "huge" })).toThrow(/--min-size/);
    expect(toSearchOptions({ minSize: "700MB" }).minSizeBytes).toBe(700_000_000);
  });
});

describe("executeDownloadsList", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    log.mockClear();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("reports an empty list", async () => {
    await executeDownloadsList({});
    expect(log.mock.calls.flat().join("\n")).toContain("No downloads.");
  });

  it("renders stored downloads and supports JSON output", async () => {
    const store = new (await import("../src/services/download-store.js")).DownloadStore();
    await store.load();
    await store.addRecord({
      id: "dl-1",
      magnetUri: "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      title: "Some Movie",
      source: "yts",
      downloadPath: "/tmp",
      status: "downloading",
      addedAt: new Date().toISOString(),
      totalBytes: 1000,
      downloadedBytes: 250,
    });

    await executeDownloadsList({});
    const text = log.mock.calls.flat().join("\n");
    expect(text).toContain("Some Movie");
    expect(text).toContain("25%");

    log.mockClear();
    await executeDownloadsList({ json: true });
    const json = JSON.parse(log.mock.calls.flat().join("\n")) as Array<{ title: string }>;
    expect(json[0]?.title).toBe("Some Movie");
  });
});

describe("executeStoredAction", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("rejects invalid result indexes", async () => {
    await expect(executeStoredAction("magnet", "0")).rejects.toThrow(/positive integer/);
    await expect(executeStoredAction("magnet", "abc")).rejects.toThrow(/positive integer/);
  });

  it("rejects when no search results are saved", async () => {
    await expect(executeStoredAction("magnet", "2")).rejects.toThrow(/Run a search first/);
  });

  it("exports a magnet to a file", async () => {
    await new ResultStore().save([makeResult()]);
    const destination = join(TEST_DIR, "out.txt");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await executeStoredAction("export", "1", destination);

    const written = await readFile(destination, "utf8");
    expect(written).toContain("urn:btih:aaaaaaaa");
    expect(log.mock.calls.flat().join("\n")).toContain("Exported result 1");
  });

  it("reports errors when the result has no actionable URI", async () => {
    await new ResultStore().save([makeResult({ magnetUri: undefined, torrentUrl: undefined })]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await executeStoredAction("magnet", "1");
    expect(log.mock.calls.flat().join("\n")).toContain("provides no link");
  });
});
