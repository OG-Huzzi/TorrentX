import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { EZTV_DOMAINS } from "./mirrors.js";
import { createResult, raceMirrors, safeIsoDate, topSlice } from "./source-utils.js";

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

const EZTV_ID = "eztv";
const EZTV_RELIABILITY = 0.86;

/**
 * Pure mapper: filter an EZTV get-torrents payload by query words and turn it
 * into search results. Exported for parser tests.
 */
export function mapEztvResults(
  payload: EztvResponse,
  queryWords: readonly string[],
  limit: number,
): ReturnType<typeof createResult>[] {
  return (payload.torrents ?? [])
    .filter((item) => queryWords.every((word) => item.title.toLowerCase().includes(word)))
    .slice(0, limit)
    .map((item) =>
      createResult({
        title: item.filename || item.title,
        source: EZTV_ID,
        sourceReliability: EZTV_RELIABILITY,
        sourceId: String(item.id),
        torrentUrl: item.torrent_url,
        magnetUri: item.magnet_url,
        sizeBytes: Number(item.size_bytes) || undefined,
        seeders: item.seeds,
        leechers: item.peers,
        uploadedAt: item.date_released_unix > 0
          ? safeIsoDate(item.date_released_unix * 1000)
          : undefined,
        mediaType: "tv",
        trusted: true,
      }),
    );
}

export class EztvAdapter implements SourceAdapter {
  readonly id = EZTV_ID;
  readonly name = "EZTV";
  readonly reliability = EZTV_RELIABILITY;
  readonly mediaTypes = ["tv"] as const;
  readonly regions = ["global", "usa", "europe", "korea"] as const;
  readonly supportsTop = true;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    if (request.intent.mediaType && request.intent.mediaType !== "tv") return [];
    const queryWords = request.top
      ? []
      : request.intent.query.toLowerCase().split(/\s+/);

    // The API has no server-side search; a mirror is only "empty" when its
    // payload is empty — a healthy mirror whose newest torrents simply do not
    // match the query must not trigger a race to every other mirror.
    const fetched = await raceMirrors(
      EZTV_DOMAINS,
      async (domain, signal) => {
        const base = `https://${domain}/api/get-torrents?limit=100`;
        const first = await this.http.json<EztvResponse>(`${base}&page=1`, signal);
        return { domain, base, torrents: first.torrents ?? [] };
      },
      request.signal,
      { isEmpty: (result) => result.torrents.length === 0 },
    );

    if (request.top) {
      // Top listing: the most-seeded of the recent episodes.
      return topSlice(
        mapEztvResults({ torrents: fetched.torrents }, queryWords, 100),
        request.top,
        request.limit,
      );
    }

    let results = mapEztvResults({ torrents: fetched.torrents }, queryWords, request.limit);
    // The API serves the newest 100 per page; older matches live on later
    // pages, so widen the window once — from the mirror that already answered.
    if (results.length === 0 && fetched.torrents.length >= 100) {
      const more = await Promise.all(
        [2, 3].map((page) =>
          this.http
            .json<EztvResponse>(`${fetched.base}&page=${page}`, request.signal)
            .catch(() => ({ torrents: [] }) as EztvResponse),
        ),
      );
      results = mapEztvResults(
        { torrents: more.flatMap((payload) => payload.torrents ?? []) },
        queryWords,
        request.limit,
      );
    }
    return results;
  }
}
