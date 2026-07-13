/**
 * Curated public trackers ordered for maximum compatibility:
 *
 * 1. HTTP/HTTPS — work through any firewall/NAT, most reliable
 * 2. WSS — WebSocket trackers for WebRTC peer exchange
 * 3. UDP — fastest when unblocked, but firewalls often drop responses
 */
export const PUBLIC_TRACKERS = [
  // ---- HTTP/HTTPS (firewall-friendly, highest priority) ----
  "http://tracker.opentrackr.org:1337/announce",
  "https://tracker.tamersunion.org:443/announce",
  "https://tracker.lilithraws.org:443/announce",
  "http://tracker.openbittorrent.com:80/announce",
  "http://tracker.files.fm:6969/announce",
  "http://tracker1.bt.moack.co.kr:80/announce",
  "http://tracker.mywaifu.best:6969/announce",

  // ---- WebSocket (WebRTC peer exchange) ----
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.webtorrent.dev",

  // ---- UDP (fastest when unblocked) ----
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://tracker.moeking.me:6969/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://opentracker.i2p.rocks:6969/announce",
];

export function parseTrackerList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/[\r\n,]+/)
    .map((tracker) => tracker.trim())
    .filter(Boolean);
}

export function uniqueTrackers(trackers: Iterable<string>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const tracker of trackers) {
    const normalized = tracker.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

export function configuredTrackers(): string[] {
  const override = parseTrackerList(process.env.TORRENTX_TRACKERS);
  return uniqueTrackers(override.length > 0 ? override : PUBLIC_TRACKERS);
}
