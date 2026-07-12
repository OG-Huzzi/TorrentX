import { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import type WebTorrent from "webtorrent";
import type { Torrent } from "webtorrent";
import type { DownloadProgress } from "../types/download.js";

/**
 * Expanded tracker list injected into all added torrents for aggressive peer
 * discovery. Curated from the most reliable public trackers worldwide.
 */
const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://tracker.moeking.me:6969/announce",
  "udp://p4p.arenabg.com:1337/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://opentracker.i2p.rocks:6969/announce",
  "udp://47.ip-51-68-199.eu:6969/announce",
  "udp://tracker.internetwarriors.net:1337/announce",
  "udp://tracker.leechers-paradise.org:6969/announce",
  "udp://tracker.coppersurfer.tk:6969/announce",
  "udp://tracker.pirateparty.gr:6969/announce",
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.webtorrent.dev",
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
  private destroyed = false;

  private async ensureClient(): Promise<WebTorrent> {
    if (this.client) return this.client;
    const WTConstructor = (await import("webtorrent")).default;
    this.client = new WTConstructor({ maxConns: 100 });
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

    let torrent: Torrent;
    try {
      torrent = client.add(magnetOrTorrentPath, {
        path: downloadPath,
      });
    } catch (err) {
      throw err;
    }

    this.idToTorrent.set(id, torrent);

    // Emit metadata once we know the torrent name/size/torrentFile bytes.
    if (torrent.ready) {
      this.emit("metadata", id, torrent.name, torrent.length, torrent.torrentFile);
    } else {
      torrent.once("metadata", () => {
        this.emit("metadata", id, torrent.name, torrent.length, torrent.torrentFile);
      });
    }

    // Wire up error handler (non-fatal — just surfaces to UI).
    torrent.on("error", (err: Error) => {
      this.emit("error", id, err);
    });

    torrent.on("done", () => {
      this.clearProgressInterval(id);
      this.emitProgress(id, torrent);
      this.emit("done", id);
    });

    // Poll for progress updates immediately to show download speed/peers from the start.
    const timer = setInterval(() => {
      if (!torrent.destroyed) {
        this.emitProgress(id, torrent);
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
    this.idToTorrent.clear();
    if (this.client) {
      await new Promise<void>((resolve) =>
        this.client!.destroy(() => resolve()),
      );
      this.client = null;
    }
  }

  // ---- internal helpers ----

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
