import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Point the store at a temp directory.
const TEST_DIR = join(tmpdir(), `torrentx-test-mgr-${Date.now()}`);
process.env.TORRENTX_STATE_DIR = TEST_DIR;
process.env.TORRENTX_DOWNLOAD_DIR = join(TEST_DIR, "dl");

const { DownloadManager } = await import(
  "../src/services/download-manager.js"
);

import type { SearchResult } from "../src/types/search.js";

function fakeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: `r-${Date.now()}`,
    title: "Test Result",
    source: "yts",
    magnetUri: "magnet:?xt=urn:btih:deadbeef01234567890deadbeef01234567890ab",
    seeders: 100,
    leechers: 5,
    trusted: true,
    sourceReliability: 0.9,
    score: 50,
    ...overrides,
  };
}

describe("DownloadManager", () => {
  let manager: InstanceType<typeof DownloadManager>;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(join(TEST_DIR, "dl"), { recursive: true });
    manager = new DownloadManager(join(TEST_DIR, "dl"));
  });

  afterEach(async () => {
    await manager.destroy().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 100));
    for (let i = 0; i < 5; i++) {
      try {
        await rm(TEST_DIR, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  });

  it("startDownload creates a queued/downloading record", async () => {
    const result = fakeResult();
    // startDownload kicks off the engine asynchronously, so it should
    // return an item immediately.
    const item = await manager.startDownload(result);
    expect(item.title).toBe("Test Result");
    expect(["queued", "downloading"]).toContain(item.status);
    expect(item.magnetUri).toBe(result.magnetUri);

    const downloads = manager.getDownloads();
    expect(downloads.length).toBeGreaterThanOrEqual(1);
  });

  it("cancelDownload removes from downloads list", async () => {
    const result = fakeResult();
    const item = await manager.startDownload(result);

    // Wait a tick so the engine has time to wire up.
    await new Promise((r) => setTimeout(r, 200));

    const removed = await manager.cancelDownload(item.id);
    expect(removed).toBe(true);
    expect(manager.getDownloads()).toHaveLength(0);
  });

  it("getDownload returns undefined for unknown id", () => {
    expect(manager.getDownload("nonexistent")).toBeUndefined();
  });

  it("startDownload rejects when result has no magnet", async () => {
    const result = fakeResult();
    delete result.magnetUri;
    await expect(manager.startDownload(result)).rejects.toThrow();
  });

  it("pauseDownload returns false for unknown id", async () => {
    expect(await manager.pauseDownload("nonexistent")).toBe(false);
  });
});
