import type { MediaType } from "../types/search.js";

const QUALITY_PATTERNS = [
  "2160p",
  "4k",
  "1080p",
  "1080i",
  "720p",
  "480p",
  "uhd",
] as const;

const CODEC_PATTERNS = ["av1", "x265", "h265", "hevc", "x264", "h264"] as const;

export function detectQuality(title: string): string | undefined {
  const lower = title.toLowerCase();
  const quality = QUALITY_PATTERNS.find((candidate) => lower.includes(candidate));
  if (quality === "4k" || quality === "uhd") return "2160p";
  // "1080i" must stay lowercase to match the canonical quality keys.
  if (quality === "1080i") return "1080i";
  return quality?.toUpperCase().replace("P", "p");
}

export function detectCodec(title: string): string | undefined {
  const lower = title.toLowerCase();
  return CODEC_PATTERNS.find((candidate) => lower.includes(candidate))?.toUpperCase();
}

export function detectMediaType(title: string): MediaType | undefined {
  const lower = title.toLowerCase();
  if (/\bs\d{1,2}e\d{1,3}\b|\bseason\s+\d+\b/.test(lower)) return "tv";
  if (/\banime\b|\bsubsplease\b|\bdual audio\b/.test(lower)) return "anime";
  if (/\brepack\b|\bfitgirl\b|\bgame\b/.test(lower)) return "game";
  if (/\bsoftware\b|\bmacos\b|\bwindows\b|\blinux\b/.test(lower)) return "software";
  if (/\bdocumentary\b|\bdocu\b/.test(lower)) return "documentary";
  return undefined;
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b(2160p|4k|1080p|1080i|720p|480p|uhd|hdr|bluray|web-?dl|webrip|brrip)\b/g, " ")
    .replace(/\b(x265|h265|hevc|x264|h264|av1|aac|dts|ddp?\d?(?:\.\d)?)\b/g, " ")
    .replace(/\b(yts|yify|rarbg|eztv|nyaa|fitgirl)\b/g, " ")
    .replace(/[._()[\]{}-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  if (maxLength <= 3) return input.slice(0, maxLength);
  return `${input.slice(0, maxLength - 3)}...`;
}

/**
 * Remove C0/C1 control characters (ESC, BEL, CSI…) from text that came from
 * the network. Titles are printed straight to the terminal; an embedded
 * escape sequence could otherwise rewrite the screen, the window title or
 * the clipboard (OSC 52). Tabs and newlines become plain spaces.
 */
export function stripControlChars(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/ *[\u0000-\u001f\u007f-\u009f]+ */g, " ");
}

/** Language tags commonly found in release titles. */
export function detectLanguageFromTitle(title: string): string | undefined {
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

/** Escape a string for literal use inside a RegExp. */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Decode HTML entities in scraped text in a single pass (so "&amp;lt;"
 * correctly becomes "&lt;", not "<"). Handles the named entities source
 * pages use plus all decimal/hex numeric references.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}
