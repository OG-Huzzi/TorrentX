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

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32ToHex(value: string): string | undefined {
  let bits = 0;
  let buffer = 0;
  let hex = "";
  for (const char of value.toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) return undefined;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      hex += ((buffer >> bits) & 0xff).toString(16).padStart(2, "0");
    }
  }
  return hex;
}

/**
 * The BitTorrent v1 info hash of a magnet as 40 lowercase hex characters.
 * Magnets carry it as hex (40 chars) or base32 (32 chars); both forms of the
 * same torrent must compare equal for dedupe, consensus and duplicate checks.
 */
export function infoHashFromMagnet(uri: string | undefined): string | undefined {
  const raw = uri?.match(/[?&]xt=urn:btih:([^&]+)/i)?.[1];
  if (!raw) return undefined;
  if (/^[a-f0-9]{40}$/i.test(raw)) return raw.toLowerCase();
  if (/^[a-z2-7]{32}$/i.test(raw)) return base32ToHex(raw);
  return undefined;
}
