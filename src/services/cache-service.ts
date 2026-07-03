import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stableHash } from "../utils/hash.js";

interface CacheEntry<T> {
  createdAt: number;
  value: T;
}

export class CacheService {
  private readonly directory: string;

  constructor(
    private readonly ttlMs: number,
    directory?: string,
  ) {
    this.directory =
      directory ??
      process.env.TORRENTX_CACHE_DIR ??
      path.join(
        process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
        "torrentx",
      );
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const file = this.fileFor(key);
      const entry = JSON.parse(await readFile(file, "utf8")) as CacheEntry<T>;
      if (Date.now() - entry.createdAt > this.ttlMs) return undefined;
      return entry.value;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const file = this.fileFor(key);
    const temporary = `${file}.${process.pid}.tmp`;
    const entry: CacheEntry<T> = { createdAt: Date.now(), value };
    await writeFile(temporary, JSON.stringify(entry), "utf8");
    await rename(temporary, file);
  }

  private fileFor(key: string): string {
    return path.join(this.directory, `${stableHash(key)}.json`);
  }
}
