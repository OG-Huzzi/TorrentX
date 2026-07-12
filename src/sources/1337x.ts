import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { createResult } from "./source-utils.js";

/**
 * 1337x adapter — HTML scraping based.
 *
 * 1337x has no JSON API. The search flow is two-step:
 *   1. Fetch the search results page → extract title, seeders, leechers, size,
 *      and the relative URL of each detail page.
 *   2. Fetch each detail page in parallel → extract the magnet link.
 *
 * This is more expensive but 1337x is the best public tracker for
 * Hindi/Bollywood content with dedicated Indian uploaders.
 */

const DOMAINS = ["1337x.to", "1337x.st", "1337x.gd", "1337x.is"];

interface ParsedRow {
  title: string;
  detailPath: string;
  seeders: number;
  leechers: number;
  sizeStr: string;
  uploadedAt: string;
}

export class Leet1337xAdapter implements SourceAdapter {
  readonly id = "1337x";
  readonly name = "1337x";
  readonly reliability = 0.80;
  readonly mediaTypes = ["movie", "tv", "anime", "game", "software", "documentary", "other"] as const;
  readonly regions = ["global", "usa", "india", "japan", "korea", "europe"] as const;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    let lastError: Error | undefined;

    for (const domain of DOMAINS) {
      try {
        const url = `https://${domain}/search/${encodeURIComponent(request.intent.query)}/1/`;
        const html = await this.http.text(url, request.signal);
        const rows = this.parseSearchPage(html);
        if (rows.length === 0) return [];

        // Fetch detail pages in parallel to extract magnet links (limit concurrency).
        const top = rows.slice(0, Math.min(request.limit, 15));
        const results = await this.fetchMagnets(domain, top, request.signal);
        return results;
      } catch (err) {
        lastError = err as Error;
      }
    }

    throw lastError || new Error("All 1337x mirrors offline");
  }

  /**
   * Parse the search results table from 1337x HTML.
   * Each result row is a <tr> inside <tbody> of the results table.
   */
  private parseSearchPage(html: string): ParsedRow[] {
    const rows: ParsedRow[] = [];

    // Match rows inside <tbody>...</tbody>
    const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
    if (!tbodyMatch) return rows;

    const tbody = tbodyMatch[1]!;
    const rowRegex = /<tr>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(tbody)) !== null) {
      const rowHtml = rowMatch[1]!;

      // Extract title and detail path from the second <a> inside coll-1 (first is category icon)
      const titleMatch = rowHtml.match(
        /<td\s+class="coll-1[^"]*"[^>]*>[\s\S]*?<a\s+href="(\/torrent\/[^"]+)"[^>]*>([^<]+)<\/a>/i,
      );
      if (!titleMatch) continue;

      const detailPath = titleMatch[1]!;
      const title = titleMatch[2]!
        .trim()
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
      if (!title || title.length < 3) continue;

      // Extract seeders (coll-2) and leechers (coll-3)
      const seedMatch = rowHtml.match(/<td\s+class="coll-2[^"]*"[^>]*>([^<]+)<\/td>/i);
      const leechMatch = rowHtml.match(/<td\s+class="coll-3[^"]*"[^>]*>([^<]+)<\/td>/i);
      const seeders = Number(seedMatch?.[1]?.replace(/,/g, "")) || 0;
      const leechers = Number(leechMatch?.[1]?.replace(/,/g, "")) || 0;

      // Extract size from coll-4 (contains text like "1.4 GB")
      const sizeMatch = rowHtml.match(/<td\s+class="coll-4[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
      const sizeStr = sizeMatch?.[1]?.replace(/<[^>]*>/g, "").trim() ?? "";

      // Extract upload date from coll-date
      const dateMatch = rowHtml.match(/<td\s+class="coll-date[^"]*"[^>]*>([^<]+)<\/td>/i);
      const uploadedAt = dateMatch?.[1]?.trim() ?? "";

      rows.push({ title, detailPath, seeders, leechers, sizeStr, uploadedAt });
    }

    return rows;
  }

  /**
   * Fetch detail pages in parallel (up to 6 concurrent) and extract magnet links.
   */
  private async fetchMagnets(
    domain: string,
    rows: ParsedRow[],
    signal?: AbortSignal,
  ) {
    const MAX_CONCURRENT = 6;
    const results: ReturnType<typeof createResult>[] = [];

    // Process in batches of MAX_CONCURRENT
    for (let i = 0; i < rows.length; i += MAX_CONCURRENT) {
      const batch = rows.slice(i, i + MAX_CONCURRENT);
      const settled = await Promise.allSettled(
        batch.map(async (row) => {
          const detailUrl = `https://${domain}${row.detailPath}`;
          const detailHtml = await this.http.text(detailUrl, signal);

          // Extract magnet link
          const magnetMatch = detailHtml.match(/href="(magnet:\?[^"]+)"/i);
          if (!magnetMatch) return null;

          const magnetUri = magnetMatch[1]!
            .replace(/&amp;/g, "&");

          // Detect language from title
          const language = detectLanguageFromTitle(row.title);

          return createResult({
            title: row.title,
            source: this.id,
            sourceReliability: this.reliability,
            detailsUrl: detailUrl,
            magnetUri,
            sizeBytes: parseSizeString(row.sizeStr),
            seeders: row.seeders,
            leechers: row.leechers,
            uploadedAt: parseFuzzyDate(row.uploadedAt),
            language,
            trusted: false,
          });
        }),
      );

      for (const s of settled) {
        if (s.status === "fulfilled" && s.value) {
          results.push(s.value);
        }
      }
    }

    return results;
  }
}

