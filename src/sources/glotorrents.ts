import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { buildMagnet } from "../utils/magnet.js";
import { parseSize } from "../utils/size.js";
import { createResult, raceMirrors } from "./source-utils.js";

/**
 * GloTorrents adapter — HTML scraping.
 *
 * Large general-purpose tracker with good coverage of movies, TV, and software.
 * Magnet links are available directly on search results page.
 */

const DOMAINS = ["glodls.to", "gtdb.to", "glotorrents.unblockit.pro"];

export class GloTorrentsAdapter implements SourceAdapter {
  readonly id = "glotorrents";
  readonly name = "GloTorrents";
  readonly reliability = 0.76;
  readonly mediaTypes = ["movie", "tv", "anime", "game", "software", "documentary", "other"] as const;
  readonly regions = ["global", "usa", "india", "europe"] as const;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    return raceMirrors(
      DOMAINS,
      async (domain, signal) => {
        const url = `https://${domain}/search_results.php?search=${encodeURIComponent(request.intent.query)}&cat=0&incldead=0&inclexternal=0&lang=0&sort=seeders&order=desc`;
        const html = await this.http.text(url, signal);
        return this.parseResults(html, domain, request.limit);
      },
      request.signal,
    );
  }

  private parseResults(html: string, domain: string, limit: number) {
    const results = [];

    // GloTorrents result rows are in <tr> blocks within a results table
    const rowRegex = /<tr\s+class="t-row"[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null && results.length < limit * 2) {
      const rowHtml = rowMatch[1]!;

      // Extract title from the torrent name link
      const titleMatch = rowHtml.match(
        /<a\s+href="\/torrent\/[^"]*"[^>]*title="([^"]+)"/i,
      ) || rowHtml.match(
        /<a\s+href="\/torrent\/[^"]*"[^>]*>([^<]+)<\/a>/i,
      );
      if (!titleMatch) continue;

      const title = titleMatch[1]!
        .trim()
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
      if (!title || title.length < 3) continue;

      // Extract magnet link
      const magnetMatch = rowHtml.match(/href="(magnet:\?[^"]+)"/i);
      if (!magnetMatch) continue;
      const magnetUri = magnetMatch[1]!.replace(/&amp;/g, "&");

      // Extract seeders and leechers
      const seedMatch = rowHtml.match(/<td[^>]*>\s*<b>\s*(\d[\d,]*)\s*<\/b>\s*<\/td>\s*<td[^>]*>\s*<b>\s*(\d[\d,]*)\s*<\/b>/i);
      const seeders = seedMatch ? Number(seedMatch[1]!.replace(/,/g, "")) : 0;
      const leechers = seedMatch ? Number(seedMatch[2]!.replace(/,/g, "")) : 0;

      // Extract size
      const sizeMatch = rowHtml.match(/([\d.]+)\s*(GB|MB|KB|TB)/i);
      const sizeBytes = sizeMatch ? parseSize(`${sizeMatch[1]} ${sizeMatch[2]}`) : undefined;

      results.push(
        createResult({
          title,
          source: this.id,
          sourceReliability: this.reliability,
          detailsUrl: `https://${domain}/torrent/${encodeURIComponent(title)}`,
          magnetUri,
          sizeBytes,
          seeders,
          leechers,
          trusted: false,
        }),
      );
    }

    return results;
  }
}
