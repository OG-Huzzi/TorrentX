import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { buildMagnet } from "../utils/magnet.js";
import { parseSize } from "../utils/size.js";
import { createResult } from "./source-utils.js";

const DOMAINS = ["www.limetorrents.lol", "www.limetorrents.pro", "limetorrents.cc"];

/**
 * LimeTorrents adapter.
 *
 * LimeTorrents has no JSON API — we scrape the search results HTML.
 * Each result row is a `<tr bgcolor=...>` containing:
 *   - A `<div class="tt-name">` with:
 *       1. An itorrents.net `<a>` whose href contains the 40-char info_hash
 *       2. A second `<a>` linking to the details page with the title text
 *   - Subsequent `<td>` cells for: date/category, size, seeders, leechers
 *
 * The first few rows are ads (no itorrents link) and must be skipped.
 */
export class LimeTorrentsAdapter implements SourceAdapter {
  readonly id = "limetorrents";
  readonly name = "LimeTorrents";
  readonly reliability = 0.75;
  readonly mediaTypes = ["movie", "tv", "anime", "game", "software", "documentary", "other"] as const;
  readonly regions = ["global", "usa", "india", "europe"] as const;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    let lastError: Error | undefined;

    for (const domain of DOMAINS) {
      try {
        const url = `https://${domain}/search/all/${encodeURIComponent(request.intent.query)}/seeds/1/`;
        const html = await this.http.text(url, request.signal);
        return this.parseResults(html, domain, request.limit);
      } catch (err) {
        lastError = err as Error;
      }
    }

    throw lastError || new Error("All LimeTorrents mirrors offline");
  }

  private parseResults(html: string, domain: string, limit: number) {
    const results = [];

    // Match each <tr bgcolor=...>...</tr> block
    const rowRegex = /<tr\s+bgcolor="[^"]*">([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null && results.length < limit * 2) {
      const rowHtml = rowMatch[1]!;

      // Must contain an itorrents.net link (skip ad rows that don't have one)
      const hashMatch = rowHtml.match(
        /href="[^"]*itorrents\.net\/torrent\/([A-Fa-f0-9]{40})\.torrent[^"]*"/i,
      );
      if (!hashMatch) continue;
      const infoHash = hashMatch[1]!;

      // Extract the title from the second <a> inside tt-name (the details link)
      const titleMatch = rowHtml.match(
        /<a\s+href="(\/[^"]+\.html)"[^>]*>([^<]+)<\/a>/,
      );
      if (!titleMatch) continue;

      const detailsPath = titleMatch[1]!;
      const title = titleMatch[2]!
        .trim()
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
      if (!title || title.length < 3) continue;

      const detailsUrl = `https://${domain}${detailsPath}`;

      // Extract size from td cells — find all <td> content
      const tdValues: string[] = [];
      const tdRegex = /<td[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/td>/gi;
      let tdMatch;
      while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
        tdValues.push(tdMatch[1]!.replace(/<[^>]*>/g, "").trim());
      }

      // td order: [name_cell, date_category, size, seeders, leechers, health]
      // The first td contains the tt-name div, so useful data starts at index 1
      const sizeStr = tdValues.find((v) => /\d+(?:\.\d+)?\s*(?:GB|MB|KB|TB)/i.test(v));
      const seeders = Number(tdValues.find((v) => /^\d+$/.test(v.replace(/,/g, "")))?.replace(/,/g, "")) || 0;

      // Find seeders/leechers from tdseed/tdleech classes
      const seedMatch = rowHtml.match(/<td[^>]*class="tdseed"[^>]*>([^<]*)<\/td>/i);
      const leechMatch = rowHtml.match(/<td[^>]*class="tdleech"[^>]*>([^<]*)<\/td>/i);

      results.push(
        createResult({
          title,
          source: this.id,
          sourceReliability: this.reliability,
          detailsUrl,
          magnetUri: buildMagnet(infoHash, title),
          sizeBytes: parseSize(sizeStr),
          seeders: Number(seedMatch?.[1]?.replace(/,/g, "")) || seeders,
          leechers: Number(leechMatch?.[1]?.replace(/,/g, "")) || 0,
          trusted: false,
        }),
      );
    }

    return results;
  }
}
