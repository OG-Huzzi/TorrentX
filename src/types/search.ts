export type MediaType =
  | "movie"
  | "tv"
  | "anime"
  | "game"
  | "software"
  | "documentary"
  | "other";

export type Region =
  | "global"
  | "usa"
  | "india"
  | "japan"
  | "korea"
  | "china"
  | "europe";

export interface SearchIntent {
  query: string;
  mediaType?: MediaType;
  region?: Region;
  language?: string;
  preferredSources: string[];
  terms: string[];
}

export interface SearchFilters {
  quality?: string;
  source?: string[];
  minSizeBytes?: number;
  maxSizeBytes?: number;
  language?: string;
  minSeeders?: number;
  codec?: string;
  mediaType?: MediaType;
}

export interface SearchRequest {
  query: string;
  intent: SearchIntent;
  filters: SearchFilters;
  limit: number;
  signal?: AbortSignal;
}

export interface MediaMetadata {
  title: string;
  year?: number;
  rating?: number;
  posterUrl?: string;
  language?: string;
  country?: string;
  genres?: string[];
  runtimeMinutes?: number;
  overview?: string;
}

export interface SearchResult {
  id: string;
  title: string;
  source: string;
  sourceId?: string;
  detailsUrl?: string;
  magnetUri?: string;
  torrentUrl?: string;
  sizeBytes?: number;
  seeders: number;
  leechers: number;
  uploadedAt?: string;
  quality?: string;
  codec?: string;
  language?: string;
  mediaType?: MediaType;
  region?: Region;
  trusted: boolean;
  sourceReliability: number;
  score: number;
  metadata?: MediaMetadata;
}

export interface SourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly reliability: number;
  readonly mediaTypes: readonly MediaType[];
  readonly regions: readonly Region[];
  search(request: SearchRequest): Promise<SearchResult[]>;
}

export type SourceFailureKind =
  | "blocked"
  | "cancelled"
  | "invalid_response"
  | "network"
  | "rate_limited"
  | "timeout"
  | "unavailable";

export interface SourceRun {
  source: string;
  durationMs: number;
  resultCount: number;
  cached: boolean;
  error?: string;
  failureKind?: SourceFailureKind;
}

export interface SearchReport {
  query: string;
  intent: SearchIntent;
  results: SearchResult[];
  sources: SourceRun[];
  durationMs: number;
  cached: boolean;
}

export interface SearchProgress extends SearchReport {
  completedSources: number;
  totalSources: number;
}

export type SearchProgressListener = (progress: SearchProgress) => void;

export interface SearchOptions extends SearchFilters {
  limit?: number;
  cache?: boolean;
  enrich?: boolean;
  sourceTimeoutMs?: number;
  signal?: AbortSignal;
}
