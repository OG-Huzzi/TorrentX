import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";

// Point the store at a temp directory.
const TEST_DIR = join(tmpdir(), `torrentx-test-mgr-${Date.now()}`);
process.env.TORRENTX_STATE_DIR = TEST_DIR;
process.env.TORRENTX_DOWNLOAD_DIR = join(TEST_DIR, "dl");

// Mock WebTorrent so tests never touch the real DHT/tracker network.
class MockTorrent extends EventEmitter {
  infoHash = "deadbeef01234567890deadbeef01234567890ab";
  name = "Mock Torrent";
  length = 1000;
  progress = 0;
  downloadSpeed = 0;
  uploadSpeed = 0;
  uploaded = 0;
  downloaded = 0;
  numPeers = 0;
  ratio = 0;
  done = false;
  paused = false;
  destroyed = false;
  ready = false;
  torrentFile = undefined;
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  destroy() {
    this.destroyed = true;
    this.emit("close");
  }
}

class MockClient extends EventEmitter {
  destroy(cb?: () => void) {
    cb?.();
  }
  add() {
    return new MockTorrent();
  }
}

vi.mock("webtorrent", () => ({ default: MockClient }));

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

async function waitForStatus(
  manager: InstanceType<typeof DownloadManager>,
  id: string,
  status: string,
  timeoutMs = 3000,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const item = manager.getDownload(id);
    if (item && item.status === status) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
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
    expect(item.magnetUri).toContain(result.magnetUri);

    const downloads = manager.getDownloads();
    expect(downloads.length).toBeGreaterThanOrEqual(1);
  });

  it("cancelDownload removes from downloads list", async () => {
    const result = fakeResult();
    const item = await manager.startDownload(result);
    await waitForStatus(manager, item.id, "downloading");

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

  it("queues downloads beyond the parallel cap and promotes on cancel", async () => {
    process.env.TORRENTX_MAX_PARALLEL_DOWNLOADS = "1";
    const capped = new DownloadManager(join(TEST_DIR, "dl"));

    const first = await capped.startDownload(
      fakeResult({ magnetUri: "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    );
    await waitForStatus(capped, first.id, "downloading");

    const second = await capped.startDownload(
      fakeResult({ magnetUri: "magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    );
    expect(second.status).toBe("queued");
    expect(capped.getDownload(second.id)?.status).toBe("queued");

    await capped.cancelDownload(first.id);
    expect(
      await waitForStatus(capped, second.id, "downloading"),
    ).toBe(true);

    await capped.destroy().catch(() => undefined);
    delete process.env.TORRENTX_MAX_PARALLEL_DOWNLOADS;
  });

  it("checks free space for the missing bytes only, so resumes are not rejected", async () => {
    const item = await manager.startDownload(fakeResult());
    await waitForStatus(manager, item.id, "downloading");
    const internals = manager as unknown as {
      engine: EventEmitter;
      store: { getById(id: string): { downloadedBytes: number } | undefined };
    };
    // Far more than any disk holds, but all of it already downloaded.
    const huge = 10 ** 17;
    internals.store.getById(item.id)!.downloadedBytes = huge - 1;
    internals.engine.emit("metadata", item.id, "Huge", huge);
    await new Promise((r) => setTimeout(r, 100));
    expect(manager.getDownload(item.id)?.status).toBe("downloading");

    // Same size with nothing on disk yet must still be rejected.
    internals.store.getById(item.id)!.downloadedBytes = 0;
    internals.engine.emit("metadata", item.id, "Huge", huge);
    expect(await waitForStatus(manager, item.id, "error")).toBe(true);
    expect(manager.getDownload(item.id)?.errorMessage).toMatch(/Not enough disk space/);
  });

  it("lets a failed download be added again", async () => {
    const result = fakeResult();
    const item = await manager.startDownload(result);
    await waitForStatus(manager, item.id, "downloading");
    await expect(manager.startDownload(result)).rejects.toThrow(/already in your downloads/);

    const internals = manager as unknown as {
      store: { updateRecord(id: string, patch: object): Promise<unknown> };
    };
    await internals.store.updateRecord(item.id, { status: "error", errorMessage: "Stalled" });

    const retried = await manager.startDownload(result);
    expect(retried.id).toBe(item.id);
    expect(manager.getDownloads()).toHaveLength(1);
    expect(manager.getDownload(item.id)?.errorMessage).toBeUndefined();
  });

  it("matches duplicates across hex and base32 forms of the same hash", async () => {
    await manager.startDownload(
      fakeResult({ magnetUri: "magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a" }),
    );
    await expect(
      manager.startDownloadFromUri("magnet:?xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK"),
    ).rejects.toThrow(/already in your downloads/);
  });

  it("cleans control characters and bad escapes out of magnet names", async () => {
    const item = await manager.startDownloadFromUri(
      "magnet:?xt=urn:btih:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee&dn=Bad%1B%5D0%3Bx%07Name%E0%A4%A",
    );
    expect(item.title).not.toContain("\u001b");
    expect(item.title).not.toContain("\u0007");
    expect(item.title).toContain("Name");
  });

  it("pause frees a slot for a queued download", async () => {
    process.env.TORRENTX_MAX_PARALLEL_DOWNLOADS = "1";
    const capped = new DownloadManager(join(TEST_DIR, "dl"));

    const first = await capped.startDownload(
      fakeResult({ magnetUri: "magnet:?xt=urn:btih:cccccccccccccccccccccccccccccccccccccccc" }),
    );
    await waitForStatus(capped, first.id, "downloading");

    const second = await capped.startDownload(
      fakeResult({ magnetUri: "magnet:?xt=urn:btih:dddddddddddddddddddddddddddddddddddddddd" }),
    );
    expect(second.status).toBe("queued");

    await capped.pauseDownload(first.id);
    expect(await waitForStatus(capped, second.id, "downloading")).toBe(true);
    expect(capped.getDownload(first.id)?.status).toBe("paused");

    await capped.destroy().catch(() => undefined);
    delete process.env.TORRENTX_MAX_PARALLEL_DOWNLOADS;
  });
});
