import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { YTS_DOMAINS } from "./mirrors.js";
import { createResult, raceMirrors, topSlice } from "./source-utils.js";

interface YtsResponse {
  data?: {
    movies?: Array<{
      id: number;
      title_long: string;
      year: number;
      language?: string;
      url: string;
      torrents?: Array<{
        hash: string;
        quality: string;
        type: string;
        seeds: number;
        peers: number;
        size_bytes: number;
        date_uploaded?: string;
      }>;
    }>;
  };
}

const YTS_ID = "yts";
const YTS_RELIABILITY = 0.92;

/**
 * Pure mapper: turn a YTS list_movies payload into search results.
 * Exported for parser tests — keeps fixture-based coverage independent
 * of the network.
 */
export function mapYtsResults(payload: YtsResponse): ReturnType<typeof createResult>[] {
  return (payload.data?.movies ?? []).flatMap((movie) =>
    (movie.torrents ?? []).map((torrent) =>
      createResult({
        title: `${movie.title_long} ${torrent.quality} ${torrent.type}`,
        source: YTS_ID,
        sourceReliability: YTS_RELIABILITY,
        sourceId: String(movie.id),
        detailsUrl: movie.url,
        magnetUri: `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(movie.title_long)}`,
        sizeBytes: torrent.size_bytes,
        seeders: torrent.seeds,
        leechers: torrent.peers,
        uploadedAt: torrent.date_uploaded,
        quality: torrent.quality,
        language: movie.language,
        mediaType: "movie",
        trusted: true,
      }),
    ),
  );
}

export class YtsAdapter implements SourceAdapter {
  readonly id = YTS_ID;
  readonly name = "YTS";
  readonly reliability = YTS_RELIABILITY;
  readonly mediaTypes = ["movie"] as const;
  readonly regions = ["global", "usa", "india", "europe"] as const;
  readonly supportsTop = true;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    if (request.intent.mediaType && request.intent.mediaType !== "movie") return [];

    return raceMirrors(
      YTS_DOMAINS,
      async (domain, signal) => {
        const url = new URL(`https://${domain}/api/v2/list_movies.json`);
        if (request.top) {
          // Top listing: most-seeded movies, filtered to the period.
          url.searchParams.set("sort_by", "seeds");
          url.searchParams.set("order_by", "desc");
          url.searchParams.set("limit", "100");
        } else {
          url.searchParams.set("query_term", request.intent.query);
          url.searchParams.set("limit", String(Math.min(request.limit, 50)));
          url.searchParams.set("sort_by", "seeds");
        }

        const payload = await this.http.json<YtsResponse>(url.toString(), signal);
        const mapped = mapYtsResults(payload);
        if (!request.top) return mapped;
        return topSlice(mapped, request.top, request.limit);
      },
      request.signal,
      { isEmpty: (results) => results.length === 0 },
    );
  }
}
