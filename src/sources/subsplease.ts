import type { HttpClient } from "../services/http-client.js";
import type { SearchRequest, SourceAdapter, SearchResult } from "../types/search.js";
import { SUBSPLEASE_HOST } from "./mirrors.js";
import { infoHashFromMagnet } from "../utils/magnet.js";
import { createResult } from "./source-utils.js";

const API = `https://${SUBSPLEASE_HOST}/api/`;
const RESOLUTION_PREFERENCE = ["1080", "720", "480"];

interface SubsPleaseDownload {
  res?: string;
  magnet?: string;
}

interface SubsPleaseEntry {
  show?: string;
  episode?: string;
  release_date?: string;
  downloads?: SubsPleaseDownload[];
}

export class SubsPleaseAdapter implements SourceAdapter {
  readonly id = "subsplease";
  readonly name = "SubsPlease";
  readonly reliability = 0.92;
  readonly mediaTypes = ["anime"] as const;
  readonly regions = ["global", "japan"] as const;
  readonly supportsTop = true;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest): Promise<SearchResult[]> {
    if (request.intent.mediaType && request.intent.mediaType !== "anime") return [];

    const url = new URL(API);
    url.searchParams.set("tz", "UTC");
    if (request.top) {
      // Top listing: the latest releases of the period (today's / this week's
      // anime), which is exactly what this feed is built for.
      url.searchParams.set("f", "latest");
      url.searchParams.set("h", request.top === "today" ? "24" : "168");
    } else {
      url.searchParams.set("f", "search");
      url.searchParams.set("s", request.intent.query);
    }

    const payload = await this.http.json<Record<string, SubsPleaseEntry> | unknown[]>(
      url.toString(),
      request.signal,
    );
    if (Array.isArray(payload)) return [];
    return mapSubsPleaseResults(payload, request.limit, this);
  }
}

export function mapSubsPleaseResults(
  entries: Record<string, SubsPleaseEntry>,
  limit: number,
  source: Pick<SourceAdapter, "id" | "reliability"> = {
    id: "subsplease",
    reliability: 0.92,
  },
): SearchResult[] {
  return Object.values(entries)
    .flatMap((entry) => {
      const download = preferredDownload(entry.downloads ?? []);
      if (!download?.magnet) return [];

      const title = [entry.show, entry.episode ? `- ${entry.episode}` : undefined]
        .filter(Boolean)
        .join(" ") || "Unknown episode";
      return [
        createResult({
          title,
          source: source.id,
          sourceReliability: source.reliability,
          sourceId: infoHashFromMagnet(download.magnet),
          magnetUri: download.magnet,
          sizeBytes: magnetSize(download.magnet),
          uploadedAt: toIsoDate(entry.release_date),
          quality: download.res ? `${download.res}p` : undefined,
          mediaType: "anime",
          region: "japan",
          language: "japanese",
          trusted: true,
        }),
      ];
    })
    .slice(0, limit);
}

function preferredDownload(downloads: readonly SubsPleaseDownload[]): SubsPleaseDownload | undefined {
  for (const resolution of RESOLUTION_PREFERENCE) {
    const match = downloads.find(
      (download) => download.res === resolution && download.magnet,
    );
    if (match) return match;
  }
  return downloads.find((download) => download.magnet);
}

function magnetSize(magnet: string): number | undefined {
  const value = magnet.match(/[?&]xl=(\d+)/i)?.[1];
  const parsed = value ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function toIsoDate(value?: string): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
