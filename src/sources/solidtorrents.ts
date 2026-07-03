import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { buildMagnet } from "../utils/magnet.js";
import { createResult } from "./source-utils.js";

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
    let lastError: Error | undefined;

    for (const domain of DOMAINS) {
      try {
        const url = new URL(`https://${domain}/api/v1/search`);
        url.searchParams.set("q", request.intent.query);

        const payload = await this.http.json<SolidTorrentsResponse>(url.toString(), request.signal);
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
      } catch (err) {
        lastError = err as Error;
      }
    }

    throw lastError || new Error("All SolidTorrents mirrors offline");
  }
}
