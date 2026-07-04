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
 * Tracks active downloads directly by their unique Download ID,
 * preventing race conditions, and keeping database writes in-memory on progress ticks.
 */
export class DownloadManager extends EventEmitter {
  private engine: DownloadEngine;
  private store: DownloadStore;
  private downloadDir: string;
  private liveProgress = new Map<string, DownloadProgress>();

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

    // Prevent duplicate downloads: check if this magnet/infohash is already in the list
    const infoHashRegex = /xt=urn:btih:([a-fA-F0-9]{32,40})/i;
    const match = magnet.match(infoHashRegex);
    const incomingHash = match ? match[1]!.toLowerCase() : null;

    const existing = this.store.getAll().find((r) => {
      if (incomingHash) {
        const rMatch = r.magnetUri.match(infoHashRegex);
        if (rMatch && rMatch[1]!.toLowerCase() === incomingHash) return true;
      }
      return r.magnetUri === magnet;
    });

    if (existing) {
      throw new Error("This torrent is already in your downloads list!");
    }

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
    this.engine.pause(id);
    await this.store.updateRecord(id, { status: "paused" });
    return true;
  }

  async resumeDownload(id: string): Promise<boolean> {
    const record = this.store.getById(id);
    if (!record) return false;
    
    if (this.engine.has(id)) {
      this.engine.resume(id);
      await this.store.updateRecord(id, { status: "downloading" });
    } else {
      await this.resumeInEngine(record);
    }
    return true;
  }

  async cancelDownload(id: string, deleteFiles = false): Promise<boolean> {
    this.engine.cancel(id, deleteFiles);
    this.liveProgress.delete(id);
    await this.store.deleteTorrentFile(id);
    const removed = await this.store.removeRecord(id);
    if (removed) this.emit("removed", id);
    return removed;
  }

  async toggleSeed(id: string): Promise<DownloadStatus | undefined> {
    const record = this.store.getById(id);
    if (!record) return undefined;

    if (record.status === "seeding") {
      this.engine.stopSeed(id);
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
    // Persist final progress records to disk before shutdown
    await this.store.save().catch(() => {});
    await this.engine.destroy();
  }

  // ---- internals ----

  private async resumeInEngine(record: DownloadRecord): Promise<void> {
    await this.store.updateRecord(record.id, { status: "downloading" });
    
    // Parity with torlink: check if we have the cached .torrent file.
    // If we do, load from it to start metadata-less download instantly!
    const hasCachedTorrent = this.store.hasTorrentFile(record.id);
    const source = hasCachedTorrent
      ? this.store.getTorrentFilePath(record.id)
      : sanitizeMagnet(record.magnetUri);

    const handle = await this.engine.add(source, record.downloadPath, record.id);

    // Update total bytes once metadata arrives (might differ from search result).
    if (handle.length > 0) {
      await this.store.updateRecord(record.id, { totalBytes: handle.length });
    }
  }

  private wireEngineEvents() {
    this.engine.on(
      "progress",
      (id: string, progress: DownloadProgress) => {
        this.liveProgress.set(id, progress);
        
        // Optimize: Do NOT persist progress writes to disk on every tick.
        // Mutate the in-memory record directly to prevent serious I/O bottlenecks.
        const record = this.store.getById(id);
        if (record) {
          record.downloadedBytes = progress.downloaded;
          record.totalBytes = progress.total;
          this.emit("progress", this.toItem(record));
        }
      },
    );

    this.engine.on("done", (id: string) => {
      void this.store.updateRecord(id, {
        status: "seeding",
        completedAt: new Date().toISOString(),
      });
      const record = this.store.getById(id);
      if (record) this.emit("done", this.toItem(record));
    });

    this.engine.on("error", (id: string, err: Error) => {
      void this.store.updateRecord(id, {
        errorMessage: err.message,
      });
      const record = this.store.getById(id);
      if (record) this.emit("error", this.toItem(record));
    });

    this.engine.on(
      "metadata",
      (id: string, name: string, totalBytes: number, torrentFile?: Buffer) => {
        // Cache the .torrent file buffer to disk just like torlink does
        if (torrentFile) {
          void this.store.saveTorrentFile(id, torrentFile);
        }

        void this.store.updateRecord(id, {
          title: name || undefined,
          totalBytes,
        } as Partial<DownloadRecord>);
      },
    );
  }

  private toItem(record: DownloadRecord): DownloadItem {
    return {
      ...record,
      liveProgress: this.liveProgress.get(record.id),
    };
  }
}
