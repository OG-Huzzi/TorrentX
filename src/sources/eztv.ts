import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { createResult, raceMirrors } from "./source-utils.js";

interface EztvResponse {
  torrents?: Array<{
    id: number;
    hash: string;
    filename: string;
    torrent_url: string;
    magnet_url: string;
    title: string;
    imdb_id?: string;
    seeds: number;
    peers: number;
    size_bytes: string;
    date_released_unix: number;
  }>;
}

const EZTV_DOMAINS = ["eztv.re", "eztvx.to", "eztv1.xyz", "eztv.wf", "eztv.tf", "eztv.yt"];

export class EztvAdapter implements SourceAdapter {
  readonly id = "eztv";
  readonly name = "EZTV";
  readonly reliability = 0.86;
  readonly mediaTypes = ["tv"] as const;
  readonly regions = ["global", "usa", "europe", "korea"] as const;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    if (request.intent.mediaType && request.intent.mediaType !== "tv") return [];
    const queryWords = request.intent.query.toLowerCase().split(/\s+/);

    return raceMirrors(
      EZTV_DOMAINS,
      async (domain, signal) => {
        const payload = await this.http.json<EztvResponse>(
          `https://${domain}/api/get-torrents?limit=100&page=1`,
          signal,
        );

        return (payload.torrents ?? [])
          .filter((item) => queryWords.every((word) => item.title.toLowerCase().includes(word)))
          .slice(0, request.limit)
          .map((item) =>
            createResult({
              title: item.filename || item.title,
              source: this.id,
              sourceReliability: this.reliability,
              sourceId: String(item.id),
              torrentUrl: item.torrent_url,
              magnetUri: item.magnet_url,
              sizeBytes: Number(item.size_bytes) || undefined,
              seeders: item.seeds,
              leechers: item.peers,
              uploadedAt: new Date(item.date_released_unix * 1000).toISOString(),
              mediaType: "tv",
              trusted: true,
            }),
          );
      },
      request.signal,
    );
  }
}
