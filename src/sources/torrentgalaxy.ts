import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { createResult } from "./source-utils.js";

/**
 * TorrentGalaxy adapter — single-step HTML scraping.
 *
 * Unlike 1337x, TorrentGalaxy includes magnet links directly on the search
 * results page, making it faster to scrape. Excellent source for
 * Indian/Bollywood content with a large, active community.
 */

const DOMAINS = ["torrentgalaxy.to", "torrentgalaxy.mx"];

export class TorrentGalaxyAdapter implements SourceAdapter {
  readonly id = "torrentgalaxy";
  readonly name = "TorrentGalaxy";
  readonly reliability = 0.78;
  readonly mediaTypes = ["movie", "tv", "anime", "game", "software", "documentary", "other"] as const;
  readonly regions = ["global", "usa", "india", "japan", "korea", "europe"] as const;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    let lastError: Error | undefined;

    for (const domain of DOMAINS) {
      try {
        const url = `https://${domain}/torrents.php?search=${encodeURIComponent(request.intent.query)}&sort=seeders&order=desc`;
        const html = await this.http.text(url, request.signal);
        return this.parseResults(html, domain, request.limit);
      } catch (err) {
        lastError = err as Error;
      }
    }

    throw lastError || new Error("All TorrentGalaxy mirrors offline");
  }

  private parseResults(html: string, domain: string, limit: number) {
    const results = [];

    // TorrentGalaxy result rows are in <div class="tgxtablerow">...</div> blocks
    const rowRegex = /<div\s+class="tgxtablerow[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div\s+class="tgxtablerow|$)/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null && results.length < limit * 2) {
      const rowHtml = rowMatch[1]!;

      // Extract title and details URL
      const titleMatch = rowHtml.match(
        /<a\s+href="(\/torrent\/[^"]+)"[^>]*(?:title="([^"]*)"[^>]*)?>([^<]*)<\/a>/i,
      );
      if (!titleMatch) continue;

      const detailPath = titleMatch[1]!;
      const title = (titleMatch[2] || titleMatch[3] || "")
        .trim()
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
      if (!title || title.length < 3) continue;

      // Extract magnet link (directly available on search page!)
      const magnetMatch = rowHtml.match(/href="(magnet:\?[^"]+)"/i);
      if (!magnetMatch) continue;
      const magnetUri = magnetMatch[1]!.replace(/&amp;/g, "&");

      // Extract seeders and leechers
      // TorrentGalaxy uses spans with color/font styling for seed/leech counts
      const seedMatch = rowHtml.match(
        /color[^>]*>\s*(\d[\d,]*)\s*<.*?Seeders/i,
      ) || rowHtml.match(/<span\s+style="color:\s*#[0-9a-f]*"[^>]*>\s*<b>\s*(\d[\d,]*)/i) ||
        rowHtml.match(/<font\s+color="[^"]*">\s*(\d[\d,]*)\s*<\/font>/i);

      // Try alternate patterns for seeders/leechers from <span> or data attributes
      const allNums: number[] = [];
      const numRegex = /<(?:span|font|b)[^>]*>\s*(\d[\d,]*)\s*<\/(?:span|font|b)>/gi;
      let numMatch;
      while ((numMatch = numRegex.exec(rowHtml)) !== null) {
        const n = Number(numMatch[1]!.replace(/,/g, ""));
        if (!isNaN(n)) allNums.push(n);
      }

      // The last two numbers in the row are typically seeders and leechers
      const seeders = seedMatch ? Number(seedMatch[1]!.replace(/,/g, "")) : (allNums.length >= 2 ? allNums[allNums.length - 2]! : 0);
      const leechers = allNums.length >= 1 ? allNums[allNums.length - 1]! : 0;

      // Extract size
      const sizeMatch = rowHtml.match(/([\d.]+)\s*(GB|MB|KB|TB)/i);
      let sizeBytes: number | undefined;
      if (sizeMatch) {
        const value = parseFloat(sizeMatch[1]!);
        const unit = sizeMatch[2]!.toUpperCase();
        const multipliers: Record<string, number> = {
          KB: 1024,
          MB: 1024 * 1024,
          GB: 1024 * 1024 * 1024,
          TB: 1024 * 1024 * 1024 * 1024,
        };
        sizeBytes = Math.round(value * (multipliers[unit] ?? 1));
      }

      // Detect language from title
      const language = detectLanguage(title);

      results.push(
        createResult({
          title,
          source: this.id,
          sourceReliability: this.reliability,
          detailsUrl: `https://${domain}${detailPath}`,
          magnetUri,
          sizeBytes,
          seeders,
          leechers,
          language,
          trusted: false,
        }),
      );
    }

    return results;
  }
}

function detectLanguage(title: string): string | undefined {
  const lower = title.toLowerCase();
  if (/\bhindi\b/.test(lower)) return "hindi";
  if (/\btamil\b/.test(lower)) return "tamil";
  if (/\btelugu\b/.test(lower)) return "telugu";
  if (/\bmalayalam\b/.test(lower)) return "malayalam";
  if (/\bkannada\b/.test(lower)) return "kannada";
  if (/\bbengali\b/.test(lower)) return "bengali";
  if (/\bpunjabi\b/.test(lower)) return "punjabi";
  if (/\benglish\b/.test(lower) || /\beng\b/.test(lower)) return "english";
  return undefined;
}
