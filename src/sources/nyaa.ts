import { XMLParser } from "fast-xml-parser";
import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { parseSize } from "../utils/size.js";
import { createResult } from "./source-utils.js";

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

export class NyaaAdapter implements SourceAdapter {
  readonly id = "nyaa";
  readonly name = "Nyaa";
  readonly reliability = 0.9;
  readonly mediaTypes = ["anime", "tv", "movie", "other"] as const;
  readonly regions = ["global", "japan", "korea", "china"] as const;
  private readonly parser = new XMLParser({ ignoreAttributes: false });

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    const url = new URL("https://nyaa.si/");
    url.searchParams.set("page", "rss");
    url.searchParams.set("q", request.intent.query);
    const xml = await this.http.text(url.toString(), request.signal);
    const parsed = this.parser.parse(xml) as {
      rss?: { channel?: { item?: NyaaItem | NyaaItem[] } };
    };
    const raw = parsed.rss?.channel?.item;
    const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];

    return items.slice(0, request.limit * 2).flatMap((item) => {
      if (!item.title) return [];
      const hash = item["nyaa:infoHash"];
      const magnetUri = hash
        ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(item.title)}`
        : undefined;
      return [
        createResult({
          title: item.title,
          source: this.id,
          sourceReliability: this.reliability,
          detailsUrl: item.guid ?? item.link,
          torrentUrl: item.link,
          magnetUri,
          sizeBytes: parseSize(item["nyaa:size"]),
          seeders: Number(item["nyaa:seeders"]) || 0,
          leechers: Number(item["nyaa:leechers"]) || 0,
          uploadedAt: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
          mediaType: request.intent.mediaType ?? "anime",
          region: request.intent.region ?? "japan",
          language: request.intent.language,
          trusted: item["nyaa:trusted"] === "Yes",
        }),
      ];
    });
  }
}
