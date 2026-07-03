import { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import type WebTorrent from "webtorrent";
import type { Torrent } from "webtorrent";
import type { DownloadProgress } from "../types/download.js";

/**
 * Default tracker list injected into all added torrents for better peer
 * discovery. Curated from public, stable trackers.
 */
const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
];

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
  progress: (infoHash: string, progress: DownloadProgress) => void;
  done: (infoHash: string) => void;
  error: (infoHash: string, error: Error) => void;
  metadata: (infoHash: string, name: string, totalBytes: number) => void;
}

/**
 * Thin wrapper around WebTorrent. We lazily import it so the module doesn't
 * explode at import time if WebTorrent has issues.
 */
export class DownloadEngine extends EventEmitter {
  private client: WebTorrent | null = null;
  private intervals = new Map<string, ReturnType<typeof setInterval>>();
  private destroyed = false;

  private async ensureClient(): Promise<WebTorrent> {
    if (this.client) return this.client;
    const WTConstructor = (await import("webtorrent")).default;
    this.client = new WTConstructor();
    this.client.on("error", (err: Error) => {
      this.emit("error", "client", err);
    });
    return this.client;
  }

  async add(
    magnetOrUrl: string,
    downloadPath: string,
  ): Promise<TorrentHandle> {
    // Ensure the download directory exists before WebTorrent tries to write.
    await mkdir(downloadPath, { recursive: true });
    const client = await this.ensureClient();

    let torrent: Torrent;
    try {
      torrent = client.add(magnetOrUrl, { path: downloadPath, announce: DEFAULT_TRACKERS });
    } catch (err) {
      throw err;
    }

    const hash = torrent.infoHash;

    // Emit metadata once we know the torrent name/size.
    if (torrent.ready) {
      this.emit("metadata", hash, torrent.name, torrent.length);
    } else {
      torrent.once("metadata", () => {
        this.emit("metadata", hash, torrent.name, torrent.length);
      });
    }

    // Wire up error handler (non-fatal — just surfaces to UI).
    torrent.on("error", (err: Error) => {
      this.emit("error", hash, err);
    });

    torrent.on("done", () => {
      this.clearProgressInterval(hash);
      this.emitProgress(hash, torrent);
      this.emit("done", hash);
    });

    // Poll for progress updates immediately to show download speed/peers from the start.
    const timer = setInterval(() => {
      if (!torrent.destroyed) {
        this.emitProgress(hash, torrent);
      } else {
        this.clearProgressInterval(hash);
      }
    }, 500);
    this.intervals.set(hash, timer);

    return this.toHandle(torrent);
  }

  pause(infoHash: string): boolean {
    const torrent = this.findTorrent(infoHash);
    if (!torrent) return false;
    torrent.pause();
    return true;
  }

  resume(infoHash: string): boolean {
    const torrent = this.findTorrent(infoHash);
    if (!torrent) return false;
    torrent.resume();
    return true;
  }

  cancel(infoHash: string, destroyFiles = false): boolean {
    const torrent = this.findTorrent(infoHash);
    if (!torrent) return false;
    this.clearProgressInterval(infoHash);
    torrent.destroy({ destroyStore: destroyFiles });
    return true;
  }

  stopSeed(infoHash: string): boolean {
    return this.cancel(infoHash, false);
  }

  getHandle(infoHash: string): TorrentHandle | undefined {
    const torrent = this.findTorrent(infoHash);
    return torrent ? this.toHandle(torrent) : undefined;
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const timer of this.intervals.values()) clearInterval(timer);
    this.intervals.clear();
    if (this.client) {
      await new Promise<void>((resolve) =>
        this.client!.destroy(() => resolve()),
      );
      this.client = null;
    }
  }

  // ---- internal helpers ----

  private findTorrent(infoHash: string): Torrent | undefined {
    if (!this.client) return undefined;
    return this.client.torrents.find((t) => t.infoHash === infoHash);
  }

  private clearProgressInterval(infoHash: string) {
    const timer = this.intervals.get(infoHash);
    if (timer) {
      clearInterval(timer);
      this.intervals.delete(infoHash);
    }
  }

  private emitProgress(infoHash: string, torrent: Torrent) {
    const total = torrent.length || 1;
    const downloaded = torrent.downloaded ?? 0;
    const speed = torrent.downloadSpeed ?? 0;
    const remaining = total - downloaded;
    const eta = speed > 0 ? Math.ceil(remaining / speed) : -1;

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
    this.emit("progress", infoHash, prog);
  }

  private toHandle(torrent: Torrent): TorrentHandle {
    return {
      infoHash: torrent.infoHash,
      name: torrent.name,
      length: torrent.length,
      progress: torrent.progress,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      uploaded: torrent.uploaded,
      downloaded: torrent.downloaded,
      numPeers: torrent.numPeers,
      ratio: torrent.ratio,
      done: torrent.done,
      paused: torrent.paused,
    };
  }
}
