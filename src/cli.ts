import { Command } from "commander";
import { createConfig } from "./core/config.js";
import { SearchEngine } from "./core/search-engine.js";
import { executeStoredAction } from "./commands/actions.js";
import { executeDownloadsList } from "./commands/downloads.js";
import {
  addSearchOptions,
  executeSearch,
  toSearchOptions,
  type CliSearchOptions,
} from "./commands/search.js";
import { createDefaultSources } from "./sources/index.js";
import type { MediaType } from "./types/search.js";
import { runInteractive } from "./ui/interactive.js";

const VERSION = "0.1.0";
const config = createConfig();
const engine = new SearchEngine(createDefaultSources(config), config);
const program = new Command();

program
  .name("torrentx")
  .description("Fast, adaptive torrent meta-search for every terminal.")
  .version(VERSION)
  .argument("[torrentOrMagnet]", "magnet link or path to a .torrent file to download on launch")
  .option("--mobile", "force compact Termux-style UI")
  .option("--no-cache", "skip cached search results")
  .option("--no-enrich", "disable metadata API enrichment")
  .action(async (torrentOrMagnet: string | undefined, options: CliSearchOptions) => {
    await runInteractive(
      engine,
      {
        ...toSearchOptions(options),
        ...(options.mobile === undefined ? {} : { mobile: options.mobile }),
      },
      torrentOrMagnet,
    );
  });

addSearchOptions(
  program
    .command("search")
    .description("search all enabled sources")
    .argument("<query...>", "search terms"),
).action(async (query: string[], options: CliSearchOptions) => {
  await executeSearch(engine, query, options);
});

for (const [commandName, mediaType, description] of [
  ["movie", "movie", "search movies"],
  ["anime", "anime", "search anime"],
  ["kdrama", "tv", "search Korean drama"],
  ["bollywood", "movie", "search Indian cinema"],
  ["tv", "tv", "search television"],
  ["game", "game", "search games"],
  ["software", "software", "search software"],
  ["documentary", "documentary", "search documentaries"],
] as const satisfies ReadonlyArray<readonly [string, MediaType, string]>) {
  addSearchOptions(
    program.command(commandName).description(description).argument("<query...>", "search terms"),
  ).action(async (query: string[], options: CliSearchOptions) => {
    const prefix =
      commandName === "kdrama" || commandName === "bollywood" ? `${commandName} ` : "";
    await executeSearch(engine, [`${prefix}${query.join(" ")}`], options, mediaType);
  });
}

program
  .command("sources")
  .description("list built-in source adapters")
  .action(() => {
    for (const source of createDefaultSources(config)) {
      console.log(
        `${source.id.padEnd(12)} reliability ${(source.reliability * 100).toFixed(0)}%  ${source.mediaTypes.join(", ")}`,
      );
    }
  });

program
  .command("magnet")
  .description("copy a magnet from the most recent search")
  .argument("<index>", "one-based result number")
  .action((index: string) => executeStoredAction("magnet", index));

program
  .command("open")
  .alias("download")
  .description("open a magnet or torrent URL with the system handler")
  .argument("<index>", "one-based result number")
  .action((index: string) => executeStoredAction("open", index));

program
  .command("export")
  .description("export a magnet or torrent URL")
  .argument("<index>", "one-based result number")
  .argument("[file]", "destination file")
  .action((index: string, file?: string) => executeStoredAction("export", index, file));

program
  .command("downloads")
  .alias("dl")
  .description("list current and completed downloads")
  .option("--json", "output as JSON")
  .action((opts: { json?: boolean }) => executeDownloadsList(opts));

program.configureOutput({
  outputError: (message, write) => write(`torrentx: ${message}`),
});

program.parseAsync().catch((error: unknown) => {
  console.error(`torrentx: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
