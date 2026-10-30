import type { TorrentOptions, WebTorrentOptions } from "webtorrent";
import { configuredTrackers } from "../utils/trackers.js";

const DEFAULT_MAX_CONNS = 350;
const DEFAULT_STORE_CACHE_SLOTS = 96;
const DEFAULT_MAX_WEB_CONNS = 16;
const DEFAULT_METADATA_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_PARALLEL_DOWNLOADS = 3;
const DEFAULT_STALL_TIMEOUT_MS = 15 * 60_000;

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
 * Bound the wait for torrent metadata (magnet → name/size). Dead magnets with
 * no trackers or peers would otherwise stay in "downloading" forever.
 */
export function resolveMetadataTimeout(): number {
  return readBoundedInteger(
    "TORRENTX_METADATA_TIMEOUT_MS",
    DEFAULT_METADATA_TIMEOUT_MS,
    10_000,
    600_000,
  );
}

/**
 * Cap on concurrently active downloads. Downloads beyond the cap stay
 * "queued" and start automatically as slots free up. Each active torrent
 * opens up to TORRENTX_MAX_CONNS connections, so this keeps aggregate
 * connection counts bounded.
 */
export function resolveMaxParallelDownloads(): number {
  return readBoundedInteger(
    "TORRENTX_MAX_PARALLEL_DOWNLOADS",
    DEFAULT_MAX_PARALLEL_DOWNLOADS,
    1,
    16,
  );
}

/**
 * How long a download may go without any progress before it is considered
 * stalled and errored out (instead of hanging in "downloading" forever).
 */
export function resolveStallTimeoutMs(): number {
  return readBoundedInteger(
    "TORRENTX_STALL_TIMEOUT_MS",
    DEFAULT_STALL_TIMEOUT_MS,
    60_000,
    3_600_000,
  );
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
    // uTP is deliberately off: it pulls in the native utp-native module (the
    // only native dependency in the tree, a liability on Termux/ARM) and its
    // Connection objects can emit unhandled 'error' events before webtorrent
    // attaches listeners, killing the whole process mid-download. TCP + DHT +
    // PEX + trackers is the well-tested path.
    utp: false,
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
