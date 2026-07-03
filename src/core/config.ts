import type { TorrentXConfig } from "../types/config.js";

export function createConfig(overrides: Partial<TorrentXConfig> = {}): TorrentXConfig {
  return {
    cacheTtlMs: 10 * 60 * 1000,
    sourceTimeoutMs: 8_000,
    maxConcurrency: 8,
    metadataLimit: 5,
    tmdbApiKey: process.env.TMDB_API_KEY,
    omdbApiKey: process.env.OMDB_API_KEY,
    userAgent: "TorrentX/0.1 (+https://github.com/torrentx/torrentx)",
    downloadDir: process.env.TORRENTX_DOWNLOAD_DIR || undefined,
    ...overrides,
  };
}
