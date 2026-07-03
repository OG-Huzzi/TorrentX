import Table from "cli-table3";
import type { SearchReport, SearchResult } from "../types/search.js";
import { formatSize } from "../utils/size.js";
import { truncate } from "../utils/text.js";
import { theme } from "./theme.js";

export interface RenderOptions {
  mobile?: boolean;
  selectedIndex?: number;
  clear?: boolean;
}

export function isMobileTerminal(forceMobile = false): boolean {
  return forceMobile || Boolean(process.env.TERMUX_VERSION) || (process.stdout.columns ?? 80) < 82;
}

export function renderReport(report: SearchReport, options: RenderOptions = {}): void {
  if (options.clear && process.stdout.isTTY) process.stdout.write("\x1Bc");
  renderHeader(report);

  if (report.results.length === 0) {
    console.log(theme.muted("\nNo matches passed the active filters."));
  } else if (isMobileTerminal(options.mobile)) {
    renderMobileResults(report.results, options.selectedIndex);
  } else {
    renderDesktopResults(report.results, options.selectedIndex);
  }

  renderFooter(report);
}

export function renderResultDetails(result: SearchResult): void {
  const metadata = result.metadata;
  console.log("");
  console.log(theme.title(metadata?.title ?? result.title));
  const facts = [
    metadata?.year,
    metadata?.rating !== undefined ? `Rating ${metadata.rating.toFixed(1)}` : undefined,
    metadata?.country,
    metadata?.language ?? result.language,
    metadata?.genres?.join(", "),
    metadata?.runtimeMinutes ? `${metadata.runtimeMinutes} min` : undefined,
  ].filter(Boolean);
  if (facts.length) console.log(theme.muted(facts.join("  |  ")));
  console.log(
    `${theme.brand(result.source)}  ${formatSize(result.sizeBytes)}  ${theme.success(`${result.seeders} seeds`)}  score ${result.score.toFixed(1)}`,
  );
  if (metadata?.overview) console.log(`\n${metadata.overview}`);
  if (metadata?.posterUrl) console.log(theme.muted(`Poster: ${metadata.posterUrl}`));
  if (result.detailsUrl) console.log(theme.muted(`Details: ${result.detailsUrl}`));
  if (result.magnetUri) console.log(theme.muted("Magnet available"));
  else if (result.torrentUrl) console.log(theme.muted("Torrent download available"));
}

function renderHeader(report: SearchReport): void {
  const intent = [
    report.intent.mediaType,
    report.intent.region,
    report.intent.language,
  ].filter(Boolean);
  console.log(`${theme.brand.bold("TORRENTX")} ${theme.muted("meta-search")}`);
  console.log(
    `${theme.title(report.query)}${intent.length ? theme.muted(`  /  ${intent.join("  /  ")}`) : ""}`,
  );
}

function renderDesktopResults(results: SearchResult[], selectedIndex?: number): void {
  const width = process.stdout.columns ?? 110;
  const titleWidth = Math.max(34, width - 52);
  const table = new Table({
    head: ["#", "Title", "Source", "Quality", "Size", "Seeds", "Score"],
    colWidths: [4, titleWidth, 12, 9, 11, 8, 8],
    style: { head: ["cyan"], border: ["gray"], compact: true },
    wordWrap: false,
  });

  for (const [index, result] of results.entries()) {
    const selected = selectedIndex === index;
    const row = [
      String(index + 1),
      truncate(result.title, titleWidth - 2),
      result.source,
      result.quality ?? "-",
      formatSize(result.sizeBytes),
      String(result.seeders),
      result.score.toFixed(1),
    ];
    table.push(selected ? row.map((cell) => theme.selected(` ${cell} `)) : row);
  }
  console.log(`\n${table.toString()}`);
}

function renderMobileResults(results: SearchResult[], selectedIndex?: number): void {
  console.log("");
  for (const [index, result] of results.entries()) {
    const prefix = selectedIndex === index ? theme.brand(">") : `${index + 1})`;
    console.log(`${prefix} ${theme.title(truncate(result.title, 64))}`);
    console.log(
      `   ${result.quality ?? "?"}  ${formatSize(result.sizeBytes)}  ${theme.success(`${result.seeders} seeds`)}  ${theme.muted(result.source)}`,
    );
  }
}

function renderFooter(report: SearchReport): void {
  const failed = report.sources.filter((source) => source.error);
  const status = `${report.results.length} results in ${report.durationMs}ms${report.cached ? " (cache)" : ""}`;
  console.log(theme.muted(`\n${status}`));
  if (failed.length) {
    console.log(
      theme.muted(
        `Unavailable: ${failed.map((source) => `${source.source} (${source.error})`).join(", ")}`,
      ),
    );
  }
}
