import type { MediaType, Region, SearchResult } from "../types/search.js";
import { stableHash } from "../utils/hash.js";
import { detectCodec, detectMediaType, detectQuality } from "../utils/text.js";

export function createResult(input: {
  title: string;
  source: string;
  sourceReliability: number;
  sourceId?: string | undefined;
  detailsUrl?: string | undefined;
  magnetUri?: string | undefined;
  torrentUrl?: string | undefined;
  sizeBytes?: number | undefined;
  seeders?: number | undefined;
  leechers?: number | undefined;
  uploadedAt?: string | undefined;
  quality?: string | undefined;
  codec?: string | undefined;
  language?: string | undefined;
  mediaType?: MediaType | undefined;
  region?: Region | undefined;
  trusted?: boolean | undefined;
}): SearchResult {
  const identity = input.magnetUri ?? input.torrentUrl ?? input.detailsUrl ?? input.title;
  return {
    id: stableHash(`${input.source}:${identity}`),
    title: input.title.trim(),
    source: input.source,
    sourceReliability: input.sourceReliability,
    seeders: input.seeders ?? 0,
    leechers: input.leechers ?? 0,
    trusted: input.trusted ?? true,
    score: 0,
    ...optional("quality", input.quality ?? detectQuality(input.title)),
    ...optional("codec", input.codec ?? detectCodec(input.title)),
    ...optional("mediaType", input.mediaType ?? detectMediaType(input.title)),
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    ...(input.detailsUrl ? { detailsUrl: input.detailsUrl } : {}),
    ...(input.magnetUri ? { magnetUri: input.magnetUri } : {}),
    ...(input.torrentUrl ? { torrentUrl: input.torrentUrl } : {}),
    ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
    ...(input.uploadedAt ? { uploadedAt: input.uploadedAt } : {}),
    ...(input.language ? { language: input.language } : {}),
    ...(input.region ? { region: input.region } : {}),
  };
}

function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]: V });
}
