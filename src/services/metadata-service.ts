import type { TorrentXConfig } from "../types/config.js";
import type { MediaMetadata, SearchIntent, SearchResult } from "../types/search.js";
import { normalizeTitle, stripControlChars } from "../utils/text.js";
import { HttpClient } from "./http-client.js";

interface TmdbSearchResponse {
  results?: Array<{
    title?: string;
    name?: string;
    release_date?: string;
    first_air_date?: string;
    vote_average?: number;
    poster_path?: string;
    original_language?: string;
    overview?: string;
    genre_ids?: number[];
  }>;
}

interface OmdbResponse {
  Response: "True" | "False";
  Title?: string;
  Year?: string;
  imdbRating?: string;
  Poster?: string;
  Language?: string;
  Country?: string;
  Genre?: string;
  Runtime?: string;
  Plot?: string;
}

const TMDB_GENRES: Record<number, string> = {
  12: "Adventure",
  14: "Fantasy",
  16: "Animation",
  18: "Drama",
  27: "Horror",
  28: "Action",
  35: "Comedy",
  36: "History",
  53: "Thriller",
  80: "Crime",
  99: "Documentary",
  878: "Science Fiction",
  9648: "Mystery",
  10749: "Romance",
  10751: "Family",
  10752: "War",
  10759: "Action & Adventure",
  10765: "Sci-Fi & Fantasy",
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 5;
/** Minimum token overlap (0..1) before a TMDB/OMDB hit is trusted. */
const SIMILARITY_THRESHOLD = 0.5;

/**
 * Compare two titles by normalized token overlap. Torrent titles are noisy
 * ("Movie.Name.2024.1080p.WEB-DL.x264-GROUP"), so the metadata API hit must
 * share at least half its tokens with the search title before we trust it —
 * previously we blindly took results[0], which often attached the wrong movie.
 */
export function titlesMatch(a: string, b: string): boolean {
  const tokens = (value: string) =>
    new Set(
      normalizeTitle(value)
        .split(/\s+/)
        .filter((token) => token.length > 1),
    );
  const setA = tokens(a);
  const setB = tokens(b);
  if (setA.size === 0 || setB.size === 0) return false;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  return shared / Math.min(setA.size, setB.size) >= SIMILARITY_THRESHOLD;
}

interface CacheEntry {
  metadata: MediaMetadata | undefined;
  expiresAt: number;
}

export class MetadataService {
  private readonly http: HttpClient;
  private readonly cache = new Map<string, CacheEntry>();
  /** Count of failed lookups during the most recent enrich() call. */
  enrichmentFailures = 0;

  constructor(private readonly config: TorrentXConfig) {
    this.http = new HttpClient(config);
  }

  get enabled(): boolean {
    return Boolean(this.config.tmdbApiKey || this.config.omdbApiKey);
  }

  async enrich(results: SearchResult[], intent: SearchIntent): Promise<SearchResult[]> {
    if (!this.enabled || !["movie", "tv", "anime", "documentary", undefined].includes(intent.mediaType)) {
      return results;
    }

    this.enrichmentFailures = 0;
    const enriched = await Promise.all(
      results.slice(0, this.config.metadataLimit).map(async (result): Promise<SearchResult> => {
        try {
          const metadata = await this.lookup(result, intent);
          return metadata ? { ...result, metadata } : result;
        } catch {
          this.enrichmentFailures += 1;
          return result;
        }
      }),
    );

    return [...enriched, ...results.slice(this.config.metadataLimit)];
  }

  private async lookup(
    result: SearchResult,
    intent: SearchIntent,
  ): Promise<MediaMetadata | undefined> {
    const title = normalizeTitle(result.title).replace(/\b(19|20)\d{2}\b.*$/, "").trim();
    const year = result.title.match(/\b((?:19|20)\d{2})\b/)?.[1];
    if (!title) return undefined;

    const cacheKey = `${title}:${year ?? ""}:${intent.mediaType ?? ""}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.metadata;
    }

    let metadata: MediaMetadata | undefined;
    let providerError: unknown;
    if (this.config.tmdbApiKey) {
      try {
        metadata = await this.lookupTmdb(title, intent, year);
      } catch (error) {
        providerError = error;
      }
    }
    // Fall back to OMDB when TMDB is unset, returned nothing, or failed —
    // previously OMDB was unreachable whenever a TMDB key was configured.
    if (!metadata && this.config.omdbApiKey) {
      try {
        metadata = await this.lookupOmdb(title, year);
      } catch (error) {
        providerError = error;
      }
    }
    // Surface a hard failure only when every configured provider errored.
    if (!metadata && providerError) throw providerError;

    this.cache.set(cacheKey, { metadata, expiresAt: Date.now() + CACHE_TTL_MS });
    return metadata;
  }

  private async lookupTmdb(
    title: string,
    intent: SearchIntent,
    year?: string,
  ): Promise<MediaMetadata | undefined> {
    const type = intent.mediaType === "tv" || intent.mediaType === "anime" ? "tv" : "movie";
    const url = new URL(`https://api.themoviedb.org/3/search/${type}`);
    url.searchParams.set("api_key", this.config.tmdbApiKey!);
    url.searchParams.set("query", title);
    if (year) url.searchParams.set(type === "movie" ? "year" : "first_air_date_year", year);
    const payload = await this.http.json<TmdbSearchResponse>(url.toString());

    // Pick the first plausible match instead of blindly taking results[0].
    const candidates = (payload.results ?? []).slice(0, MAX_CANDIDATES);
    const item = candidates.find((candidate) =>
      titlesMatch(title, candidate.title ?? candidate.name ?? ""),
    );
    if (!item) return undefined;

    const date = item.release_date ?? item.first_air_date;
    return compactMetadata({
      title: item.title ?? item.name ?? title,
      year: date ? Number(date.slice(0, 4)) : undefined,
      rating: item.vote_average,
      posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
      language: item.original_language,
      genres: item.genre_ids
        ?.map((id) => TMDB_GENRES[id])
        .filter((genre): genre is string => Boolean(genre)),
      overview: item.overview,
    });
  }

  private async lookupOmdb(title: string, year?: string): Promise<MediaMetadata | undefined> {
    const url = new URL("https://www.omdbapi.com/");
    url.searchParams.set("apikey", this.config.omdbApiKey!);
    url.searchParams.set("t", title);
    if (year) url.searchParams.set("y", year);
    const item = await this.http.json<OmdbResponse>(url.toString());
    if (item.Response !== "True" || !item.Title) return undefined;
    if (!titlesMatch(title, item.Title)) return undefined;

    return compactMetadata({
      title: item.Title,
      year: item.Year ? Number(item.Year.slice(0, 4)) : undefined,
      rating: item.imdbRating && item.imdbRating !== "N/A" ? Number(item.imdbRating) : undefined,
      posterUrl: item.Poster && item.Poster !== "N/A" ? item.Poster : undefined,
      language: item.Language,
      country: item.Country,
      genres: item.Genre?.split(",").map((genre) => genre.trim()),
      runtimeMinutes: item.Runtime ? Number(item.Runtime.match(/\d+/)?.[0]) : undefined,
      overview: item.Plot,
    });
  }
}

function compactMetadata(input: {
  title: string;
  year?: number | undefined;
  rating?: number | undefined;
  posterUrl?: string | undefined;
  language?: string | undefined;
  country?: string | undefined;
  genres?: string[] | undefined;
  runtimeMinutes?: number | undefined;
  overview?: string | undefined;
}): MediaMetadata {
  // Provider text is printed to the terminal: drop control characters.
  const clean = (value: string | undefined) => (value ? stripControlChars(value).trim() : undefined);
  const language = clean(input.language);
  const country = clean(input.country);
  const overview = clean(input.overview);
  return {
    title: clean(input.title) ?? "",
    ...(input.year ? { year: input.year } : {}),
    ...(input.rating !== undefined ? { rating: input.rating } : {}),
    ...(input.posterUrl ? { posterUrl: input.posterUrl } : {}),
    ...(language ? { language } : {}),
    ...(country ? { country } : {}),
    ...(input.genres?.length ? { genres: input.genres.map((genre) => stripControlChars(genre)) } : {}),
    ...(input.runtimeMinutes ? { runtimeMinutes: input.runtimeMinutes } : {}),
    ...(overview ? { overview } : {}),
  };
}
