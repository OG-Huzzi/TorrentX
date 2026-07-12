/**
 * Curated list of high-quality public trackers embedded into every magnet link
 * for maximum peer discovery out of the box.
 */
const MAGNET_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://tracker.moeking.me:6969/announce",
  "udp://p4p.arenabg.com:1337/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://opentracker.i2p.rocks:6969/announce",
];

export function buildMagnet(infoHash: string, title?: string): string {
  let magnet = `magnet:?xt=urn:btih:${infoHash}`;
  if (title) {
    magnet += `&dn=${encodeURIComponent(title)}`;
  }
  for (const tracker of MAGNET_TRACKERS) {
    magnet += `&tr=${encodeURIComponent(tracker)}`;
  }
  return magnet;
}

export function isMagnet(value?: string): value is string {
  return Boolean(value?.startsWith("magnet:?"));
}

export function sanitizeMagnet(uri: string): string {
  let sanitized = uri
    .replace(/xt=urn%3Abtih%3A/i, "xt=urn:btih:")
    .trim();

  // Standardize the 40-character infohash to lowercase for best tracker/peer compatibility.
  const infoHashRegex = /xt=urn:btih:([a-fA-F0-9]{40})/i;
  const match = sanitized.match(infoHashRegex);
  if (match && match[1]) {
    sanitized = sanitized.replace(match[1], match[1].toLowerCase());
  }

  return sanitized;
}
