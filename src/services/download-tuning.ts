import type { TorrentOptions, WebTorrentOptions } from "webtorrent";
import { configuredTrackers } from "../utils/trackers.js";

const DEFAULT_MAX_CONNS = 350;
const DEFAULT_STORE_CACHE_SLOTS = 96;
const DEFAULT_MAX_WEB_CONNS = 16;

type DownloadStrategy = "rarest" | "sequential";

export interface DownloadTuning {
  maxConns: number;
  maxWebConns: number;
  storeCacheSlots: number;
  strategy: DownloadStrategy;
}

function readBoundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function readStrategy(): DownloadStrategy {
  return process.env.TORRENTX_DOWNLOAD_STRATEGY === "sequential"
    ? "sequential"
    : "rarest";
}

/**
 * Resolve the settings that affect peer discovery and transfer throughput.
 * Values are bounded so an accidental environment value cannot exhaust a
 * mobile device or consumer router with thousands of connections.
 */
export function resolveDownloadTuning(): DownloadTuning {
  return {
    maxConns: readBoundedInteger("TORRENTX_MAX_CONNS", DEFAULT_MAX_CONNS, 55, 1200),
    maxWebConns: readBoundedInteger("TORRENTX_MAX_WEB_CONNS", DEFAULT_MAX_WEB_CONNS, 1, 96),
    storeCacheSlots: readBoundedInteger(
      "TORRENTX_STORE_CACHE_SLOTS",
      DEFAULT_STORE_CACHE_SLOTS,
      8,
      512,
    ),
    strategy: readStrategy(),
  };
}

/**
 * WebTorrent's defaults already leave transfer rates unlimited. These options
 * increase peer discovery and connection capacity without imposing a rate cap.
 */
export function webTorrentClientOptions(
  tuning = resolveDownloadTuning(),
): WebTorrentOptions {
  return {
    maxConns: tuning.maxConns,
    dht: true,
    tracker: {},
    lsd: true,
    utPex: true,
    natUpnp: true,
    natPmp: true,
    utp: true,
    seedOutgoingConnections: true,
  };
}

/**
 * Apply the same peer-discovery settings to magnets and cached .torrent files.
 * Rarest-piece selection makes better use of multiple independent peers.
 */
export function torrentAddOptions(
  downloadPath: string,
  tuning = resolveDownloadTuning(),
): TorrentOptions {
  return {
    path: downloadPath,
    announce: configuredTrackers(),
    strategy: tuning.strategy,
    storeCacheSlots: tuning.storeCacheSlots,
    maxWebConns: tuning.maxWebConns,
  };
}
