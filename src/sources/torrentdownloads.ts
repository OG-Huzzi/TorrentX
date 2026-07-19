import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { buildMagnet } from "../utils/magnet.js";
import { createResult, raceMirrors } from "./source-utils.js";

/**
 * TorrentDownloads adapter — JSON API.
 *
 * Aggregates torrents from multiple trackers with good seeder data.
 * Reliable for general content (movies, TV, software, games).
 */

const DOMAINS = ["www.torrentdownloads.pro", "www.torrentdownloads.me", "torrentdownloads.cc"];

interface TorrentDownloadsResponse {
  torrents?: Array<{
    hash?: string;
    name?: string;
    size?: number;
    seeders?: number;
    leechers?: number;
    date?: string;
    category?: string;
  }>;
}

export class TorrentDownloadsAdapter implements SourceAdapter {
  readonly id = "torrentdownloads";
  readonly name = "TorrentDownloads";
  readonly reliability = 0.80;
  readonly mediaTypes = ["movie", "tv", "anime", "game", "software", "documentary", "other"] as const;
  readonly regions = ["global", "usa", "india", "europe"] as const;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    return raceMirrors(
      DOMAINS,
      async (domain, signal) => {
        const url = new URL(`https://${domain}/api/torrents/search`);
        url.searchParams.set("q", request.intent.query);
        url.searchParams.set("limit", String(Math.min(request.limit * 2, 100)));

        const payload = await this.http.json<TorrentDownloadsResponse>(url.toString(), signal);
        if (!payload.torrents?.length) return [];

        return payload.torrents
          .filter((item) => item.hash && item.name)
          .slice(0, request.limit * 2)
          .map((item) =>
            createResult({
              title: item.name!,
              source: this.id,
              sourceReliability: this.reliability,
              sourceId: item.hash,
              magnetUri: buildMagnet(item.hash!, item.name!),
              sizeBytes: item.size || undefined,
              seeders: item.seeders ?? 0,
              leechers: item.leechers ?? 0,
              uploadedAt: item.date ? new Date(item.date).toISOString() : undefined,
              trusted: false,
            }),
          );
      },
      request.signal,
    );
  }
}
