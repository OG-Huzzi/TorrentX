import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { createResult } from "./source-utils.js";

/**
 * FitGirl Repacks Adapter.
 *
 * Fetches search results from FitGirl's WordPress RSS feed (?s=query&feed=rss2).
 * Extracts game title, details link, pubDate, and the direct magnet URI from
 * the post content inside each <item> block.
 */
export class FitGirlAdapter implements SourceAdapter {
  readonly id = "fitgirl";
  readonly name = "FitGirl Repacks";
  readonly reliability = 0.88;
  readonly mediaTypes = ["game"] as const;
  readonly regions = ["global", "usa", "europe"] as const;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    if (request.intent.mediaType && request.intent.mediaType !== "game") return [];

    const url = `https://fitgirl-repacks.site/?s=${encodeURIComponent(
      request.intent.query,
    )}&feed=rss2`;
    const xml = await this.http.text(url, request.signal);

    const items = xml.split("<item>").slice(1);
    const results = [];

    for (const item of items) {
      const titleMatch = item.match(/<title>([^<]+)<\/title>/);
      const linkMatch = item.match(/<link>([^<]+)<\/link>/);
      const pubDateMatch = item.match(/<pubDate>([^<]+)<\/pubDate>/);

      if (!titleMatch || !linkMatch) continue;

      const title = decodeHtml(titleMatch[1]!);
      const detailsUrl = linkMatch[1]!.trim();
      const pubDate = pubDateMatch?.[1];

      // Match magnet link in the item body (could be inside href="..." or plain text)
      // Matches both double-quoted href="magnet:..." and unquoted magnet:...
      const magnetMatch =
        item.match(/href="([^"]*magnet:\?xt=urn:btih:[^"]*)"/i) ||
        item.match(/(magnet:\?xt=urn:btih:[^\s<>"]+)/i);

      let magnetUri = magnetMatch ? decodeHtml(magnetMatch[1]!) : undefined;

      // Filter out digest updates which do not contain game magnet links
      if (title.toLowerCase().includes("updates digest") && !magnetUri) {
        continue;
      }

      results.push(
        createResult({
          title,
          source: this.id,
          sourceReliability: this.reliability,
          detailsUrl,
          magnetUri,
          uploadedAt: pubDate ? new Date(pubDate).toISOString() : undefined,
          mediaType: "game",
          trusted: true,
        }),
      );
    }

    return results.slice(0, request.limit);
  }
}

function decodeHtml(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8211;/g, "–")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
