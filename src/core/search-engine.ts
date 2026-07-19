import type { TorrentXConfig } from "../types/config.js";
import type {
  SearchIntent,
  SearchOptions,
  SearchProgressListener,
  SearchReport,
  SearchRequest,
  SearchResult,
  SourceAdapter,
  SourceRun,
} from "../types/search.js";
import { CacheService } from "../services/cache-service.js";
import { dedupeResults } from "../services/dedupe-service.js";
import { applyFilters } from "../services/filter-service.js";
import { MetadataService } from "../services/metadata-service.js";
import { rankResults } from "../services/ranking-service.js";
import { describeSourceFailure } from "../services/source-failure.js";
import { SourceHealthTracker } from "../services/source-health.js";
import { inferSearchIntent, expandQuery } from "./query-intelligence.js";

interface CachedSearch {
  results: SearchResult[];
  sources: SourceRun[];
}

export class SearchEngine {
  private readonly metadata: MetadataService;
  private readonly health: SourceHealthTracker;

  constructor(
    private readonly sources: SourceAdapter[],
    private readonly config: TorrentXConfig,
    private readonly cache = new CacheService(config.cacheTtlMs),
    health?: SourceHealthTracker,
  ) {
    this.metadata = new MetadataService(config);
    this.health = health ?? new SourceHealthTracker();
  }

  getSources(): readonly SourceAdapter[] {
    return this.sources;
  }

  getHealthTracker(): SourceHealthTracker {
    return this.health;
  }

  async search(
    query: string,
    options: SearchOptions = {},
    onProgress?: SearchProgressListener,
  ): Promise<SearchReport> {
    const startedAt = Date.now();
    const intent = inferSearchIntent(query, {
      ...(options.mediaType ? { mediaType: options.mediaType } : {}),
      ...(options.language ? { language: options.language } : {}),
    });
    const limit = Math.max(1, Math.min(options.limit ?? 100, 100));
    const cacheKey = JSON.stringify({ query: intent.query, intent, options: cacheableOptions(options), limit });

    if (options.cache !== false) {
      const cached = await this.cache.get<CachedSearch>(cacheKey);
      if (cached) {
        const report: SearchReport = {
          query: intent.query,
          intent,
          results: cached.results,
          sources: cached.sources.map((source) => ({ ...source, cached: true })),
          durationMs: Date.now() - startedAt,
          cached: true,
        };
        onProgress?.({
          ...report,
          completedSources: cached.sources.length,
          totalSources: cached.sources.length,
        });
        return report;
      }
    }

    // Priority-based source scheduling: sort by intent relevance + learned reliability
    const selectedSources = this.sources
      .filter((source) => !options.source?.length || options.source.includes(source.id))
      .sort(
        (a, b) =>
          Number(intent.preferredSources.includes(b.id)) -
            Number(intent.preferredSources.includes(a.id)) ||
          this.health.getEffectiveReliability(b.id, b.reliability) -
            this.health.getEffectiveReliability(a.id, a.reliability),
      );

    onProgress?.({
      query: intent.query,
      intent,
      results: [],
      sources: [],
      durationMs: 0,
      cached: false,
      completedSources: 0,
      totalSources: selectedSources.length,
    });

    const completedRuns: Array<{ results: SearchResult[]; report: SourceRun }> = [];
    const runs = await Promise.all(
      selectedSources.map((source) =>
        this.runSource(source, {
          query: intent.query,
          intent,
          filters: options,
          limit,
        }, options.sourceTimeoutMs ?? this.config.sourceTimeoutMs, options.signal).then((run) => {
          completedRuns.push(run);
          const partialResults = rankResults(
            applyFilters(dedupeResults(completedRuns.flatMap((item) => item.results)), options),
            intent,
          ).slice(0, limit);
          onProgress?.({
            query: intent.query,
            intent,
            results: partialResults,
            sources: completedRuns.map((item) => item.report),
            durationMs: Date.now() - startedAt,
            cached: false,
            completedSources: completedRuns.length,
            totalSources: selectedSources.length,
          });
          return run;
        }),
      ),
    );

    if (options.signal?.aborted) throw new DOMException("Search aborted", "AbortError");

    const rawResults = runs.flatMap((run) => run.results);
    let results = rankResults(applyFilters(dedupeResults(rawResults), options), intent).slice(0, limit);

    // Smart query expansion: if results are sparse, retry with simplified queries
    if (results.length < 3 && options.expandQuery !== false) {
      const expandedResults = await this.searchWithExpansion(
        intent, options, limit, options.signal,
      );
      if (expandedResults.length > results.length) {
        results = expandedResults;
      }
    }

    // Cross-source consensus boost: torrents found on multiple sources are more likely alive
    results = this.applyConsensusBoost(results, rawResults);

    if (options.enrich !== false) {
      results = await this.metadata.enrich(results, intent);
    }

    const sources = runs.map(({ report }) => report);
    if (options.cache !== false) {
      await this.cache.set(cacheKey, { results, sources }).catch(() => undefined);
    }

    // Persist health metrics periodically
    void this.health.save();

    const report: SearchReport = {
      query: intent.query,
      intent,
      results,
      sources,
      durationMs: Date.now() - startedAt,
      cached: false,
    };
    onProgress?.({
      ...report,
      completedSources: sources.length,
      totalSources: selectedSources.length,
    });
    return report;
  }

