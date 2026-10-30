export type DnsResolverMode = "system" | "doh";

export interface TorrentXConfig {
  cacheTtlMs: number;
  sourceTimeoutMs: number;
  maxConcurrency: number;
  metadataLimit: number;
  tmdbApiKey: string | undefined;
  omdbApiKey: string | undefined;
  userAgent: string;
  sourceProxyUrl?: string | undefined;
  downloadDir?: string | undefined;
  /** Absolute paths to plugin modules providing extra SourceAdapters. */
  plugins?: string[] | undefined;
  /** DNS strategy: "system" (default) or "doh" (DNS-over-HTTPS, defeats ISP DNS hijacking). */
  dnsResolver?: DnsResolverMode | undefined;
  /** Custom DNS-over-HTTPS endpoint (JSON API), used when dnsResolver is "doh". */
  dohUrl?: string | undefined;
  /** SOCKS5 proxy (socks5:// or socks5h://) for source requests, e.g. Tor or `ssh -D`. */
  socks5Proxy?: string | undefined;
  /** HTTP CONNECT proxy (http://) for source requests. */
  httpProxy?: string | undefined;
  /** Launch the built-in Tor daemon and route source requests through it. */
  tor?: boolean | undefined;
  /** Explicit Tor executable path (otherwise auto-detected). */
  torBinary?: string | undefined;
  /**
   * Minimum per-source timeout. Multi-hop proxies (Tor) add seconds of
   * latency per request; learned/adaptive timeouts would cut them off.
   */
  timeoutFloorMs?: number | undefined;
  /**
   * When a proxy is active and a request fails (sites often block Tor exit
   * nodes), retry that request over a direct connection. Default true for
   * user-configured proxies and false with the built-in Tor, so --tor stays
   * strict unless explicitly relaxed. Download traffic is never affected.
   */
  proxyFallback?: boolean | undefined;
}
