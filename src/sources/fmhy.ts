import type { SearchRequest, SourceAdapter, SearchResult } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";
import { CacheService } from "../services/cache-service.js";
import { createResult } from "./source-utils.js";

interface FmhyEntry {
  title: string;
  url: string;
  description: string;
  category: string;
}

export class FmhyAdapter implements SourceAdapter {
  readonly id = "fmhy";
  readonly name = "FreeMediaHeckYeah";
  readonly reliability = 1.0;
  readonly mediaTypes = ["movie", "tv", "anime", "game", "software", "documentary", "other"] as const;
  readonly regions = ["global"] as const;

  private readonly cache = new CacheService(24 * 60 * 60 * 1000); // 24 hours TTL
  private entries: FmhyEntry[] | null = null;
  private loadPromise: Promise<FmhyEntry[]> | null = null;

  constructor(private readonly http: HttpClient) {}

  async search(request: SearchRequest): Promise<SearchResult[]> {
    const entries = await this.ensureEntries(request.signal);
    const queryWords = request.intent.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) return [];

    const matches: Array<{ entry: FmhyEntry; score: number }> = [];

    for (const entry of entries) {
      const titleLower = entry.title.toLowerCase();
      const descLower = entry.description.toLowerCase();
      const catLower = entry.category.toLowerCase();

      // All search keywords must match title, description, or category
      const matchesAll = queryWords.every(
        (word) =>
          titleLower.includes(word) ||
          descLower.includes(word) ||
          catLower.includes(word),
      );

      if (matchesAll) {
        // Compute relevance score for ranking
        let score = 0;
        if (queryWords.some((word) => titleLower.startsWith(word))) score += 100;
        if (queryWords.some((word) => titleLower === word)) score += 200;
        queryWords.forEach((word) => {
          if (titleLower.includes(word)) score += 50;
          if (catLower.includes(word)) score += 20;
          if (descLower.includes(word)) score += 10;
        });

        matches.push({ entry, score });
      }
    }

    // Sort by relevance score descending
    matches.sort((a, b) => b.score - a.score);

    return matches.slice(0, request.limit).map(({ entry }) => {
      // Build a neat title: "[FMHY] [Category] Title - Description"
      const prefix = `[FMHY] [${entry.category}]`;
      const suffix = entry.description ? ` - ${entry.description}` : "";
      const displayTitle = `${prefix} ${entry.title}${suffix}`;

      return createResult({
        title: displayTitle,
        source: this.id,
        sourceReliability: this.reliability,
        detailsUrl: entry.url,
        seeders: 0,
        leechers: 0,
        trusted: true,
        mediaType: request.intent.mediaType,
      });
    });
  }

  private ensureEntries(signal?: AbortSignal): Promise<FmhyEntry[]> {
    if (this.entries) return Promise.resolve(this.entries);
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this.loadEntries(signal).then((entries) => {
      this.entries = entries;
      this.loadPromise = null;
      return entries;
    }).catch((err) => {
      this.loadPromise = null;
      throw err;
    });

    return this.loadPromise;
  }

  private async loadEntries(signal?: AbortSignal): Promise<FmhyEntry[]> {
    // 1. Try local cache first
    const cached = await this.cache.get<FmhyEntry[]>("fmhy-parsed-entries");
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    // 2. Cache miss — download single-page Markdown
    const markdown = await this.http.text("https://api.fmhy.net/single-page", signal);
    const parsed = this.parseMarkdown(markdown);

    if (parsed.length > 0) {
      // 3. Save to cache
      await this.cache.set("fmhy-parsed-entries", parsed).catch(() => undefined);
    }

    return parsed;
  }

  private parseMarkdown(markdown: string): FmhyEntry[] {
    const lines = markdown.split("\n");
    let currentCategory = "General";
    const parsed: FmhyEntry[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Extract section/category headings (e.g., "# ► Adblocking")
      if (trimmed.startsWith("#")) {
        currentCategory = trimmed.replace(/^#+\s*(?:►|▷)?\s*/, "").trim();
        continue;
      }

      // Extract bullet point items that start with a link
      if (trimmed.startsWith("*")) {
        const linkMatch = trimmed.match(/^\*\s*(?:↪️|⭐|🌐|↪|💎|🔥|⚡)?\s*(?:\*\*)?\[([^\]]+)\]\((https?:\/\/[^)]+)\)(?:\*\*)?/);
        if (linkMatch) {
          const title = linkMatch[1]!.trim();
          const url = linkMatch[2]!.trim();

          // Skip navigation/system links
          if (title.includes("Back to Wiki Index") || title === "Note") {
            continue;
          }

          // Strip main link and leading icons from description
          let desc = trimmed
            .replace(/^\*\s*(?:↪️|⭐|🌐|↪|💎|🔥|⚡)?\s*/, "")
            .replace(/(?:\*\*)?\[[^\]]+\]\([^)]+\)(?:\*\*)?/, "")
            .replace(/^\s*[-\/|,;:]\s*/, "")
            .trim();

          parsed.push({
            title,
            url,
            description: desc,
            category: currentCategory,
          });
        }
      }
    }

    return parsed;
  }
}
