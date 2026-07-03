import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Point the store at a temp directory to avoid polluting real state.
const TEST_DIR = join(tmpdir(), `torrentx-test-store-${Date.now()}`);
process.env.TORRENTX_STATE_DIR = TEST_DIR;

// Import after setting env var so the store picks it up.
const { DownloadStore } = await import("../src/services/download-store.js");

function makeRecord(overrides: Partial<import("../src/types/download.js").DownloadRecord> = {}): import("../src/types/download.js").DownloadRecord {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    magnetUri: "magnet:?xt=urn:btih:abc123",
    title: "Test Torrent",
    source: "yts",
    downloadPath: "/tmp",
    status: "queued",
    addedAt: new Date().toISOString(),
    totalBytes: 1_000_000,
    downloadedBytes: 0,
    ...overrides,
  };
}

describe("DownloadStore", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("load returns empty array when no file exists", async () => {
    const store = new DownloadStore();
    const records = await store.load();
    expect(records).toEqual([]);
  });

  it("addRecord persists and is retrievable", async () => {
    const store = new DownloadStore();
    await store.load();
    const record = makeRecord({ title: "Interstellar" });
    await store.addRecord(record);

    expect(store.getById(record.id)).toBeDefined();
    expect(store.getById(record.id)!.title).toBe("Interstellar");
    expect(store.getAll()).toHaveLength(1);
  });

  it("updateRecord modifies fields and persists", async () => {
    const store = new DownloadStore();
    await store.load();
    const record = makeRecord();
    await store.addRecord(record);
    await store.updateRecord(record.id, {
      status: "downloading",
      downloadedBytes: 500_000,
    });

    const updated = store.getById(record.id);
    expect(updated?.status).toBe("downloading");
    expect(updated?.downloadedBytes).toBe(500_000);
  });

  it("removeRecord deletes and persists", async () => {
    const store = new DownloadStore();
    await store.load();
    const record = makeRecord();
    await store.addRecord(record);
    const removed = await store.removeRecord(record.id);

    expect(removed).toBe(true);
    expect(store.getAll()).toHaveLength(0);
    expect(store.getById(record.id)).toBeUndefined();
  });

  it("removeRecord returns false for unknown id", async () => {
    const store = new DownloadStore();
    await store.load();
    expect(await store.removeRecord("no-such-id")).toBe(false);
  });

  it("persists across instances", async () => {
    const store1 = new DownloadStore();
    await store1.load();
    const r1 = makeRecord({ title: "A" });
    const r2 = makeRecord({ title: "B" });
    await store1.addRecord(r1);
    await store1.addRecord(r2);

    // Second instance reads from disk.
    const store2 = new DownloadStore();
    const loaded = await store2.load();
    expect(loaded).toHaveLength(2);
    expect(loaded.map((r) => r.title).sort()).toEqual(["A", "B"]);
  });

  it("atomic write creates valid JSON", async () => {
    const store = new DownloadStore();
    await store.load();
    await store.addRecord(makeRecord({ title: "Check" }));

    const raw = await readFile(join(TEST_DIR, "downloads.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].title).toBe("Check");
  });
});