/**
 * Detect Indian languages from torrent title.
 */
function detectLanguageFromTitle(title: string): string | undefined {
  const lower = title.toLowerCase();
  if (/\bhindi\b/.test(lower)) return "hindi";
  if (/\btamil\b/.test(lower)) return "tamil";
  if (/\btelugu\b/.test(lower)) return "telugu";
  if (/\bmalayalam\b/.test(lower)) return "malayalam";
  if (/\bkannada\b/.test(lower)) return "kannada";
  if (/\bbengali\b/.test(lower)) return "bengali";
  if (/\bpunjabi\b/.test(lower)) return "punjabi";
  if (/\benglish\b/.test(lower) || /\beng\b/.test(lower)) return "english";
  if (/\bjapanese\b/.test(lower)) return "japanese";
  if (/\bkorean\b/.test(lower)) return "korean";
  return undefined;
}

/**
 * Parse size strings like "1.4 GB", "850 MB", "4.2 GB" into bytes.
 */
function parseSizeString(str: string): number | undefined {
  const match = str.match(/([\d.]+)\s*(GB|MB|KB|TB)/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]!);
  const unit = match[2]!.toUpperCase();
  const multipliers: Record<string, number> = {
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };
  return Math.round(value * (multipliers[unit] ?? 1));
}

/**
 * Parse fuzzy date strings from 1337x like "Jan. 15th '24" or "2h ago"
 * into ISO strings. Returns undefined for unparseable dates.
 */
function parseFuzzyDate(str: string): string | undefined {
  if (!str) return undefined;

  // Try parsing "Oct. 5th '23" or "Jan. 15 '24" style dates
  const fmtMatch = str.match(
    /(\w+)\.?\s+(\d+)\w*\s+'(\d{2})/,
  );
  if (fmtMatch) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const monthNum = months[fmtMatch[1]!.slice(0, 3).toLowerCase()];
    if (monthNum !== undefined) {
      const year = 2000 + Number(fmtMatch[3]);
      const day = Number(fmtMatch[2]);
      return new Date(year, monthNum, day).toISOString();
    }
  }

  // Try standard date parse as fallback
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString();

  return undefined;
}
