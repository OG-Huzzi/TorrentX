import type { HttpClient } from "../services/http-client.js";
import type { SearchRequest, SourceAdapter, SearchResult } from "../types/search.js";
import { buildMagnet } from "../utils/magnet.js";
import { createResult } from "./source-utils.js";

const API = "https://bittorrented.com/api/search/torrents";
const MIN_QUERY_LENGTH = 3;

interface BitTorrentedItem {
  torrent_infohash?: string;
  torrent_name?: string;
  torrent_total_size?: number;
  torrent_seeders?: number | null;
  torrent_leechers?: number | null;
  torrent_created_at?: string;
}

interface BitTorrentedResponse {
  results?: BitTorrentedItem[];
}

export class BitTorrentedAdapter implements SourceAdapter {
  readonly id = "bittorrented";
  readonly name = "BitTorrented";
  readonly reliability = 0.84;
  readonly mediaTypes = ["movie", "tv", "documentary", "other"] as const;
  readonly regions = ["global", "usa", "india", "europe"] as const;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest): Promise<SearchResult[]> {
    const query = request.intent.query.trim();
    if (query.length < MIN_QUERY_LENGTH) return [];

    const url = new URL(API);
    url.searchParams.set("q", query);
    url.searchParams.set("type", "video");
    url.searchParams.set("limit", String(Math.min(request.limit, 50)));
    url.searchParams.set("sortBy", "seeders");
    url.searchParams.set("sortOrder", "desc");

    const payload = await this.http.json<BitTorrentedResponse>(
      url.toString(),
      request.signal,
    );
    return mapBitTorrentedResults(payload.results ?? [], request.limit, this);
  }
}

export function mapBitTorrentedResults(
  items: readonly BitTorrentedItem[],
  limit: number,
  source: Pick<SourceAdapter, "id" | "reliability"> = {
    id: "bittorrented",
    reliability: 0.84,
  },
): SearchResult[] {
  return items.slice(0, limit * 2).flatMap((item) => {
    const infoHash = item.torrent_infohash?.toLowerCase();
    if (!infoHash || !/^[a-f0-9]{40}$/.test(infoHash)) return [];

    const title = item.torrent_name?.trim() || infoHash;
    return [
      createResult({
        title,
        source: source.id,
        sourceReliability: source.reliability,
        sourceId: infoHash,
        magnetUri: buildMagnet(infoHash, title),
        sizeBytes: item.torrent_total_size || undefined,
        seeders: item.torrent_seeders ?? 0,
        leechers: item.torrent_leechers ?? 0,
        uploadedAt: toIsoDate(item.torrent_created_at),
        trusted: false,
      }),
    ];
  });
}

function toIsoDate(value?: string): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