  /**
   * Cross-source consensus: if the same info hash appears on multiple sources,
   * it's much more likely to be a real, working torrent. Boost its score.
   */
  private applyConsensusBoost(results: SearchResult[], allResults: SearchResult[]): SearchResult[] {
    // Count how many distinct sources have each info hash
    const hashSourceCount = new Map<string, Set<string>>();
    for (const r of allResults) {
      const hash = r.magnetUri?.match(/urn:btih:([^&]+)/i)?.[1]?.toLowerCase();
      if (!hash) continue;
      if (!hashSourceCount.has(hash)) hashSourceCount.set(hash, new Set());
      hashSourceCount.get(hash)!.add(r.source);
    }

    return results.map((r) => {
      const hash = r.magnetUri?.match(/urn:btih:([^&]+)/i)?.[1]?.toLowerCase();
      if (!hash) return r;
      const sourceCount = hashSourceCount.get(hash)?.size ?? 1;
      if (sourceCount <= 1) return r;
      // Boost: +4 per additional source confirming this torrent exists
      const boost = (sourceCount - 1) * 4;
      return { ...r, score: Number((r.score + boost).toFixed(2)) };
    }).sort((a, b) => b.score - a.score || b.seeders - a.seeders);
  }

  /**
   * Smart query expansion: when initial results are sparse, try simplified
   * versions of the query (strip quality tags, remove year, etc.)
   */
  private async searchWithExpansion(
    intent: SearchIntent,
    options: SearchOptions,
    limit: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const alternatives = expandQuery(intent);
    if (alternatives.length === 0) return [];

    const allExpanded: SearchResult[] = [];
    for (const altQuery of alternatives) {
      if (signal?.aborted) break;
      const altIntent = { ...intent, query: altQuery };
      const runs = await Promise.all(
        this.sources
          .filter((s) => !options.source?.length || options.source.includes(s.id))
          .slice(0, 6) // Only query top sources for expansion to save time
          .map((source) =>
            this.runSource(source, {
              query: altQuery,
              intent: altIntent,
              filters: options,
              limit,
            }, options.sourceTimeoutMs ?? this.config.sourceTimeoutMs, signal),
          ),
      );
      allExpanded.push(...runs.flatMap((r) => r.results));
      // Stop early if we found enough
      if (allExpanded.length >= limit) break;
    }

    return rankResults(
      applyFilters(dedupeResults(allExpanded), options),
      intent,
    ).slice(0, limit);
  }

  private async runSource(
    source: SourceAdapter,
    request: Omit<SearchRequest, "signal">,
    fallbackTimeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ results: SearchResult[]; report: SourceRun }> {
    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;

    // Use adaptive timeout based on historical performance
    const timeoutMs = Math.min(
      this.health.getTimeout(source.id, fallbackTimeoutMs),
      fallbackTimeoutMs,
    );

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });

    try {
      const results = await source.search({ ...request, signal: controller.signal });
      const durationMs = Date.now() - startedAt;

      // Record success for adaptive learning
      this.health.recordSuccess(source.id, durationMs);

      return {
        results,
        report: {
          source: source.id,
          durationMs,
          resultCount: results.length,
          cached: false,
        },
      };
    } catch (error) {
      const failure = describeSourceFailure(error, timedOut);

      // Record failure for adaptive learning
      this.health.recordFailure(source.id);

      return {
        results: [],
        report: {
          source: source.id,
          durationMs: Date.now() - startedAt,
          resultCount: 0,
          cached: false,
          error: failure.message,
          failureKind: failure.kind,
        },
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

function cacheableOptions(options: SearchOptions): object {
  const {
    cache: _cache,
    sourceTimeoutMs: _sourceTimeoutMs,
    signal: _signal,
    expandQuery: _expandQuery,
    ...cacheable
  } = options;
  return cacheable;
}
