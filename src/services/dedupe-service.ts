import type { SearchResult } from "../types/search.js";
import { infoHashFromMagnet } from "../utils/magnet.js";
import { normalizeTitle } from "../utils/text.js";

export function dedupeResults(results: SearchResult[]): SearchResult[] {
  const bestByMagnet = new Map<string, SearchResult>();
  const bestByFingerprint = new Map<string, SearchResult>();

  for (const result of results) {
    const hash = infoHashFromMagnet(result.magnetUri);
    if (hash) {
      // Same info hash found on multiple sources: keep the healthiest copy
      // (most seeders, then highest score) rather than whichever came first.
      const existing = bestByMagnet.get(hash);
      if (!existing) {
        bestByMagnet.set(hash, result);
      } else if (
        result.seeders > existing.seeders ||
        (result.seeders === existing.seeders && result.score > existing.score)
      ) {
        bestByMagnet.set(hash, result);
      }
      continue;
    }

    const sizeBucket = result.sizeBytes ? Math.round(result.sizeBytes / 10_000_000) : "?";
    const fingerprint = `${normalizeTitle(result.title)}:${sizeBucket}`;
    const existing = bestByFingerprint.get(fingerprint);
    if (!existing || result.seeders > existing.seeders) {
      bestByFingerprint.set(fingerprint, result);
    }
  }

  return [...bestByMagnet.values(), ...bestByFingerprint.values()];
}
