import type { SearchRequest, SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { parseSize } from "../utils/size.js";
import { decodeEntities, detectLanguageFromTitle } from "../utils/text.js";
import { TORRENTGALAXY_DOMAINS as DOMAINS } from "./mirrors.js";
import { createResult, raceMirrors } from "./source-utils.js";

/**
 * TorrentGalaxy adapter — single-step listing + detail-page magnets.
 *
 * TorrentGalaxy has changed shape multiple times (torrentgalaxy.to era →
 * the current /get-posts/ + /post-detail/ era). Both layouts are parsed:
 * whichever a mirror actually serves wins, and rows without an inline
 * magnet (current era) are completed via their post-detail page.
 */

interface TgxRow {
  title: string;
  detailPath: string;
  seeders: number;
  leechers: number;
  sizeBytes?: number | undefined;
  magnetUri?: string | undefined;
  ageText?: string | undefined;
  trusted: boolean;
}

/** Approximate an ISO timestamp from a relative age like "3 days". */
export function approxIsoFromAge(text: string): string | undefined {
  const match = text.match(/(\d+)\s*(min|hour|day|week|month|year)s?\b/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const ms =
    unit.startsWith("min")
      ? 60_000
      : unit.startsWith("hour")
        ? 3_600_000
        : unit.startsWith("day")
          ? 86_400_000
          : unit.startsWith("week")
            ? 7 * 86_400_000
            : unit.startsWith("month")
              ? 30 * 86_400_000
              : 365 * 86_400_000;
  return new Date(Date.now() - amount * ms).toISOString();
}

const ROW_SPLIT = /<div\s+class="tgxtablerow[^"]*"[^>]*>([\s\S]*?)(?=<div\s+class="tgxtablerow|$)/gi;

/**
 * Parse the current (/get-posts/) TorrentGalaxy listing layout.
 * Exported for fixture tests.
 */
export function parseTgxListing(html: string): TgxRow[] {
  const rows: TgxRow[] = [];
  let rowMatch: RegExpExecArray | null;
  ROW_SPLIT.lastIndex = 0;

  while ((rowMatch = ROW_SPLIT.exec(html)) !== null) {
    const row = rowMatch[1]!;

    // Title and details URL: <a class="txlight" title="TITLE" href="/post-detail/ID/SLUG/">
    const primary = row.match(
      /<a[^>]*\btitle="([^"]+)"[^>]*\bhref="(\/post-detail\/[^"]+)"/i,
    );
    const secondary = row.match(
      /<a[^>]*\bhref="(\/post-detail\/[^"]+)"[^>]*\btitle="([^"]+)"/i,
    );
    let title: string;
    let detailPath: string;
    if (primary) {
      title = decodeEntities((primary[1] ?? "").trim());
      detailPath = primary[2]!;
    } else if (secondary) {
      detailPath = secondary[1]!;
      title = decodeEntities((secondary[2] ?? "").trim());
    } else {
      continue;
    }
    if (!title || title.length < 3) continue;

    // Seeders/Leechers: [<font color="green"><b>149</b></font>/<font color="#ff0000"><b>3</b></font> ]
    const peers = row.match(
      /\[\s*(?:<[^>]+>\s*)*<b>\s*(\d[\d,]*)\s*<\/b>\s*(?:<\/[^>]+>\s*)*\/\s*(?:<[^>]+>\s*)*<b>\s*(\d[\d,]*)\s*<\/b>/i,
    );

    const sizeMatch = row.match(/([\d.]+)\s*([KMGT]B)\b/i);
    const ageMatch = row.match(/(\d+\s*(?:min|hour|day|week|month|year)s?)\s*<div/i);

    rows.push({
      title,
      detailPath,
      seeders: Number((peers?.[1] ?? "0").replace(/,/g, "")) || 0,
      leechers: Number((peers?.[2] ?? "0").replace(/,/g, "")) || 0,
      sizeBytes: sizeMatch ? parseSize(`${sizeMatch[1]} ${sizeMatch[2]}`) : undefined,
      ageText: ageMatch?.[1],
      trusted: row.includes("trusted-uploader"),
    });
  }

  return rows;
}

/**
 * Parse the legacy (torrentgalaxy.to era) listing layout, where magnets
 * appear inline on the results page. Exported for fixture tests.
 */
export function parseTgxLegacyListing(html: string): TgxRow[] {
  const rows: TgxRow[] = [];
  let rowMatch: RegExpExecArray | null;
  ROW_SPLIT.lastIndex = 0;

  while ((rowMatch = ROW_SPLIT.exec(html)) !== null) {
    const row = rowMatch[1]!;

    const titleMatch = row.match(
      /<a\s+href="(\/torrent\/[^"]+)"[^>]*(?:title="([^"]*)"[^>]*)?>([^<]*)<\/a>/i,
    );
    if (!titleMatch) continue;
    const title = decodeEntities((titleMatch[2] || titleMatch[3] || "").trim());
    if (!title || title.length < 3) continue;

    const magnetMatch = row.match(/href="(magnet:\?[^"]+)"/i);
    if (!magnetMatch) continue;

    const allNums: number[] = [];
    const numRegex = /<(?:span|font|b)[^>]*>\s*(\d[\d,]*)\s*<\/(?:span|font|b)>/gi;
    let numMatch;
    while ((numMatch = numRegex.exec(row)) !== null) {
      const n = Number(numMatch[1]!.replace(/,/g, ""));
      if (!isNaN(n)) allNums.push(n);
    }

    const sizeMatch = row.match(/([\d.]+)\s*(GB|MB|KB|TB)\b/i);

    rows.push({
      title,
      detailPath: titleMatch[1]!,
      seeders: allNums.length >= 2 ? allNums[allNums.length - 2]! : 0,
      leechers: allNums.length >= 1 ? allNums[allNums.length - 1]! : 0,
      sizeBytes: sizeMatch ? parseSize(`${sizeMatch[1]} ${sizeMatch[2]}`) : undefined,
      magnetUri: decodeEntities(magnetMatch[1]!),
      trusted: row.includes("trusted-uploader"),
    });
  }

  return rows;
}

