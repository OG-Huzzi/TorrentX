import type { SearchEngine } from "../core/search-engine.js";
import { ResultStore } from "../services/result-store.js";
import type { TopPeriod } from "../types/search.js";
import { renderReport } from "../ui/render.js";
import { toSearchOptions, type CliSearchOptions } from "./search.js";

const PERIODS: readonly TopPeriod[] = ["today", "week"];

export function parseTopPeriod(raw: string | undefined): TopPeriod {
  if (!raw) return "week";
  const normalized = raw.toLowerCase();
  if ((PERIODS as readonly string[]).includes(normalized)) {
    return normalized as TopPeriod;
  }
  throw new Error(`Period must be one of: ${PERIODS.join(", ")}.`);
}

export async function executeTop(
  engine: SearchEngine,
  rawPeriod: string | undefined,
  cliOptions: CliSearchOptions,
): Promise<void> {
  const period = parseTopPeriod(rawPeriod);
  const searchOptions = toSearchOptions({
    ...cliOptions,
    limit: cliOptions.limit ?? "100",
  });

  const report = await engine.search("", {
    ...searchOptions,
    top: period,
    expandQuery: false,
  });
  await new ResultStore().save(report.results).catch(() => undefined);

  if (cliOptions.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  renderReport(report, cliOptions.mobile === undefined ? {} : { mobile: cliOptions.mobile });
  if (report.results.length) {
    console.log("\nUse `torrentx magnet 2`, `torrentx open 2`, or `torrentx export 2`.");
  }
}
