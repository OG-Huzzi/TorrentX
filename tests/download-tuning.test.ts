import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveDownloadTuning,
  resolveMaxParallelDownloads,
  resolveMetadataTimeout,
  resolveStallTimeoutMs,
  torrentAddOptions,
  webTorrentClientOptions,
} from "../src/services/download-tuning.js";

const ENV_KEYS = [
  "TORRENTX_MAX_CONNS",
  "TORRENTX_MAX_WEB_CONNS",
  "TORRENTX_STORE_CACHE_SLOTS",
  "TORRENTX_DOWNLOAD_STRATEGY",
  "TORRENTX_TRACKERS",
  "TORRENTX_METADATA_TIMEOUT_MS",
  "TORRENTX_MAX_PARALLEL_DOWNLOADS",
  "TORRENTX_STALL_TIMEOUT_MS",
] as const;

let savedEnvironment: Record<string, string | undefined>;

beforeEach(() => {
  savedEnvironment = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("download tuning", () => {
  it("uses a higher but bounded connection budget by default", () => {
    const tuning = resolveDownloadTuning();
    expect(tuning.maxConns).toBe(350);
    expect(tuning.maxWebConns).toBe(16);
    expect(tuning.storeCacheSlots).toBe(96);
    expect(tuning.strategy).toBe("rarest");
  });

  it("clamps connection settings from the environment", () => {
    process.env.TORRENTX_MAX_CONNS = "5000";
    process.env.TORRENTX_MAX_WEB_CONNS = "0";
    process.env.TORRENTX_STORE_CACHE_SLOTS = "not-a-number";

    const tuning = resolveDownloadTuning();
    expect(tuning.maxConns).toBe(1200);
    expect(tuning.maxWebConns).toBe(1);
    expect(tuning.storeCacheSlots).toBe(96);
  });

  it("supports sequential mode when it is explicitly requested", () => {
    process.env.TORRENTX_DOWNLOAD_STRATEGY = "sequential";
    expect(resolveDownloadTuning().strategy).toBe("sequential");
  });

  it("uses tracker overrides for both torrent sources", () => {
    process.env.TORRENTX_TRACKERS = "udp://tracker-one, udp://tracker-one\nudp://tracker-two";
    const options = torrentAddOptions("C:\\Downloads");

    expect(options.path).toBe("C:\\Downloads");
    expect(options.announce).toEqual(["udp://tracker-one", "udp://tracker-two"]);
    expect(options.strategy).toBe("rarest");
  });

  it("does not configure a download rate cap", () => {
    const options = webTorrentClientOptions();
    expect(options.maxConns).toBe(350);
    expect(options.downloadLimit).toBeUndefined();
    expect(options.uploadLimit).toBeUndefined();
  });

  it("disables the uTP transport (native utp-native crash surface)", () => {
    expect(webTorrentClientOptions().utp).toBe(false);
  });

  it("bounds the metadata fetch timeout", () => {
    expect(resolveMetadataTimeout()).toBe(60_000);

    process.env.TORRENTX_METADATA_TIMEOUT_MS = "1";
    expect(resolveMetadataTimeout()).toBe(10_000);

    process.env.TORRENTX_METADATA_TIMEOUT_MS = "999999999";
    expect(resolveMetadataTimeout()).toBe(600_000);

    process.env.TORRENTX_METADATA_TIMEOUT_MS = "30000";
    expect(resolveMetadataTimeout()).toBe(30_000);
  });

  it("bounds the parallel download cap", () => {
    expect(resolveMaxParallelDownloads()).toBe(3);

    process.env.TORRENTX_MAX_PARALLEL_DOWNLOADS = "0";
    expect(resolveMaxParallelDownloads()).toBe(1);

    process.env.TORRENTX_MAX_PARALLEL_DOWNLOADS = "500";
    expect(resolveMaxParallelDownloads()).toBe(16);

    process.env.TORRENTX_MAX_PARALLEL_DOWNLOADS = "5";
    expect(resolveMaxParallelDownloads()).toBe(5);
  });

  it("bounds the stall timeout", () => {
    expect(resolveStallTimeoutMs()).toBe(900_000);

    process.env.TORRENTX_STALL_TIMEOUT_MS = "1";
    expect(resolveStallTimeoutMs()).toBe(60_000);

    process.env.TORRENTX_STALL_TIMEOUT_MS = "999999999";
    expect(resolveStallTimeoutMs()).toBe(3_600_000);
  });
});
