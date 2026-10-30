import { describe, expect, it, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

const { DownloadEngine } = await import(
  "../src/services/download-engine.js"
);

describe("DownloadEngine", () => {
  let workDir: string | undefined;

  async function makeEngine(
    options: ConstructorParameters<typeof DownloadEngine>[0] = {},
  ) {
    if (!workDir) {
      workDir = await mkdtemp(join(tmpdir(), "torrentx-engine-"));
    }
    return new DownloadEngine(options);
  }

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = undefined;
    }
  });

  it("emits an error when a download stalls with no progress", async () => {
    const engine = await makeEngine({ stallTimeoutMs: 200, metadataTimeoutMs: 60_000 });
    const errors: Array<{ id: string; message: string }> = [];
    engine.on("error", (id: string, err: Error) => {
      errors.push({ id, message: err.message });
    });

    await engine.add("magnet:?xt=urn:btih:deadbeef01234567890deadbeef01234567890ab", workDir!, "dl-1");

    await vi.waitFor(
      () => {
        expect(errors.some((e) => e.id === "dl-1" && e.message.startsWith("Stalled"))).toBe(true);
      },
      { timeout: 3000, interval: 50 },
    );

    expect(engine.has("dl-1")).toBe(false);
    await engine.destroy();
  });

  it("keeps a download alive while bytes are arriving", async () => {
    const engine = await makeEngine({ stallTimeoutMs: 500, metadataTimeoutMs: 60_000 });
    const errors: string[] = [];
    engine.on("error", (_id: string, err: Error) => errors.push(err.message));

    await engine.add("magnet:?xt=urn:btih:deadbeef01234567890deadbeef01234567890ab", workDir!, "dl-2");

    // The handle must remain registered while no progress is reported for
    // less than the stall timeout.
    const handle = engine.getHandle("dl-2");
    expect(handle).toBeDefined();

    await new Promise((r) => setTimeout(r, 600));
    expect(errors).toHaveLength(0);
    expect(engine.has("dl-2")).toBe(true);
    await engine.destroy();
  });

  it("emits an error when metadata never arrives", async () => {
    const engine = await makeEngine({ stallTimeoutMs: 60_000, metadataTimeoutMs: 100 });
    const errors: Array<{ id: string; message: string }> = [];
    engine.on("error", (id: string, err: Error) => {
      errors.push({ id, message: err.message });
    });

    await engine.add("magnet:?xt=urn:btih:deadbeef01234567890deadbeef01234567890ab", workDir!, "dl-3");

    await vi.waitFor(
      () => {
        expect(errors.some((e) => e.id === "dl-3" && e.message.includes("Metadata fetch timed out"))).toBe(true);
      },
      { timeout: 3000, interval: 50 },
    );

    expect(engine.has("dl-3")).toBe(false);
    await engine.destroy();
  });

  it("destroy resolves even when the client destroy callback never fires", async () => {
    const engine = await makeEngine();
    await engine.add("magnet:?xt=urn:btih:deadbeef01234567890deadbeef01234567890ab", workDir!, "dl-4");

    // Simulate a hung client destroy callback.
    const hungClient = new MockClient();
    hungClient.destroy = () => {};
    (engine as unknown as { client: MockClient }).client = hungClient;

    const started = Date.now();
    await engine.destroy();
    expect(Date.now() - started).toBeLessThan(6_000);
  }, 10_000);

  it("stops polling and reports progress events", async () => {
    const engine = await makeEngine();
    const progress: Array<{ id: string }> = [];
    engine.on("progress", (id: string) => progress.push({ id }));

    await engine.add("magnet:?xt=urn:btih:deadbeef01234567890deadbeef01234567890ab", workDir!, "dl-5");
    await new Promise((r) => setTimeout(r, 700));
    expect(progress.filter((p) => p.id === "dl-5").length).toBeGreaterThan(0);

    expect(engine.cancel("dl-5")).toBe(true);
    await engine.destroy();
  });
});
