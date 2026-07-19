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

/**
 * Known fake/spam patterns that indicate a torrent is likely garbage.
 */
const SPAM_PATTERNS = [
  /\b(password|crack only|keygen only|serial only)\b/i,
  /\.(exe|scr|bat|cmd|vbs|ps1)\b/i,
  /\b(miner|crypto|bitcoin)\s*(miner|farm)/i,
  /\b(free\s*v-?bucks|free\s*robux|hack|cheat\s*engine)/i,
  /\b(survey|gift\s*card|paypal\s*generator)\b/i,
];

/**
 * Known reputable release groups — their torrents are almost always real.
 */
const TRUSTED_GROUPS = [
  "rarbg", "yts", "eztv", "fitgirl", "dodi", "elamigos", "tinyrepacks",
  "subsplease", "erai-raws", "horriblesubs", "judgement", "nyaa",
  "web-dl", "bluray", "remux", "proper", "repack", "internal",
];

export function scoreResult(result: SearchResult, intent: SearchIntent): number {
  // === Core health signals (most important for finding WORKING torrents) ===
  const seedScore = Math.log10(Math.max(0, result.seeders) + 1) * 20;
  const peerHealth =
    result.seeders + result.leechers > 0
      ? (result.seeders / (result.seeders + result.leechers)) * 10
      : 0;

  // Seeder velocity: high seeder count relative to age = very healthy
  const seederVelocity = seederVelocityScore(result);

  // === Source trust ===
  const reliabilityScore = result.sourceReliability * 22;
  const preferredSource = intent.preferredSources.includes(result.source) ? 10 : 0;
  const trusted = result.trusted ? 6 : -6;
  const groupTrust = trustedGroupBonus(result.title);

  // === Content quality ===
  const qualityScore = result.quality ? (QUALITY_SCORE[result.quality] ?? 2) : 0;
  const mediaMatch = intent.mediaType && result.mediaType === intent.mediaType ? 7 : 0;
  const regionMatch = intent.region && result.region === intent.region ? 5 : 0;

  // === Penalties ===
  const deadPenalty = computeDeadPenalty(result);
  const suspiciousPenalty = isSuspicious(result.title) ? -30 : 0;
  const spamPenalty = isSpam(result.title) ? -50 : 0;

  // === Freshness ===
  const freshness = freshnessScore(result.uploadedAt);

  // === Language ===
  const langScore = languageScore(result, intent);

  // === Size sanity check ===
  const sizeSanity = sizeSanityScore(result);

  return Number(
    (
      seedScore +
      peerHealth +
      seederVelocity +
      reliabilityScore +
      preferredSource +
      trusted +
      groupTrust +
      qualityScore +
      mediaMatch +
      regionMatch +
      deadPenalty +
      suspiciousPenalty +
      spamPenalty +
      freshness +
      langScore +
      sizeSanity
    ).toFixed(2),
  );
}

export function rankResults(results: SearchResult[], intent: SearchIntent): SearchResult[] {
  return results
    .map((result) => ({ ...result, score: scoreResult(result, intent) }))
    .sort((a, b) => b.score - a.score || b.seeders - a.seeders);
}

/**
 * Compute a "dead torrent" penalty based on multiple signals:
 * - 0 seeders = almost certainly dead
 * - Very old upload with few seeders = likely abandoned
 * - Extremely low seeder/leecher ratio = dying swarm
 */
function computeDeadPenalty(result: SearchResult): number {
  if (result.seeders === 0) return -30;
  if (result.seeders <= 2 && result.leechers === 0) return -12;

  // Old torrents with very few seeders are likely dead
  if (result.uploadedAt) {
    const ageDays = (Date.now() - new Date(result.uploadedAt).getTime()) / 86_400_000;
    if (ageDays > 365 && result.seeders < 3) return -15;
    if (ageDays > 730 && result.seeders < 5) return -10;
  }

  return 0;
}

/**
 * Seeder velocity: recent torrents with high seeder counts are the healthiest.
 * A torrent uploaded last week with 500 seeders is almost guaranteed to work.
 */
function seederVelocityScore(result: SearchResult): number {
  if (!result.uploadedAt || result.seeders < 10) return 0;
  const ageDays = (Date.now() - new Date(result.uploadedAt).getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 0;

  // Seeders per day since upload — high velocity = viral/healthy torrent
  const velocity = result.seeders / Math.max(1, ageDays);
  if (velocity > 50) return 8;
  if (velocity > 20) return 5;
  if (velocity > 5) return 3;
  return 0;
}

/**
 * Bonus for known trusted release groups in the title.
 */
function trustedGroupBonus(title: string): number {
  const lower = title.toLowerCase();
  const hasTrusted = TRUSTED_GROUPS.some((g) => lower.includes(g));
  return hasTrusted ? 4 : 0;
}

/**
 * Size sanity check: extremely small "movies" or "games" are likely fakes.
 */
function sizeSanityScore(result: SearchResult): number {
  if (!result.sizeBytes) return 0;
  const mb = result.sizeBytes / (1024 * 1024);

  // Movies/games under 50MB are almost certainly fake
  if ((result.mediaType === "movie" || result.mediaType === "game") && mb < 50) return -20;
  // TV episodes under 10MB are suspicious
  if (result.mediaType === "tv" && mb < 10) return -15;
  // Anything over 0 is fine
  return 0;
}

function freshnessScore(uploadedAt?: string): number {
  if (!uploadedAt) return 0;
  const age = Date.now() - new Date(uploadedAt).getTime();
  if (!Number.isFinite(age) || age < 0) return 0;
  const days = age / 86_400_000;
  if (days < 3) return 8;
  if (days < 7) return 6;
  if (days < 30) return 4;
  if (days < 90) return 2;
  if (days < 365) return 1;
  return 0;
}

function isSuspicious(title: string): boolean {
  return /\.(exe|scr|bat)\b/i.test(title) || /\b(password|crack only|keygen only)\b/i.test(title);
}

function isSpam(title: string): boolean {
  return SPAM_PATTERNS.some((pattern) => pattern.test(title));
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
  if (matchesLanguage(titleLower, resultLang, wantedLang)) {
    return 12;
  }

  // Check if the result is in a DIFFERENT Indian language than the one wanted
  if (INDIAN_LANGUAGES.includes(wantedLang)) {
    const hasOtherIndianLang = INDIAN_LANGUAGES.some(
      (lang) => lang !== wantedLang && matchesLanguage(titleLower, resultLang, lang),
    );
    if (hasOtherIndianLang) return -10;
  }

  return 0;
}

function matchesLanguage(titleLower: string, resultLang: string | undefined, lang: string): boolean {
  if (resultLang === lang) return true;
  if (titleLower.includes(lang)) return true;

  const abbrev: Record<string, string> = {
    hindi: "hin",
    tamil: "tam",
    telugu: "tel",
    malayalam: "mal",
    kannada: "kan",
    bengali: "ben",
    punjabi: "pun",
    english: "eng",
  };
  const short = abbrev[lang];
  if (short && new RegExp(`\\b${short}\\b`).test(titleLower)) {
    return true;
  }
  return false;
}
