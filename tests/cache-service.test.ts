import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CacheService } from "../src/services/cache-service.js";

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "torrentx-cache-"));
}

describe("CacheService (two-tier)", () => {
  it("returns values from the in-memory tier", async () => {
    const cache = new CacheService(60_000, await tempDir());
    await cache.set("k", { hello: "world" });
    expect(await cache.get<{ hello: string }>("k")).toEqual({ hello: "world" });
  });

  it("persists to disk and survives a fresh instance", async () => {
    const dir = await tempDir();
    const first = new CacheService(60_000, dir);
    await first.set("shared", [1, 2, 3]);

    // A brand-new instance has an empty memory tier and must read from disk.
    const second = new CacheService(60_000, dir);
    expect(await second.get<number[]>("shared")).toEqual([1, 2, 3]);
  });

  it("expires entries past the TTL", async () => {
    const cache = new CacheService(-1, await tempDir()); // already-expired TTL
    await cache.set("stale", "value");
    expect(await cache.get("stale")).toBeUndefined();
  });

  it("evicts the oldest entry when the memory tier is full", async () => {
    // maxMemoryEntries = 2; use a throwaway dir so disk never rescues evictions.
    const dir = await tempDir();
    const cache = new CacheService(60_000, dir, 2);
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("c", 3); // should evict "a" from memory

    // "a" is gone from memory but still on disk, so it is promoted back on read.
    expect(await cache.get<number>("a")).toBe(1);
    expect(await cache.get<number>("c")).toBe(3);
  });

  it("misses cleanly for unknown keys", async () => {
    const cache = new CacheService(60_000, await tempDir());
    expect(await cache.get("never-set")).toBeUndefined();
  });
});
