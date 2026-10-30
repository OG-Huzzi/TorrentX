import { homedir } from "node:os";
import { statfs } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { stableHash } from "../utils/hash.js";
import { infoHashFromMagnet, sanitizeMagnet } from "../utils/magnet.js";
import { stripControlChars } from "../utils/text.js";
import { actionableUri } from "./magnet-actions.js";
import { DownloadEngine } from "./download-engine.js";
import { DownloadStore } from "./download-store.js";
import { resolveMaxParallelDownloads } from "./download-tuning.js";
import { formatSize } from "../utils/size.js";
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
  private maxParallel: number;
  private liveProgress = new Map<string, DownloadProgress>();
  /** FIFO of record ids waiting for a free download slot. */
  private queue: string[] = [];

  constructor(downloadDir?: string) {
    super();
    this.engine = new DownloadEngine();
    this.store = new DownloadStore();
    this.downloadDir = downloadDir ?? defaultDownloadDir();
    this.maxParallel = resolveMaxParallelDownloads();
    this.wireEngineEvents();
    // Prevent Node from crashing on unhandled 'error' events.
    this.on("error", () => {});
  }

  /** Call once on startup to resume interrupted downloads. */
  async restore(): Promise<void> {
    const records = await this.store.load();
    const active = records.filter(
      (r) =>
        r.status === "downloading" || r.status === "seeding",
    );
    const queued = records.filter((r) => r.status === "queued");

    for (const record of active) {
      try {
        await this.resumeInEngine(record);
      } catch {
        await this.store.updateRecord(record.id, {
          status: "error",
          errorMessage: "Failed to resume on startup",
        });
      }
    }

    // Respect the parallel-download cap for anything that was queued.
    for (const record of queued) {
      if (this.activeCount() < this.maxParallel) {
        this.startEngineFor(record);
      } else {
        this.queue.push(record.id);
      }
    }
  }

  async startDownload(result: SearchResult): Promise<DownloadItem> {
    if (result.sizeBytes && result.sizeBytes > 0) {
      await this.assertFreeSpace(result.sizeBytes);
    }
    const magnet = actionableUri(result);
    return this.startDownloadFromUri(magnet, result.title, result.source);
  }

  async startDownloadFromUri(uri: string, customTitle?: string, source?: string): Promise<DownloadItem> {
    // Prevent duplicate downloads: check if this magnet/infohash is already in the list
    const incomingHash = infoHashFromMagnet(uri) ?? null;

    const existing = this.store.getAll().find((r) => {
      if (incomingHash && infoHashFromMagnet(r.magnetUri) === incomingHash) return true;
      return r.magnetUri === uri;
    });

    if (existing) {
      if (existing.status !== "error") {
        throw new Error("This torrent is already in your downloads list!");
      }
      // A failed download (dead magnet, stall, disk full) is retried by
      // adding it again; already-downloaded data on disk is kept and reused.
      await this.cancelDownload(existing.id, false);
    }

    // Determine a title (fallback to file name or infoHash)
    let title = customTitle || "Loading torrent...";
    if (!customTitle) {
      if (uri.startsWith("magnet:?")) {
        const nameMatch = uri.match(/[?&]dn=([^&]+)/);
        title = nameMatch ? safeDecode(nameMatch[1]!) : (incomingHash || "Magnet link");
      } else {
        // It's a file path
        title = uri.split(/[/\\]/).pop() || "Local torrent";
      }
    }

    // Deterministic ID derived from the infohash (when available) so the same
    // torrent gets the same record across sessions and duplicate checks stay
    // meaningful even after a crash between check and insert.
    const id = incomingHash
      ? `dl-${incomingHash}`
      : stableHash(`dl-${uri}`);
    const record: DownloadRecord = {
      id,
      magnetUri: uri,
      title: stripControlChars(title).trim() || "Magnet link",
      source: source || (uri.startsWith("magnet:") ? "magnet" : "file"),
      downloadPath: this.downloadDir,
      status: "queued",
      addedAt: new Date().toISOString(),
      totalBytes: 0,
      downloadedBytes: 0,
    };

    await this.store.addRecord(record);
    const item = this.toItem(record);
    this.emit("added", item);

    // Start the actual download if a slot is free, otherwise queue it.
    if (this.activeCount() < this.maxParallel) {
      this.startEngineFor(record);
    } else {
      this.queue.push(record.id);
    }

    return item;
  }

  async pauseDownload(id: string): Promise<boolean> {
    const record = this.store.getById(id);
    if (!record) return false;
    this.engine.pause(id);
    await this.store.updateRecord(id, { status: "paused" });
    this.promoteNext();
    return true;
  }

  async resumeDownload(id: string): Promise<boolean> {
    const record = this.store.getById(id);
    if (!record) return false;

    if (this.engine.has(id)) {
      this.engine.resume(id);
      await this.store.updateRecord(id, { status: "downloading" });
    } else if (this.activeCount() < this.maxParallel) {
      await this.resumeInEngine(record);
    } else {
      await this.store.updateRecord(id, { status: "queued" });
      this.queue.push(id);
    }
    return true;
  }

  async cancelDownload(id: string, deleteFiles = false): Promise<boolean> {
    this.engine.cancel(id, deleteFiles);
    this.liveProgress.delete(id);
    await this.store.deleteTorrentFile(id);
    const removed = await this.store.removeRecord(id);
    this.queue = this.queue.filter((queuedId) => queuedId !== id);
    if (removed) this.emit("removed", id);
    this.promoteNext();
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

  private activeCount(): number {
    return this.store
      .getAll()
      .filter((r) => r.status === "downloading").length;
  }

  /** Kick off a queued download and surface engine failures as record errors. */
  private startEngineFor(record: DownloadRecord): void {
    this.resumeInEngine(record).catch(async (err: Error) => {
      await this.store.updateRecord(record.id, {
        status: "error",
        errorMessage: err.message,
      });
      const updated = this.store.getById(record.id);
      if (updated) this.emit("error", this.toItem(updated));
      this.promoteNext();
    });
  }

  /** Move queued downloads into free slots as they open up. */
  private promoteNext(): void {
    while (
      this.queue.length > 0 &&
      this.activeCount() < this.maxParallel
    ) {
      const id = this.queue.shift()!;
      const record = this.store.getById(id);
      if (record && record.status === "queued") {
        this.startEngineFor(record);
      }
    }
  }

  /** Throw early when the disk cannot hold the download. */
  private async assertFreeSpace(requiredBytes: number): Promise<void> {
    try {
      const stats = await statfs(this.downloadDir);
      const available = Number(stats.bavail) * Number(stats.bsize);
      // Keep a small headroom so the final piece can always be written.
      if (available < requiredBytes * 1.02) {
        throw new Error(
          `Not enough disk space: need ${formatSize(requiredBytes)}, only ${formatSize(available)} free in ${this.downloadDir}`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Not enough disk space")) {
        throw error;
      }
      // statfs can fail on exotic filesystems — don't block downloads on it.
    }
  }

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
      this.promoteNext();
    });

    this.engine.on("error", (id: string, err: Error) => {
      // Client-level errors (tracker announce failures etc.) are not tied to
      // a single download — surface them without touching any record.
      if (id === "client") {
        this.emit("error", err);
        return;
      }

      const record = this.store.getById(id);
      if (!record) return;

      const patch: Partial<DownloadRecord> = { errorMessage: err.message };
      // A fatal torrent error means the download is dead — stop showing it
      // as an active download that never finishes.
      if (record.status === "downloading" || record.status === "queued") {
        patch.status = "error";
      }
      void this.store.updateRecord(id, patch).then(() => {
        const updated = this.store.getById(id);
        if (updated) this.emit("error", this.toItem(updated));
        this.promoteNext();
      });
    });

    this.engine.on(
      "metadata",
      (id: string, name: string, totalBytes: number, torrentFile?: Buffer) => {
        // Cache the .torrent file buffer to disk just like torlink does
        if (torrentFile) {
          void this.store.saveTorrentFile(id, torrentFile);
        }

        const record = this.store.getById(id);
        const cleanName = name ? stripControlChars(name).trim() : "";
        void this.store.updateRecord(id, {
          ...(cleanName ? { title: cleanName } : {}),
          totalBytes,
        });

        // Now that the true size is known, verify the disk can hold what is
        // still missing. On resume most of the data may already be on disk,
        // so checking the full size would fail large, nearly-done downloads.
        // Completed/seeding torrents need no further space.
        const alreadyHave = Math.min(record?.downloadedBytes ?? 0, totalBytes);
        const remaining = totalBytes - alreadyHave;
        const needsSpace = record?.status !== "seeding" && record?.status !== "completed";
        if (needsSpace && remaining > 0) {
          void this.assertFreeSpace(remaining).catch((err: Error) => {
            this.engine.cancel(id, false);
            void this.store.updateRecord(id, {
              status: "error",
              errorMessage: err.message,
            });
            const updated = this.store.getById(id);
            if (updated) this.emit("error", this.toItem(updated));
            this.promoteNext();
          });
        }
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

/** decodeURIComponent that tolerates malformed escapes in user/scraped input. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}
