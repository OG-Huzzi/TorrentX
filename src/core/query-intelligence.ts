import type { MediaType, Region, SearchIntent } from "../types/search.js";

const MEDIA_ALIASES: Record<string, MediaType> = {
  movie: "movie",
  film: "movie",
  tv: "tv",
  show: "tv",
  series: "tv",
  anime: "anime",
  kdrama: "tv",
  bollywood: "movie",
  game: "game",
  games: "game",
  software: "software",
  documentary: "documentary",
};

const REGION_ALIASES: Record<string, Region> = {
  bollywood: "india",
  indian: "india",
  hindi: "india",
  tamil: "india",
  telugu: "india",
  malayalam: "india",
  kannada: "india",
  bengali: "india",
  punjabi: "india",
  kdrama: "korea",
  korean: "korea",
  jdrama: "japan",
  japanese: "japan",
  cdrama: "china",
  chinese: "china",
  hollywood: "usa",
};

const LANGUAGE_ALIASES = new Set([
  "english",
  "hindi",
  "tamil",
  "telugu",
  "malayalam",
  "kannada",
  "bengali",
  "punjabi",
  "japanese",
  "korean",
  "chinese",
]);

export function inferSearchIntent(
  rawQuery: string,
  hints: { mediaType?: MediaType; region?: Region; language?: string } = {},
): SearchIntent {
  const terms = rawQuery.trim().split(/\s+/).filter(Boolean);
  let mediaType = hints.mediaType;
  let region = hints.region;
  let language = hints.language;
  if (!region && language) {
    region = languageRegion(language);
  }
  const queryTerms: string[] = [];

  for (const term of terms) {
    const normalized = term.toLowerCase();
    const mediaAlias = MEDIA_ALIASES[normalized];
    const regionAlias = REGION_ALIASES[normalized];
    const consumesMediaHint = Boolean(mediaAlias && !mediaType);
    const consumesRegionHint = Boolean(regionAlias && !region);
    if (consumesMediaHint) mediaType = mediaAlias;
    if (consumesRegionHint) region = regionAlias;
    const consumesLanguageHint = Boolean(!language && LANGUAGE_ALIASES.has(normalized));
    if (consumesLanguageHint) language = normalized;

    if (!consumesMediaHint && !consumesRegionHint && !consumesLanguageHint) {
      queryTerms.push(term);
    }
  }

  if (mediaType === "anime") region ??= "japan";
  if (rawQuery.toLowerCase().includes("kdrama")) mediaType ??= "tv";
  if (rawQuery.toLowerCase().includes("bollywood")) mediaType ??= "movie";

  const preferredSources: string[] = [];
  if (mediaType === "anime" || region === "japan" || region === "korea") preferredSources.push("nyaa");
  if (mediaType === "movie") preferredSources.push("yts");
  if (mediaType === "tv") preferredSources.push("eztv");
  if (mediaType === "game") preferredSources.push("fitgirl");
  if (region === "india") preferredSources.push("piratebay");

  return {
    query: queryTerms.join(" ").trim() || rawQuery.trim(),
    preferredSources,
    terms,
    ...(mediaType ? { mediaType } : {}),
    ...(region ? { region } : {}),
    ...(language ? { language } : {}),
  };
}

function languageRegion(language: string): Region | undefined {
  const normalized = language.toLowerCase();
  if (["hindi", "tamil", "telugu", "malayalam", "kannada", "bengali", "punjabi"].includes(normalized)) {
    return "india";
  }
  if (normalized === "japanese") return "japan";
  if (normalized === "korean") return "korea";
  if (normalized === "chinese") return "china";
  if (normalized === "english") return "global";
  return undefined;
}