/** TGX browse categories per media type, for category-scoped top listings. */
const TGX_CATEGORIES: Partial<Record<string, string>> = {
  movie: "Movies",
  tv: "TV",
  anime: "Anime",
  game: "Games",
  software: "Software",
};

export class TorrentGalaxyAdapter implements SourceAdapter {
  readonly id = "torrentgalaxy";
  readonly name = "TorrentGalaxy";
  readonly reliability = 0.78;
  readonly mediaTypes = ["movie", "tv", "anime", "game", "software", "documentary", "other"] as const;
  readonly regions = ["global", "usa", "india", "japan", "korea", "europe"] as const;
  readonly supportsTop = true;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest) {
    return raceMirrors(
      DOMAINS,
      async (domain, signal) => {
        const query = encodeURIComponent(request.intent.query);

        let rows: TgxRow[] = [];
        if (request.top) {
          // Top listing: the period's posts ranked by seeders, scoped to the
          // category when the search asks for one.
          const period = request.top === "today" ? "1D" : "7D";
          const category = request.intent.mediaType
            ? TGX_CATEGORIES[request.intent.mediaType]
            : undefined;
          const route = category
            ? `category:${category}:time:${period}`
            : `time:${period}`;
          const listingHtml = await this.http.text(
            `https://${domain}/get-posts/${route}`,
            signal,
          );
          rows = parseTgxListing(listingHtml).sort((a, b) => b.seeders - a.seeders);
        } else {
          // Current era: /get-posts/keywords:<query>
          const listingHtml = await this.http.text(
            `https://${domain}/get-posts/keywords:${query}`,
            signal,
          );
          rows = parseTgxListing(listingHtml);

          // Legacy era: /torrents.php?search=<query>
          if (rows.length === 0) {
            const legacyHtml = await this.http
              .text(`https://${domain}/torrents.php?search=${query}`, signal)
              .catch(() => "");
            rows = parseTgxLegacyListing(legacyHtml);
          }
        }
        if (rows.length === 0) return [];

        const top = rows.slice(0, Math.min(request.limit, 15));
        await this.fillMagnets(domain, top, signal);

        return top
          .filter((row) => row.magnetUri)
          .map((row) =>
            createResult({
              title: row.title,
              source: this.id,
              sourceReliability: this.reliability,
              detailsUrl: `https://${domain}${row.detailPath}`,
              magnetUri: row.magnetUri,
              sizeBytes: row.sizeBytes,
              seeders: row.seeders,
              leechers: row.leechers,
              uploadedAt: row.ageText ? approxIsoFromAge(row.ageText) : undefined,
              language: detectLanguageFromTitle(row.title),
              trusted: row.trusted,
            }),
          );
      },
      request.signal,
      { isEmpty: (results) => results.length === 0 },
    );
  }

  /** Current-era rows link to a post-detail page instead of a magnet. */
  private async fillMagnets(
    domain: string,
    rows: TgxRow[],
    signal?: AbortSignal,
  ): Promise<void> {
    const pending = rows.filter((row) => !row.magnetUri && row.detailPath.startsWith("/post-detail/"));
    const CONCURRENCY = 6;

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (row) => {
          try {
            const html = await this.http.text(`https://${domain}${row.detailPath}`, signal);
            const magnetMatch = html.match(/href="(magnet:\?[^"]+)"/i);
            if (magnetMatch) row.magnetUri = decodeEntities(magnetMatch[1]!);
          } catch {
            // Leave the row magnet-less; it is filtered out of results.
          }
        }),
      );
    }
  }
}
