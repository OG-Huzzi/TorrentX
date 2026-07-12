import type { Command } from "commander";
import type { SearchEngine } from "../core/search-engine.js";
import { ResultStore } from "../services/result-store.js";
import type { MediaType, SearchOptions } from "../types/search.js";
import { parseSize } from "../utils/size.js";
import { renderReport } from "../ui/render.js";

export interface CliSearchOptions {
  quality?: string;
  source?: string;
  minSize?: string;
  maxSize?: string;
  language?: string;
  minSeeds?: string;
  codec?: string;
  limit?: string;
  json?: boolean;
  mobile?: boolean;
  cache?: boolean;
  enrich?: boolean;
  fourK?: boolean;
  type?: MediaType;
}

export function addSearchOptions(command: Command): Command {
  return command
    .option("-q, --quality <quality>", "filter by quality, for example 1080p")
    .option("--4k", "shortcut for --quality 2160p")
    .option("-s, --source <ids>", "comma-separated source IDs")
    .option("--min-size <size>", "minimum size, for example 700MB")
    .option("--max-size <size>", "maximum size, for example 8GB")
    .option("-l, --language <language>", "language filter and search hint")
    .option("--min-seeds <number>", "minimum number of seeders")
    .option("--codec <codec>", "codec filter, for example x265")
    .option("-n, --limit <number>", "maximum results", "100")
    .option("--no-cache", "skip cached search results")
    .option("--no-enrich", "disable metadata API enrichment")
    .option("--mobile", "force compact Termux-style output")
    .option("--json", "emit a machine-readable search report");
}

export async function executeSearch(
  engine: SearchEngine,
  queryParts: string[],
  cliOptions: CliSearchOptions,
  mediaType?: MediaType,
): Promise<void> {
  const query = queryParts.join(" ").trim();
  if (!query) throw new Error("A search query is required.");

  const report = await engine.search(query, toSearchOptions(cliOptions, mediaType));
  await new ResultStore().save(report.results).catch(() => undefined);

  if (cliOptions.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    renderReport(report, cliOptions.mobile === undefined ? {} : { mobile: cliOptions.mobile });
    if (report.results.length) {
      console.log("\nUse `torrentx magnet 2`, `torrentx open 2`, or `torrentx export 2`.");
    }
  }
}

export function toSearchOptions(
  options: CliSearchOptions,
  mediaType?: MediaType,
): SearchOptions {
  const limit = parsePositiveInteger(options.limit, "limit");
  const minSeeders = parsePositiveInteger(options.minSeeds, "min-seeds");
  const minSizeBytes = parseCliSize(options.minSize, "min-size");
  const maxSizeBytes = parseCliSize(options.maxSize, "max-size");

  return {
    limit: limit ?? 100,
    cache: options.cache !== false,
    enrich: options.enrich !== false,
    ...optional("quality", options.fourK ? "2160p" : options.quality),
    ...optional(
      "source",
      options.source
        ?.split(",")
        .map((source) => source.trim().toLowerCase())
        .filter(Boolean),
    ),
    ...optional("minSizeBytes", minSizeBytes),
    ...optional("maxSizeBytes", maxSizeBytes),
    ...optional("language", options.language),
    ...optional("minSeeders", minSeeders),
    ...optional("codec", options.codec),
    ...optional("mediaType", mediaType ?? options.type),
  };
}

function parsePositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  return parsed;
}

function parseCliSize(value: string | undefined, name: string): number | undefined {
  if (!value) return undefined;
  const parsed = parseSize(value);
  if (parsed === undefined) throw new Error(`--${name} must look like 700MB, 2GB, or 1.5GiB.`);
  return parsed;
}

function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]: V });
}
