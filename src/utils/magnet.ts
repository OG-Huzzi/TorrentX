import { configuredTrackers } from "./trackers.js";

export function buildMagnet(infoHash: string, title?: string): string {
  let magnet = `magnet:?xt=urn:btih:${infoHash}`;
  if (title) {
    magnet += `&dn=${encodeURIComponent(title)}`;
  }
  for (const tracker of configuredTrackers()) {
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

  // Merge default trackers if it is a magnet link to boost peer discovery without discarding original trackers.
  if (sanitized.startsWith("magnet:?")) {
    const existing = new Set<string>();
    const trMatches = sanitized.match(/tr=[^&]+/g);
    if (trMatches) {
      for (const m of trMatches) {
        try {
          existing.add(decodeURIComponent(m.slice(3)).toLowerCase());
        } catch {}
      }
    }

    for (const tracker of configuredTrackers()) {
      if (!existing.has(tracker.toLowerCase())) {
        sanitized += `&tr=${encodeURIComponent(tracker)}`;
      }
    }
  }

  return sanitized;
}
