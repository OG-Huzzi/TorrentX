import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { createResult } from "./source-utils.js";

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

const YTS_DOMAINS = ["yts.mx", "yts.pm", "yts.lt", "yts.do", "yts.rs"];

export class YtsAdapter implements SourceAdapter {
  readonly id = "yts";
  readonly name = "YTS";
  readonly reliability = 0.92;
  readonly mediaTypes = ["movie"] as const;
  readonly regions = ["global", "usa", "india", "europe"] as const;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    if (request.intent.mediaType && request.intent.mediaType !== "movie") return [];

    let lastError: Error | undefined;
    for (const domain of YTS_DOMAINS) {
      try {
        const url = new URL(`https://${domain}/api/v2/list_movies.json`);
        url.searchParams.set("query_term", request.intent.query);
        url.searchParams.set("limit", String(Math.min(request.limit, 50)));
        url.searchParams.set("sort_by", "seeds");

        const payload = await this.http.json<YtsResponse>(url.toString(), request.signal);
        return (payload.data?.movies ?? []).flatMap((movie) =>
          (movie.torrents ?? []).map((torrent) =>
            createResult({
              title: `${movie.title_long} ${torrent.quality} ${torrent.type}`,
              source: this.id,
              sourceReliability: this.reliability,
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
      } catch (err) {
        lastError = err as Error;
      }
    }

    throw lastError || new Error("All YTS mirrors offline");
  }
}
