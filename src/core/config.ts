import type { DnsResolverMode, TorrentXConfig } from "../types/config.js";
import { loadConfigFile } from "./config-file.js";

/**
 * Build the effective configuration.
 *
 * Precedence (lowest to highest): built-in defaults < config file
 * (torrentx.json / .torrentxrc) < environment variables < explicit overrides.
 */
export function createConfig(overrides: Partial<TorrentXConfig> = {}): TorrentXConfig {
  const file = loadConfigFile();

  // Environment-backed values win over the config file but lose to overrides.
  const fromEnv: Partial<TorrentXConfig> = {
    tmdbApiKey: process.env.TMDB_API_KEY ?? file.tmdbApiKey,
    omdbApiKey: process.env.OMDB_API_KEY ?? file.omdbApiKey,
    userAgent:
      process.env.TORRENTX_USER_AGENT ??
      file.userAgent ??
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    sourceProxyUrl: process.env.TORRENTX_SOURCE_PROXY || file.sourceProxyUrl || undefined,
    downloadDir: process.env.TORRENTX_DOWNLOAD_DIR || file.downloadDir || undefined,
    torBinary: process.env.TORRENTX_TOR_BINARY || file.torBinary || undefined,
    ...resolveDns(file.dnsResolver, file.dohUrl),
    ...resolveProxies(file.socks5Proxy, file.httpProxy),
    ...resolveTor(file.tor),
    ...resolveProxyFallback(file.proxyFallback),
  };

  return {
    cacheTtlMs: 10 * 60 * 1000,
    sourceTimeoutMs: 10_000,
    maxConcurrency: 12,
    metadataLimit: 5,
    tmdbApiKey: undefined,
    omdbApiKey: undefined,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    // Config file values sit above the defaults…
    ...file,
    // …but environment values and explicit overrides win over the file.
    ...fromEnv,
    ...overrides,
  };
}

/**
 * TORRENTX_DNS accepts: "system", "doh", or "doh:<provider-url>".
 */
function resolveDns(
  fileMode: DnsResolverMode | undefined,
  fileDohUrl: string | undefined,
): Partial<TorrentXConfig> {
  const raw = process.env.TORRENTX_DNS?.trim() || undefined;
  if (raw === "system") return { dnsResolver: "system" };
  if (raw === "doh") return { dnsResolver: "doh", ...(fileDohUrl ? { dohUrl: fileDohUrl } : {}) };
  if (raw?.startsWith("doh:")) {
    return { dnsResolver: "doh", dohUrl: raw.slice("doh:".length) };
  }
  return fileMode ? { dnsResolver: fileMode, ...(fileDohUrl ? { dohUrl: fileDohUrl } : {}) } : {};
}

/**
 * TORRENTX_TOR=1/true enables the built-in Tor connection. The config file
 * `tor: true` applies unless the env var explicitly disables it.
 */
function resolveTor(fileTor: boolean | undefined): Partial<TorrentXConfig> {
  const raw = process.env.TORRENTX_TOR?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return { tor: true };
  if (raw === "0" || raw === "false" || raw === "no") return { tor: false };
  return fileTor !== undefined ? { tor: fileTor } : {};
}

/**
 * TORRENTX_PROXY_FALLBACK=0 disables the automatic direct retry for requests
 * that fail through a proxy. Default: enabled for user proxies, disabled
 * with the built-in Tor (see cli.ts).
 */
function resolveProxyFallback(
  fileValue: boolean | undefined,
): Partial<TorrentXConfig> {
  const raw = process.env.TORRENTX_PROXY_FALLBACK?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return { proxyFallback: false };
  if (raw === "1" || raw === "true" || raw === "yes") return { proxyFallback: true };
  return fileValue !== undefined ? { proxyFallback: fileValue } : {};
}

/**
 * Proxy precedence: TORRENTX_* vars, then the config file, then the standard
 * ALL_PROXY / HTTPS_PROXY environment variables (many VPNs and tunnels set
 * those globally).
 */
function resolveProxies(
  fileSocks: string | undefined,
  fileHttp: string | undefined,
): Partial<TorrentXConfig> {
  const socks5Proxy = process.env.TORRENTX_SOCKS5_PROXY || fileSocks || undefined;
  const httpProxy = process.env.TORRENTX_HTTP_PROXY || fileHttp || undefined;
  if (socks5Proxy || httpProxy) return { socks5Proxy, httpProxy };

  const all = process.env.ALL_PROXY ?? process.env.all_proxy;
  if (all) {
    return all.startsWith("socks")
      ? { socks5Proxy: all }
      : { httpProxy: all };
  }

  const https =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;
  return https ? { httpProxy: https } : {};
}
