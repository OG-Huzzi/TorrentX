import { lookup } from "node:dns/promises";

/**
 * Pre-resolve DNS for all source domains at startup.
 * This eliminates DNS lookup latency (typically 20-100ms per domain)
 * from the critical path of the first search query.
 *
 * Runs entirely in the background — never blocks or throws.
 */

const SOURCE_DOMAINS = [
  // JSON API sources (fastest, most important to warm up)
  "yts.am",
  "yts.mx",
  "nyaa.si",
  "eztv.re",
  "eztvx.to",
  "apibay.org",
  "solidtorrents.to",
  "bitsearch.to",
  "bittorrented.com",
  // HTML scraping sources
  "1337x.to",
  "1337x.st",
  "torrentgalaxy.to",
  "www.limetorrents.lol",
  // Anime
  "subsplease.org",
  // Fallback
  "fmhy.xyz",
];

/**
 * Warm up DNS resolution for all known source domains.
 * Call once at startup — fire-and-forget, never throws.
 */
export function warmupDns(): void {
  for (const domain of SOURCE_DOMAINS) {
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
export function warmupDnsFast(): void {
  const priority = SOURCE_DOMAINS.slice(0, 8);
  for (const domain of priority) {
    lookup(domain, { family: 0 }).catch(() => {});
  }
}
