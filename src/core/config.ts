import type { TorrentXConfig } from "../types/config.js";

export function createConfig(overrides: Partial<TorrentXConfig> = {}): TorrentXConfig {
  return {
    cacheTtlMs: 10 * 60 * 1000,
    sourceTimeoutMs: 8_000,
    maxConcurrency: 8,
    metadataLimit: 5,
    tmdbApiKey: process.env.TMDB_API_KEY,
    omdbApiKey: process.env.OMDB_API_KEY,
    userAgent:
      process.env.TORRENTX_USER_AGENT ??
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    sourceProxyUrl: process.env.TORRENTX_SOURCE_PROXY || undefined,
    downloadDir: process.env.TORRENTX_DOWNLOAD_DIR || undefined,
    ...overrides,
  };
}
