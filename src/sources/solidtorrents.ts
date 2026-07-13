import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { buildMagnet } from "../utils/magnet.js";
import { createResult, raceMirrors } from "./source-utils.js";

interface SolidTorrentsResponse {
  success?: boolean;
  results?: Array<{
    id: string;
    infohash: string;
    title: string;
    size: number;
    category: number;
    seeders: number;
    leechers: number;
    downloads: number;
    verified: boolean;
    updatedAt: string;
  }>;
  pagination?: { total: number };
}

const DOMAINS = ["solidtorrents.to", "solidtorrents.net"];

export class SolidTorrentsAdapter implements SourceAdapter {
  readonly id = "solidtorrents";
  readonly name = "SolidTorrents";
  readonly reliability = 0.85;
  readonly mediaTypes = ["movie", "tv", "anime", "game", "software", "documentary", "other"] as const;
  readonly regions = ["global", "usa", "india", "europe"] as const;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    return raceMirrors(
      DOMAINS,
      async (domain, signal) => {
        const url = new URL(`https://${domain}/api/v1/search`);
        url.searchParams.set("q", request.intent.query);

        const payload = await this.http.json<SolidTorrentsResponse>(url.toString(), signal);
        if (!payload.results?.length) return [];

        return payload.results.slice(0, request.limit * 2).map((item) =>
          createResult({
            title: item.title,
            source: this.id,
            sourceReliability: this.reliability,
            sourceId: item.id,
            detailsUrl: `https://${domain}/view/${item.id}`,
            magnetUri: buildMagnet(item.infohash, item.title),
            sizeBytes: item.size || undefined,
            seeders: item.seeders,
            leechers: item.leechers,
            uploadedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : undefined,
            trusted: item.verified,
          }),
        );
      },
      request.signal,
    );
  }
}
