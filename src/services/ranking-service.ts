import type { SearchIntent, SearchResult } from "../types/search.js";

const QUALITY_SCORE: Record<string, number> = {
  "2160p": 9,
  "1080p": 7,
  "1080i": 5,
  "720p": 4,
  "480p": 1,
};

/**
 * Indian language keywords used for language-aware ranking.
 * When the user searches for "hindi", results with "Tamil" or "Telugu"
 * in the title are deprioritized.
 */
const INDIAN_LANGUAGES = ["hindi", "tamil", "telugu", "malayalam", "kannada", "bengali", "punjabi"];

export function scoreResult(result: SearchResult, intent: SearchIntent): number {
  const seedScore = Math.log10(Math.max(0, result.seeders) + 1) * 18;
  const peerHealth =
    result.seeders + result.leechers > 0
      ? (result.seeders / (result.seeders + result.leechers)) * 8
      : 0;
  const reliabilityScore = result.sourceReliability * 20;
  const qualityScore = result.quality ? (QUALITY_SCORE[result.quality] ?? 2) : 0;
  const preferredSource = intent.preferredSources.includes(result.source) ? 10 : 0;
  const mediaMatch = intent.mediaType && result.mediaType === intent.mediaType ? 7 : 0;
  const regionMatch = intent.region && result.region === intent.region ? 5 : 0;
  const trusted = result.trusted ? 5 : -8;
  const deadPenalty = result.seeders === 0 ? -25 : 0;
  const suspiciousPenalty = isSuspicious(result.title) ? -20 : 0;
  const freshness = freshnessScore(result.uploadedAt);
  const langScore = languageScore(result, intent);

  return Number(
    (
      seedScore +
      peerHealth +
      reliabilityScore +
      qualityScore +
      preferredSource +
      mediaMatch +
      regionMatch +
      trusted +
      freshness +
      deadPenalty +
      suspiciousPenalty +
      langScore
    ).toFixed(2),
  );
}

export function rankResults(results: SearchResult[], intent: SearchIntent): SearchResult[] {
  return results
    .map((result) => ({ ...result, score: scoreResult(result, intent) }))
    .sort((a, b) => b.score - a.score || b.seeders - a.seeders);
}

function freshnessScore(uploadedAt?: string): number {
  if (!uploadedAt) return 0;
  const age = Date.now() - new Date(uploadedAt).getTime();
  if (!Number.isFinite(age) || age < 0) return 0;
  const days = age / 86_400_000;
  if (days < 7) return 6;
  if (days < 30) return 4;
  if (days < 365) return 2;
  return 0;
}

function isSuspicious(title: string): boolean {
  return /\.(exe|scr|bat)\b/i.test(title) || /\b(password|crack only|keygen only)\b/i.test(title);
}

/**
 * Score a result based on language match with the user's search intent.
 *
 * When the user searches for "hindi" content:
 *   +12 if the result title or language contains "Hindi"
 *   -10 if the result title contains another Indian language (Tamil/Telugu etc.)
 *        but NOT the requested language
 *
 * This directly solves the problem of Tamil/Telugu results appearing above
 * Hindi results when the user specifically wants Hindi.
 */
function languageScore(result: SearchResult, intent: SearchIntent): number {
  const wantedLang = intent.language?.toLowerCase();
  if (!wantedLang) return 0;

  const titleLower = result.title.toLowerCase();
  const resultLang = result.language?.toLowerCase();

  // Check if the result matches the wanted language
  const matchesWanted =
    resultLang === wantedLang ||
    titleLower.includes(wantedLang);

  if (matchesWanted) return 12;

  // Check if the result is in a DIFFERENT Indian language than the one wanted
  if (INDIAN_LANGUAGES.includes(wantedLang)) {
    const hasOtherIndianLang = INDIAN_LANGUAGES.some(
      (lang) => lang !== wantedLang && (resultLang === lang || titleLower.includes(lang)),
    );
    if (hasOtherIndianLang) return -10;
  }

  return 0;
}
