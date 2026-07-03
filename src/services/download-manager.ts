import { homedir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { stableHash } from "../utils/hash.js";
import { sanitizeMagnet } from "../utils/magnet.js";
import { actionableUri } from "./magnet-actions.js";
import { DownloadEngine } from "./download-engine.js";
import { DownloadStore } from "./download-store.js";
import type {
  DownloadItem,
  DownloadProgress,
  DownloadRecord,
  DownloadStatus,
} from "../types/download.js";
import type { SearchResult } from "../types/search.js";

function defaultDownloadDir(): string {
  return (
    process.env.TORRENTX_DOWNLOAD_DIR ??
    join(homedir(), "Downloads")
  );
}

/**
 * Orchestrates the download engine and persistent store.
 * Provides a clean API consumed by both the TUI and CLI commands.
 */
export class DownloadManager extends EventEmitter {
  private engine: DownloadEngine;
  private store: DownloadStore;
  private downloadDir: string;
  private liveProgress = new Map<string, DownloadProgress>();
  private infoHashToId = new Map<string, string>();

  constructor(downloadDir?: string) {
    super();
    this.engine = new DownloadEngine();
    this.store = new DownloadStore();
    this.downloadDir = downloadDir ?? defaultDownloadDir();
    this.wireEngineEvents();
    // Prevent Node from crashing on unhandled 'error' events.
    this.on("error", () => {});
  }

  /** Call once on startup to resume interrupted downloads. */
  async restore(): Promise<void> {
    const records = await this.store.load();
    for (const record of records) {
      if (
        record.status === "downloading" ||
        record.status === "queued" ||
        record.status === "seeding"
      ) {
        try {
          await this.resumeInEngine(record);
        } catch {
          await this.store.updateRecord(record.id, {
            status: "error",
            errorMessage: "Failed to resume on startup",
          });
        }
      }
    }
  }

  async startDownload(result: SearchResult): Promise<DownloadItem> {
    const magnet = actionableUri(result);
    const id = stableHash(`dl-${magnet}-${Date.now()}`);
    const record: DownloadRecord = {
      id,
      magnetUri: magnet,
      title: result.title,
      source: result.source,
      downloadPath: this.downloadDir,
      status: "queued",
      addedAt: new Date().toISOString(),
      totalBytes: result.sizeBytes ?? 0,
      downloadedBytes: 0,
    };

    await this.store.addRecord(record);
    const item = this.toItem(record);
    this.emit("added", item);

    // Start the actual download (async, don't block).
    this.resumeInEngine(record).catch(async (err: Error) => {
      await this.store.updateRecord(id, {
        status: "error",
        errorMessage: err.message,
      });
      const updated = this.store.getById(id);
      if (updated) this.emit("error", this.toItem(updated));
    });

    return item;
  }

  async pauseDownload(id: string): Promise<boolean> {
    const record = this.store.getById(id);
    if (!record) return false;
    const infoHash = this.findInfoHash(id);
    if (infoHash) this.engine.pause(infoHash);
    await this.store.updateRecord(id, { status: "paused" });
    return true;
  }

  async resumeDownload(id: string): Promise<boolean> {
    const record = this.store.getById(id);
    if (!record) return false;
    const infoHash = this.findInfoHash(id);
    if (infoHash) {
      this.engine.resume(infoHash);
      await this.store.updateRecord(id, { status: "downloading" });
    } else {
      // Re-add to engine if it was cleaned up.
      await this.resumeInEngine(record);
    }
    return true;
  }

  async cancelDownload(id: string, deleteFiles = false): Promise<boolean> {
    const infoHash = this.findInfoHash(id);
    if (infoHash) {
      this.engine.cancel(infoHash, deleteFiles);
      this.infoHashToId.delete(infoHash);
      this.liveProgress.delete(id);
    }
    const removed = await this.store.removeRecord(id);
    if (removed) this.emit("removed", id);
    return removed;
  }

  async toggleSeed(id: string): Promise<DownloadStatus | undefined> {
    const record = this.store.getById(id);
    if (!record) return undefined;

    if (record.status === "seeding") {
      const infoHash = this.findInfoHash(id);
      if (infoHash) this.engine.stopSeed(infoHash);
      await this.store.updateRecord(id, { status: "completed" });
      return "completed";
    }

    if (record.status === "completed") {
      await this.resumeInEngine(record);
      await this.store.updateRecord(id, { status: "seeding" });
      return "seeding";
    }

    return record.status;
  }

  getDownloads(): DownloadItem[] {
    return this.store.getAll().map((r) => this.toItem(r));
  }

  getDownload(id: string): DownloadItem | undefined {
    const record = this.store.getById(id);
    return record ? this.toItem(record) : undefined;
  }

  async destroy(): Promise<void> {
    await this.engine.destroy();
  }

  // ---- internals ----

  private async resumeInEngine(record: DownloadRecord): Promise<void> {
    await this.store.updateRecord(record.id, { status: "downloading" });
    const sanitized = sanitizeMagnet(record.magnetUri);
    const handle = await this.engine.add(sanitized, record.downloadPath);
    this.infoHashToId.set(handle.infoHash, record.id);

    // Update total bytes once metadata arrives (might differ from search result).
    if (handle.length > 0) {
      await this.store.updateRecord(record.id, { totalBytes: handle.length });
    }
  }

  private wireEngineEvents() {
    this.engine.on(
      "progress",
      (infoHash: string, progress: DownloadProgress) => {
        const id = this.infoHashToId.get(infoHash);
        if (!id) return;
        this.liveProgress.set(id, progress);
        void this.store.updateRecord(id, {
          downloadedBytes: progress.downloaded,
          totalBytes: progress.total,
        });
        const record = this.store.getById(id);
        if (record) this.emit("progress", this.toItem(record));
      },
    );

    this.engine.on("done", (infoHash: string) => {
      const id = this.infoHashToId.get(infoHash);
      if (!id) return;
      // Transition to seeding by default (like Torlink).
      void this.store.updateRecord(id, {
        status: "seeding",
        completedAt: new Date().toISOString(),
      });
      const record = this.store.getById(id);
      if (record) this.emit("done", this.toItem(record));
    });

    this.engine.on("error", (infoHash: string, err: Error) => {
      const id = this.infoHashToId.get(infoHash);
      if (!id) return;
      // Post-init errors: store the message but keep status as-is so
      // transient network hiccups don't kill the download. The torrent
      // engine keeps trying automatically.
      void this.store.updateRecord(id, {
        errorMessage: err.message,
      });
      const record = this.store.getById(id);
      if (record) this.emit("error", this.toItem(record));
    });

    this.engine.on(
      "metadata",
      (infoHash: string, name: string, totalBytes: number) => {
        const id = this.infoHashToId.get(infoHash);
        if (!id) return;
        void this.store.updateRecord(id, {
          title: name || undefined,
          totalBytes,
        } as Partial<DownloadRecord>);
      },
    );
  }

  private findInfoHash(id: string): string | undefined {
    for (const [hash, recordId] of this.infoHashToId) {
      if (recordId === id) return hash;
    }
    return undefined;
  }

  private toItem(record: DownloadRecord): DownloadItem {
    return {
      ...record,
      liveProgress: this.liveProgress.get(record.id),
    };
  }
}
