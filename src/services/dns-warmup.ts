import { lookup } from "node:dns/promises";
import type { TorrentXConfig } from "../types/config.js";
import { ALL_SOURCE_HOSTS } from "../sources/mirrors.js";

/**
 * Pre-resolve DNS for all source domains at startup.
 * This eliminates DNS lookup latency (typically 20-100ms per domain)
 * from the critical path of the first search query.
 *
 * The domain list comes from src/sources/mirrors.ts — the same arrays the
 * source adapters use — so it can never drift out of sync with them.
 *
 * Runs entirely in the background — never blocks or throws.
 */

/**
 * Warmup goes through the system resolver, so it only helps (and is only
 * harmless) when source requests use that resolver too. With Tor, a proxy,
 * DoH or a source proxy the lookups would be wasted — and would hand every
 * source domain to the local resolver, which those modes exist to avoid.
 */
export function shouldWarmupDns(
  config: Pick<
    TorrentXConfig,
    "tor" | "socks5Proxy" | "httpProxy" | "dnsResolver" | "sourceProxyUrl"
  >,
): boolean {
  return (
    !config.tor &&
    !config.socks5Proxy &&
    !config.httpProxy &&
    !config.sourceProxyUrl &&
    config.dnsResolver !== "doh"
  );
}

/**
 * Warm up DNS resolution for all known source domains.
 * Call once at startup — fire-and-forget, never throws.
 */
export function warmupDns(hosts: readonly string[] = ALL_SOURCE_HOSTS): void {
  for (const domain of hosts) {
    lookup(domain, { family: 0 }).catch(() => {
      // Silently ignore — domain may be offline, that's fine
    });
  }
}

/**
 * Warm up DNS only for the highest-priority sources.
 * Faster than full warmup, good for mobile/Termux where
 * we want to minimize startup work.
 */
export function warmupDnsFast(hosts: readonly string[] = ALL_SOURCE_HOSTS.slice(0, 8)): void {
  for (const domain of hosts) {
    lookup(domain, { family: 0 }).catch(() => {});
  }
}
