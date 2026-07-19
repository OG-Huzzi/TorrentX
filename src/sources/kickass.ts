import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { buildMagnet } from "../utils/magnet.js";
import { parseSize } from "../utils/size.js";
import { createResult, raceMirrors } from "./source-utils.js";

/**
 * KickAss Torrents adapter — HTML scraping.
 *
 * KAT mirrors have a large database of torrents across all categories.
 * Good for older content that may have disappeared from other sources.
 */

const DOMAINS = ["kickasstorrents.to", "katcr.to", "kickass.cr", "thekat.cc"];

export class KickAssAdapter implements SourceAdapter {
  readonly id = "kickass";
  readonly name = "KickAss";
  readonly reliability = 0.74;
  readonly mediaTypes = ["movie", "tv", "anime", "game", "software", "documentary", "other"] as const;
  readonly regions = ["global", "usa", "india", "europe"] as const;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    return raceMirrors(
      DOMAINS,
      async (domain, signal) => {
        const url = `https://${domain}/usearch/${encodeURIComponent(request.intent.query)}/?field=seeders&sorder=desc`;
        const html = await this.http.text(url, signal);
        return this.parseResults(html, request.limit);
      },
      request.signal,
    );
  }

  private parseResults(html: string, limit: number) {
    const results = [];

    // KAT result rows are in <tr> with class "odd" or "even" inside a table
    const rowRegex = /<tr\s+class="(?:odd|even)"[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null && results.length < limit * 2) {
      const rowHtml = rowMatch[1]!;

      // Extract title from the torrent link
      const titleMatch = rowHtml.match(
        /<a\s+href="[^"]*"[^>]*class="[^"]*cellMainLink[^"]*"[^>]*>([^<]+)<\/a>/i,
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
      // Extract info hash from magnet or data attribute
      const hashMatch = rowHtml.match(/(?:xt=urn:btih:|data-hash=")([a-fA-F0-9]{40})/i);
      if (!magnetMatch && !hashMatch) continue;

      const magnetUri = magnetMatch
        ? magnetMatch[1]!.replace(/&amp;/g, "&")
        : hashMatch
          ? buildMagnet(hashMatch[1]!, title)
          : undefined;
      if (!magnetUri) continue;

      // Extract seeders and leechers from td elements
      const seedMatch = rowHtml.match(/<td[^>]*>\s*(\d[\d,]*)\s*<\/td>\s*<td[^>]*>\s*(\d[\d,]*)\s*<\/td>/i);
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
