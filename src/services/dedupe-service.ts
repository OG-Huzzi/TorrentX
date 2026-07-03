import type { SearchResult } from "../types/search.js";
import { normalizeTitle } from "../utils/text.js";

export function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seenMagnets = new Set<string>();
  const bestByFingerprint = new Map<string, SearchResult>();

  for (const result of results) {
    const hash = result.magnetUri?.match(/urn:btih:([^&]+)/i)?.[1]?.toLowerCase();
    if (hash) {
      if (seenMagnets.has(hash)) continue;
      seenMagnets.add(hash);
    }

    const sizeBucket = result.sizeBytes ? Math.round(result.sizeBytes / 10_000_000) : "?";
    const fingerprint = `${normalizeTitle(result.title)}:${sizeBucket}`;
    const existing = bestByFingerprint.get(fingerprint);
    if (!existing || result.seeders > existing.seeders) {
      bestByFingerprint.set(fingerprint, result);
    }
  }

  return [...bestByFingerprint.values()];
}
