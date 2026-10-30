import type { Region, SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { buildMagnet } from "../utils/magnet.js";
import { PIRATEBAY_HOST } from "./mirrors.js";
import { createResult } from "./source-utils.js";

interface PirateBayItem {
  id: string;
  name: string;
  info_hash: string;
  leechers: string;
  seeders: string;
  num_files: string;
  size: string;
  username: string;
  added: string;
  status: string;
  category: string;
  imdb?: string;
}

const PIRATEBAY_ID = "piratebay";
const PIRATEBAY_RELIABILITY = 0.72;

/**
 * Pure mapper: turn an apibay q.php payload into search results.
 * Exported for parser tests.
 */
export function mapPirateBayResults(
  items: PirateBayItem[],
  limit: number,
  region?: Region,
): ReturnType<typeof createResult>[] {
  return items.slice(0, limit * 2).map((item) =>
    createResult({
      title: item.name,
      source: PIRATEBAY_ID,
      sourceReliability: PIRATEBAY_RELIABILITY,
      sourceId: item.id,
      detailsUrl: `https://thepiratebay.org/description.php?id=${item.id}`,
      magnetUri: buildMagnet(item.info_hash, item.name),
      sizeBytes: Number(item.size) || undefined,
      seeders: Number(item.seeders) || 0,
      leechers: Number(item.leechers) || 0,
      uploadedAt: toIsoDate(item.added),
      region,
      trusted: item.status === "trusted" || item.status === "vip",
    }),
  );
}

export class PirateBayAdapter implements SourceAdapter {
  readonly id = PIRATEBAY_ID;
  readonly name = "The Pirate Bay";
  readonly reliability = PIRATEBAY_RELIABILITY;
  readonly mediaTypes = ["movie", "tv", "anime", "game", "software", "documentary", "other"] as const;
  readonly regions = ["global", "usa", "india", "japan", "korea", "china", "europe"] as const;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    if (request.top) return [];
    const url = `https://${PIRATEBAY_HOST}/q.php?q=${encodeURIComponent(request.intent.query)}`;
    const items = await this.http.json<PirateBayItem[]>(url, request.signal);
    if (!Array.isArray(items) || (items.length === 1 && items[0]?.id === "0")) return [];

    return mapPirateBayResults(items, request.limit, request.intent.region);
  }
}

function toIsoDate(epoch: string): string | undefined {
  const value = Number(epoch);
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : undefined;
}
