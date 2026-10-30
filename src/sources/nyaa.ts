import { XMLParser } from "fast-xml-parser";
import type { SearchIntent, SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { parseSize } from "../utils/size.js";
import { NYAA_HOST } from "./mirrors.js";
import { createResult, safeIsoDate, topSlice } from "./source-utils.js";

interface NyaaItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  "nyaa:seeders"?: number | string;
  "nyaa:leechers"?: number | string;
  "nyaa:size"?: string;
  "nyaa:infoHash"?: string;
  "nyaa:trusted"?: string;
}

const NYAA_ID = "nyaa";
const NYAA_RELIABILITY = 0.9;
const nyaaParser = new XMLParser({ ignoreAttributes: false });

/** Nyaa browse categories per media type (verified c= subcategory codes). */
const NYAA_CATEGORIES: Partial<Record<string, string>> = {
  anime: "1_2",
  tv: "4_2",
  movie: "4_3",
  game: "6_2",
  software: "6_1",
};

/**
 * Pure mapper: parse a Nyaa RSS feed into search results. Exported for
 * parser tests.
 */
export function parseNyaaResults(
  xml: string,
  limit: number,
  intent: Pick<SearchIntent, "mediaType" | "region" | "language"> = {},
): ReturnType<typeof createResult>[] {
  const parsed = nyaaParser.parse(xml) as {
    rss?: { channel?: { item?: NyaaItem | NyaaItem[] } };
  };
  const raw = parsed.rss?.channel?.item;
  const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];

  return items.slice(0, limit * 2).flatMap((item) => {
    if (!item.title) return [];
    const hash = item["nyaa:infoHash"];
    const magnetUri = hash
      ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(item.title)}`
      : undefined;
    return [
      createResult({
        title: item.title,
        source: NYAA_ID,
        sourceReliability: NYAA_RELIABILITY,
        detailsUrl: item.guid ?? item.link,
        torrentUrl: item.link,
        magnetUri,
        sizeBytes: parseSize(item["nyaa:size"]),
        seeders: Number(item["nyaa:seeders"]) || 0,
        leechers: Number(item["nyaa:leechers"]) || 0,
        uploadedAt: safeIsoDate(item.pubDate),
        mediaType: intent.mediaType ?? "anime",
        region: intent.region ?? "japan",
        language: intent.language,
        trusted: item["nyaa:trusted"] === "Yes",
      }),
    ];
  });
}

export class NyaaAdapter implements SourceAdapter {
  readonly id = NYAA_ID;
  readonly name = "Nyaa";
  readonly reliability = NYAA_RELIABILITY;
  readonly mediaTypes = ["anime", "tv", "movie", "other"] as const;
  readonly regions = ["global", "japan", "korea", "china"] as const;
  readonly supportsTop = true;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    const url = new URL(`https://${NYAA_HOST}/`);
    url.searchParams.set("page", "rss");
    if (request.top) {
      // Top listing: most-seeded entries in the category.
      url.searchParams.set("s", "seeders");
      url.searchParams.set("o", "desc");
      const category = request.intent.mediaType
        ? NYAA_CATEGORIES[request.intent.mediaType]
        : undefined;
      if (category) url.searchParams.set("c", category);
    } else {
      url.searchParams.set("q", request.intent.query);
    }
    const xml = await this.http.text(url.toString(), request.signal);
    const mapped = parseNyaaResults(xml, request.limit, request.intent);
    return request.top ? topSlice(mapped, request.top, request.limit) : mapped;
  }
}
