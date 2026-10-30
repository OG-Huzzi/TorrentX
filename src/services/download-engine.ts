import { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type WebTorrent from "webtorrent";
import type { Torrent } from "webtorrent";
import type { DownloadProgress } from "../types/download.js";
import {
  resolveMetadataTimeout,
  resolveStallTimeoutMs,
  torrentAddOptions,
  webTorrentClientOptions,
} from "./download-tuning.js";

/**
 * Distinctive fragments of the patches applied by scripts/patch-webtorrent.mjs.
 * The null-piece guards prevent crashes inside webtorrent's timers; the
 * persistent error handlers prevent unhandled uTP 'error' events from killing
 * the process. The script patches node_modules after install; this check fails
 * fast at download time if a patch is missing (e.g. install ran with
 * --ignore-scripts or a webtorrent version change invalidated the patch).
 */
const PATCH_MARKERS: ReadonlyArray<{ file: string; marker: string }> = [
  {
    file: "torrent.js",
    marker: "downloaded += piece ? (piece.length - piece.missing) : ((index === len - 1) ? this.lastPieceLength : this.pieceLength)",
  },
  {
    file: "torrent.js",
    marker: "const rankedPiece = self.pieces[index] if (!rankedPiece) return true",
  },
  {
    file: "torrent.js",
    marker: "if (!piece) return false let reservation = isWebSeed ? piece.reserveRemaining() : piece.reserve()",
  },
  {
    file: "torrent.js",
    marker: "this.pieces[index]?.cancel((req.offset / Piece.BLOCK_LENGTH) | 0)",
  },
  {
    file: "torrent.js",
    marker: "Persistent: uTP can emit several errors per connection",
  },
  {
    file: "peer.js",
    marker: "Persistent: see the _drain patch in torrent.js.",
  },
];

let patchesVerified: boolean | null = null;

export function verifyWebtorrentPatches(libDirOverride?: string): void {
  if (patchesVerified === true) return;
  try {
    const require = createRequire(import.meta.url);
    const webtorrentEntry = require.resolve("webtorrent");
    const libDir = libDirOverride ?? join(dirname(webtorrentEntry), "lib");
    const sources = new Map<string, string>();
    for (const { file, marker } of PATCH_MARKERS) {
      if (!sources.has(file)) {
        sources.set(
          file,
          readFileSync(join(libDir, file), "utf8").replace(/\s+/g, " "),
        );
      }
      if (!sources.get(file)!.includes(marker)) {
        throw new Error(
          "webtorrent patches are missing from " +
            `${join(libDir, file)}. Downloads would crash mid-transfer. ` +
            "Re-run `npm install` (or `node scripts/patch-webtorrent.mjs`), " +
            "or update the patches for the installed webtorrent version.",
        );
      }
    }
    patchesVerified = true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("patches are missing")) {
      throw error;
    }
    throw new Error(
      "Could not verify webtorrent patches: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

const DESTROY_TIMEOUT_MS = 5_000;

export interface DownloadEngineOptions {
  /** Override for tests; defaults to TORRENTX_STALL_TIMEOUT_MS (15 min). */
  stallTimeoutMs?: number;
  /** Override for tests; defaults to TORRENTX_METADATA_TIMEOUT_MS (60 s). */
  metadataTimeoutMs?: number;
}

export interface TorrentHandle {
  infoHash: string;
  name: string;
  length: number;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  uploaded: number;
  downloaded: number;
  numPeers: number;
  ratio: number;
  done: boolean;
  paused: boolean;
}

export interface EngineEvents {
  progress: (id: string, progress: DownloadProgress) => void;
  done: (id: string) => void;
  error: (id: string, error: Error) => void;
  metadata: (id: string, name: string, totalBytes: number, torrentFile?: Buffer) => void;
}

/**
 * Wrapper around WebTorrent tracking downloads by their unique Download ID.
 */
export class DownloadEngine extends EventEmitter {
  private client: WebTorrent | null = null;
  private idToTorrent = new Map<string, Torrent>();
  private intervals = new Map<string, ReturnType<typeof setInterval>>();
  private metadataTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private stallTrackers = new Map<
    string,
    { lastProgressAt: number; lastDownloaded: number }
  >();
  private destroyed = false;
  private readonly stallTimeoutMs: number;
  private readonly metadataTimeoutMs: number;

  constructor(options: DownloadEngineOptions = {}) {
    super();
    this.stallTimeoutMs = options.stallTimeoutMs ?? resolveStallTimeoutMs();
    this.metadataTimeoutMs = options.metadataTimeoutMs ?? resolveMetadataTimeout();
  }

  private async ensureClient(): Promise<WebTorrent> {
    if (this.client) return this.client;
    verifyWebtorrentPatches();
    const WTConstructor = (await import("webtorrent")).default;
    this.client = new WTConstructor(webTorrentClientOptions());
    this.client.on("error", (err: Error) => {
      this.emit("error", "client", err);
    });
    return this.client;
  }

  async add(
    magnetOrTorrentPath: string | Buffer,
    downloadPath: string,
    id: string,
  ): Promise<TorrentHandle> {
    // Ensure the download directory exists before WebTorrent tries to write.
    await mkdir(downloadPath, { recursive: true });
    const client = await this.ensureClient();

    const torrent = client.add(magnetOrTorrentPath, torrentAddOptions(downloadPath));

    this.idToTorrent.set(id, torrent);

    // Emit metadata once we know the torrent name/size/torrentFile bytes.
    // Dead magnets never fetch metadata, so bound the wait and surface an
    // error instead of hanging the download in "downloading" forever.
    if (torrent.ready) {
      this.emit("metadata", id, torrent.name, torrent.length, torrent.torrentFile);
    } else {
      const timeoutMs = this.metadataTimeoutMs;
      const metadataTimer = setTimeout(() => {
        if (!torrent.ready && !torrent.destroyed) {
          this.emit(
            "error",
            id,
            new Error(`Metadata fetch timed out after ${timeoutMs}ms`),
          );
          this.clearProgressInterval(id);
          this.metadataTimers.delete(id);
          this.stallTrackers.delete(id);
          this.idToTorrent.delete(id);
          void torrent.destroy();
        }
      }, timeoutMs);
      this.metadataTimers.set(id, metadataTimer);
      torrent.once("metadata", () => {
        clearTimeout(metadataTimer);
        this.metadataTimers.delete(id);
        this.emit("metadata", id, torrent.name, torrent.length, torrent.torrentFile);
      });
    }

    // Wire up error handler (non-fatal — just surfaces to UI).
    torrent.on("error", (err: Error) => {
      this.emit("error", id, err);
    });

    torrent.on("done", () => {
      this.clearProgressInterval(id);
      this.metadataTimers.delete(id);
      this.stallTrackers.delete(id);
      this.emitProgress(id, torrent);
      this.emit("done", id);
    });

    // Poll for progress updates immediately to show download speed/peers from the start.
    const stallTimeoutMs = this.stallTimeoutMs;
    const timer = setInterval(() => {
      if (!torrent.destroyed) {
        this.emitProgress(id, torrent);
        this.checkStalled(id, torrent, stallTimeoutMs);
      } else {
        this.clearProgressInterval(id);
      }
    }, 500);
    this.intervals.set(id, timer);

    return this.toHandle(torrent);
  }

  has(id: string): boolean {
    return this.idToTorrent.has(id);
  }

  pause(id: string): boolean {
    const torrent = this.idToTorrent.get(id);
    if (!torrent) return false;
    torrent.pause();
    return true;
  }

  resume(id: string): boolean {
    const torrent = this.idToTorrent.get(id);
    if (!torrent) return false;
    torrent.resume();
    return true;
  }

  cancel(id: string, destroyFiles = false): boolean {
    const torrent = this.idToTorrent.get(id);
    if (!torrent) return false;
    this.clearProgressInterval(id);
    this.clearMetadataTimer(id);
    this.stallTrackers.delete(id);
    this.idToTorrent.delete(id);
    torrent.destroy({ destroyStore: destroyFiles });
    return true;
  }

  stopSeed(id: string): boolean {
    return this.cancel(id, false);
  }

  getHandle(id: string): TorrentHandle | undefined {
    const torrent = this.idToTorrent.get(id);
    return torrent ? this.toHandle(torrent) : undefined;
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const timer of this.intervals.values()) clearInterval(timer);
    this.intervals.clear();
    for (const timer of this.metadataTimers.values()) clearTimeout(timer);
    this.metadataTimers.clear();
    this.stallTrackers.clear();
    this.idToTorrent.clear();
    if (this.client) {
      // WebTorrent's destroy callback can hang if a socket is stuck; bound
      // the wait so shutdown never blocks indefinitely.
      await Promise.race([
        new Promise<void>((resolve) => this.client!.destroy(() => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, DESTROY_TIMEOUT_MS)),
      ]);
      this.client = null;
    }
  }

  // ---- internal helpers ----

  private clearMetadataTimer(id: string) {
    const timer = this.metadataTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.metadataTimers.delete(id);
    }
  }

  private checkStalled(id: string, torrent: Torrent, timeoutMs: number) {
    if (torrent.paused || torrent.done) {
      this.stallTrackers.delete(id);
      return;
    }
    const downloaded = torrent.downloaded ?? 0;
    const existing = this.stallTrackers.get(id);
    if (!existing) {
      this.stallTrackers.set(id, {
        lastProgressAt: Date.now(),
        lastDownloaded: downloaded,
      });
      return;
    }
    if (downloaded > existing.lastDownloaded) {
      existing.lastDownloaded = downloaded;
      existing.lastProgressAt = Date.now();
      return;
    }
    if (Date.now() - existing.lastProgressAt > timeoutMs) {
      this.emit(
        "error",
        id,
        new Error(
          `Stalled: no progress for ${Math.round(timeoutMs / 60_000)} minutes`,
        ),
      );
      this.clearProgressInterval(id);
      this.clearMetadataTimer(id);
      this.stallTrackers.delete(id);
      this.idToTorrent.delete(id);
      void torrent.destroy();
    }
  }

  private clearProgressInterval(id: string) {
    const timer = this.intervals.get(id);
    if (timer) {
      clearInterval(timer);
      this.intervals.delete(id);
    }
  }

  private emitProgress(id: string, torrent: Torrent) {
    const total = torrent.length || 0;
    const downloaded = torrent.downloaded ?? 0;
    const speed = torrent.downloadSpeed ?? 0;
    const remaining = total - downloaded;
    const eta = speed > 0 && remaining > 0 ? Math.ceil(remaining / speed) : -1;

    const prog: DownloadProgress = {
      downloadSpeed: speed,
      uploadSpeed: torrent.uploadSpeed ?? 0,
      progress: torrent.progress ?? 0,
      downloaded,
      uploaded: torrent.uploaded ?? 0,
      total,
      eta,
      peers: torrent.numPeers ?? 0,
      ratio: torrent.ratio ?? 0,
    };
    this.emit("progress", id, prog);
  }

  private toHandle(torrent: Torrent): TorrentHandle {
    return {
      infoHash: torrent.infoHash,
      name: torrent.name || torrent.infoHash,
      length: torrent.length || 0,
      progress: torrent.progress || 0,
      downloadSpeed: torrent.downloadSpeed || 0,
      uploadSpeed: torrent.uploadSpeed || 0,
      uploaded: torrent.uploaded || 0,
      downloaded: torrent.downloaded || 0,
      numPeers: torrent.numPeers || 0,
      ratio: torrent.ratio || 0,
      done: torrent.done || false,
      paused: torrent.paused || false,
    };
  }
}
