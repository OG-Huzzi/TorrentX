import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stableHash } from "../utils/hash.js";

interface CacheEntry<T> {
  createdAt: number;
  value: T;
}

/**
 * Two-tier cache: hot in-memory LRU + persistent disk.
 * The memory tier eliminates disk I/O for repeated queries within a session,
 * delivering sub-millisecond cache hits for the most common searches.
 */
export class CacheService {
  private readonly directory: string;
  private readonly memory = new Map<string, CacheEntry<unknown>>();
  private readonly maxMemoryEntries: number;

  constructor(
    private readonly ttlMs: number,
    directory?: string,
    maxMemoryEntries = 128,
  ) {
    this.maxMemoryEntries = maxMemoryEntries;
    this.directory =
      directory ??
      process.env.TORRENTX_CACHE_DIR ??
      path.join(
        process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
        "torrentx",
      );
  }

  async get<T>(key: string): Promise<T | undefined> {
    const hash = stableHash(key);

    // Tier 1: In-memory LRU (sub-millisecond)
    const memEntry = this.memory.get(hash);
    if (memEntry) {
      if (Date.now() - memEntry.createdAt > this.ttlMs) {
        this.memory.delete(hash);
      } else {
        // Move to end for LRU ordering
        this.memory.delete(hash);
        this.memory.set(hash, memEntry);
        return memEntry.value as T;
      }
    }

    // Tier 2: Disk (persistent across sessions)
    try {
      const file = this.fileFor(hash);
      const entry = JSON.parse(await readFile(file, "utf8")) as CacheEntry<T>;
      if (Date.now() - entry.createdAt > this.ttlMs) return undefined;
      // Promote to memory tier
      this.memorySet(hash, entry);
      return entry.value;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const hash = stableHash(key);
    const entry: CacheEntry<T> = { createdAt: Date.now(), value };

    // Write to memory immediately
    this.memorySet(hash, entry);

    // Persist to disk asynchronously
    await mkdir(this.directory, { recursive: true });
    const file = this.fileFor(hash);
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(entry), "utf8");
    await rename(temporary, file);
  }

  private memorySet(hash: string, entry: CacheEntry<unknown>): void {
    // Evict oldest entries when over capacity (LRU)
    if (this.memory.size >= this.maxMemoryEntries) {
      const oldest = this.memory.keys().next().value;
      if (oldest) this.memory.delete(oldest);
    }
    this.memory.set(hash, entry);
  }

  private fileFor(hash: string): string {
    return path.join(this.directory, `${hash}.json`);
  }
}
