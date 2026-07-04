import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import envPaths from "env-paths";
import type { DownloadRecord } from "../types/download.js";

export const STATE_DIR =
  process.env.TORRENTX_STATE_DIR ?? envPaths("torrentx", { suffix: "" }).data;
const STORE_FILE = join(STATE_DIR, "downloads.json");
export const TORRENTS_DIR = join(STATE_DIR, "torrents");

export class DownloadStore {
  private records: DownloadRecord[] = [];
  private loaded = false;
  /** Serialise writes so concurrent persist() calls don't race on rename. */
  private writeQueue: Promise<void> = Promise.resolve();

  async load(): Promise<DownloadRecord[]> {
    try {
      const raw = await readFile(STORE_FILE, "utf8");
      const parsed: unknown = JSON.parse(raw);
      this.records = Array.isArray(parsed) ? (parsed as DownloadRecord[]) : [];
    } catch {
      this.records = [];
    }
    this.loaded = true;
    return [...this.records];
  }

  getAll(): DownloadRecord[] {
    return [...this.records];
  }

  getById(id: string): DownloadRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  async addRecord(record: DownloadRecord): Promise<void> {
    this.records.push(record);
    await this.persist();
  }

  async updateRecord(
    id: string,
    update: Partial<DownloadRecord>,
  ): Promise<DownloadRecord | undefined> {
    const index = this.records.findIndex((r) => r.id === id);
    if (index === -1) return undefined;
    this.records[index] = { ...this.records[index]!, ...update };
    await this.persist();
    return this.records[index];
  }

  async removeRecord(id: string): Promise<boolean> {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.id !== id);
    if (this.records.length === before) return false;
    await this.persist();
    return true;
  }

  async save(): Promise<void> {
    await this.persist();
  }

  // ---- torrent file cache helpers ----

  getTorrentFilePath(id: string): string {
    return join(TORRENTS_DIR, `${id}.torrent`);
  }

  hasTorrentFile(id: string): boolean {
    return existsSync(this.getTorrentFilePath(id));
  }

  async saveTorrentFile(id: string, buffer: Buffer): Promise<void> {
    try {
      await mkdir(TORRENTS_DIR, { recursive: true });
      const file = this.getTorrentFilePath(id);
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, buffer);
      await rename(temporary, file);
    } catch {}
  }

  async deleteTorrentFile(id: string): Promise<void> {
    try {
      await rm(this.getTorrentFilePath(id), { force: true });
    } catch {}
  }

  // ---- private helpers ----

  private persist(): Promise<void> {
    // Chain writes so they execute one at a time, avoiding EPERM on Windows
    // when two concurrent renames target the same destination.
    const work = this.writeQueue.then(async () => {
      try {
        await mkdir(STATE_DIR, { recursive: true });
        const tmp = `${STORE_FILE}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
        await writeFile(tmp, JSON.stringify(this.records, null, 2), "utf8");
        await rename(tmp, STORE_FILE);
      } catch {
        // Silently catch write errors to avoid crashing during shutdown/TUI tick.
      }
    });
    this.writeQueue = work.catch(() => {});
    return work;
  }
}
