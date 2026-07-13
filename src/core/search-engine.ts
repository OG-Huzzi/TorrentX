import type { TorrentXConfig } from "../types/config.js";
import type {
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
import { inferSearchIntent } from "./query-intelligence.js";

interface CachedSearch {
  results: SearchResult[];
  sources: SourceRun[];
}

export class SearchEngine {
  private readonly metadata: MetadataService;

  constructor(
    private readonly sources: SourceAdapter[],
    private readonly config: TorrentXConfig,
    private readonly cache = new CacheService(config.cacheTtlMs),
  ) {
    this.metadata = new MetadataService(config);
  }

  getSources(): readonly SourceAdapter[] {
    return this.sources;
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

    const selectedSources = this.sources
      .filter((source) => !options.source?.length || options.source.includes(source.id))
      .sort(
        (a, b) =>
          Number(intent.preferredSources.includes(b.id)) -
            Number(intent.preferredSources.includes(a.id)) ||
          b.reliability - a.reliability,
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
    if (options.enrich !== false) {
      results = await this.metadata.enrich(results, intent);
    }

    const sources = runs.map(({ report }) => report);
    if (options.cache !== false) {
      await this.cache.set(cacheKey, { results, sources }).catch(() => undefined);
    }

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

  private async runSource(
    source: SourceAdapter,
    request: Omit<SearchRequest, "signal">,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ results: SearchResult[]; report: SourceRun }> {
    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });

    try {
      const results = await source.search({ ...request, signal: controller.signal });
      return {
        results,
        report: {
          source: source.id,
          durationMs: Date.now() - startedAt,
          resultCount: results.length,
          cached: false,
        },
      };
    } catch (error) {
      const failure = describeSourceFailure(error, timedOut);
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
    ...cacheable
  } = options;
  return cacheable;
}
