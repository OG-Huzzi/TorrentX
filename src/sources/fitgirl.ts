import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { decodeEntities } from "../utils/text.js";
import { FITGIRL_HOST } from "./mirrors.js";
import { createResult, safeIsoDate, topSlice } from "./source-utils.js";

/**
 * FitGirl Repacks Adapter.
 *
 * Fetches search results from FitGirl's WordPress RSS feed (?s=query&feed=rss2).
 * Extracts game title, details link, pubDate, and the direct magnet URI from
 * the post content inside each <item> block.
 */
const FITGIRL_ID = "fitgirl";
const FITGIRL_RELIABILITY = 0.88;

export class FitGirlAdapter implements SourceAdapter {
  readonly id = FITGIRL_ID;
  readonly name = "FitGirl Repacks";
  readonly reliability = FITGIRL_RELIABILITY;
  readonly mediaTypes = ["game"] as const;
  readonly regions = ["global", "usa", "europe"] as const;
  readonly supportsTop = true;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    if (request.intent.mediaType && request.intent.mediaType !== "game") return [];

    const url = request.top
      ? `https://${FITGIRL_HOST}/feed/`
      : `https://${FITGIRL_HOST}/?s=${encodeURIComponent(
          request.intent.query,
        )}&feed=rss2`;
    const xml = await this.http.text(url, request.signal);

    const mapped = parseFitgirlResults(xml, request.top ? 100 : request.limit);
    return request.top ? topSlice(mapped, request.top, request.limit) : mapped;
  }
}

/**
 * Pure mapper: parse a FitGirl WordPress RSS feed into search results.
 * Exported for parser tests.
 */
export function parseFitgirlResults(xml: string, limit: number): ReturnType<typeof createResult>[] {
  const items = xml.split("<item>").slice(1);
  const results: ReturnType<typeof createResult>[] = [];

  for (const item of items) {
    const titleMatch = item.match(/<title>([^<]+)<\/title>/);
    const linkMatch = item.match(/<link>([^<]+)<\/link>/);
    const pubDateMatch = item.match(/<pubDate>([^<]+)<\/pubDate>/);

    if (!titleMatch || !linkMatch) continue;

    const title = decodeEntities(titleMatch[1]!);
    const detailsUrl = linkMatch[1]!.trim();
    const pubDate = pubDateMatch?.[1];

    // Match magnet link in the item body (could be inside href="..." or plain text)
    // Matches both double-quoted href="magnet:..." and unquoted magnet:...
    const magnetMatch =
      item.match(/href="([^"]*magnet:\?xt=urn:btih:[^"]*)"/i) ||
      item.match(/(magnet:\?xt=urn:btih:[^\s<>"]+)/i);

    const magnetUri = magnetMatch ? decodeEntities(magnetMatch[1]!) : undefined;

    // Filter out digest updates which do not contain game magnet links
    if (title.toLowerCase().includes("updates digest") && !magnetUri) {
      continue;
    }

    results.push(
      createResult({
        title,
        source: FITGIRL_ID,
        sourceReliability: FITGIRL_RELIABILITY,
        detailsUrl,
        magnetUri,
        uploadedAt: safeIsoDate(pubDate),
        mediaType: "game",
        trusted: true,
      }),
    );
  }

  return results.slice(0, limit);
}
