import { readFileSync } from "node:fs";
import { Command } from "commander";
import { createConfig } from "./core/config.js";
import { loadPluginSources } from "./core/plugins.js";
import { SearchEngine } from "./core/search-engine.js";
import { executeStoredAction } from "./commands/actions.js";
import { executeDownloadsList } from "./commands/downloads.js";
import { executeDoctor } from "./commands/doctor.js";
import {
  addSearchOptions,
  executeSearch,
  toSearchOptions,
  type CliSearchOptions,
} from "./commands/search.js";
import { executeTop } from "./commands/top.js";
import { createDefaultSources } from "./sources/index.js";
import { HttpClient } from "./services/http-client.js";
import { SourceHealthTracker } from "./services/source-health.js";
import { startTor, type TorHandle } from "./services/tor-service.js";
import { shouldWarmupDns, warmupDns } from "./services/dns-warmup.js";
import type { MediaType } from "./types/search.js";
import type { SearchEngine as SearchEngineType } from "./core/search-engine.js";
import { runInteractive } from "./ui/interactive.js";

const VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version as string;
const config = createConfig();

// Initialize adaptive source health tracking (learns from past sessions)
const healthTracker = new SourceHealthTracker(undefined, {
  defaultTimeoutMs: config.sourceTimeoutMs,
});
// Started now, awaited before the first search so learned metrics are in
// place before any source run records new ones.
const healthLoaded = healthTracker.load();

interface Runtime {
  engine: SearchEngineType;
  sources: ReturnType<typeof createDefaultSources>;
}

let runtime: Runtime | undefined;
let tor: TorHandle | undefined;

/**
 * Build the source set and search engine lazily so that --tor / TORRENTX_TOR
 * can bring the Tor daemon up first: the HTTP client's dispatcher (which
 * picks up the SOCKS proxy) is fixed at first construction.
 */
async function ensureRuntime(wantTor?: boolean): Promise<Runtime> {
  if (runtime) return runtime;

  const useTor = wantTor ?? config.tor ?? false;
  if (useTor) {
    process.stderr.write("torrentx: starting Tor (bootstrap can take up to a minute)...\n");
    tor = await startTor({
      ...(config.torBinary ? { binary: config.torBinary } : {}),
      onProgress: (percent) => {
        if (percent < 100) process.stderr.write(`torrentx: Tor bootstrap ${percent}%\n`);
      },
    });
    // --tor wins over any other proxy setting: it is the most explicit intent.
    config.socks5Proxy = tor.socksUrl;
    config.tor = true;
    // Someone who asked for Tor should not silently get direct retries when
    // a request through Tor fails; that stays opt-in (proxyFallback: true).
    config.proxyFallback ??= false;
    // Multi-hop circuits add seconds of latency per request; learned and
    // default timeouts would otherwise cut sources off mid-handshake.
    config.timeoutFloorMs = Math.max(config.timeoutFloorMs ?? 0, 30_000);
  }

  // Pre-resolve DNS for all source domains in the background — only when
  // source traffic actually uses the system resolver.
  if (shouldWarmupDns(config)) warmupDns();

  const http = new HttpClient(config);
  if (tor) announceTorExit(http);
  await healthLoaded;

  const pluginSources = await loadPluginSources(config.plugins ?? [], http);
  const sources = [...createDefaultSources(config), ...pluginSources];
  runtime = {
    engine: new SearchEngine(sources, config, undefined, healthTracker),
    sources,
  };
  return runtime;
}

/** Pre-build a Tor circuit and report the exit node (proves the route works). */
function announceTorExit(http: HttpClient): void {
  void http
    .json<{ IP?: string }>(
      "https://check.torproject.org/api/ip",
      AbortSignal.timeout(30_000),
    )
    .then((info) => {
      process.stderr.write(`torrentx: Tor ready${info.IP ? ` (exit ${info.IP})` : ""}\n`);
    })
    .catch(() => {
      process.stderr.write("torrentx: Tor ready\n");
    });
}

async function shutdown(): Promise<void> {
  await tor?.stop().catch(() => undefined);
  tor = undefined;
  // Flush learned source-health metrics once the command (or interactive
  // session) has fully settled. Awaited so the write completes before Node
  // drains its event loop and exits.
  await healthTracker.save();
}

const program = new Command();

program
  .name("torrentx")
  .description("Fast, adaptive torrent meta-search for every terminal.")
  .version(VERSION)
  .argument("[torrentOrMagnet]", "magnet link or path to a .torrent file to download on launch")
  .option("--mobile", "force compact Termux-style UI")
  .option("--tor", "route source requests through a built-in Tor connection")
  .option("--no-cache", "skip cached search results")
  .option("--no-enrich", "disable metadata API enrichment")
  .action(async (torrentOrMagnet: string | undefined, options: CliSearchOptions) => {
    const { engine } = await ensureRuntime(options.tor);
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
).action(async (query: string[], options: CliSearchOptions, command: Command) => {
  const merged = command.optsWithGlobals() as CliSearchOptions;
  const { engine } = await ensureRuntime(merged.tor);
  await executeSearch(engine, query, merged);
});

addSearchOptions(
  program
    .command("top")
    .description("browse the top 100 without searching")
    .argument("[period]", "today (last 24h) or week (last 7 days), default: week"),
).action(async (period: string | undefined, options: CliSearchOptions, command: Command) => {
  const merged = command.optsWithGlobals() as CliSearchOptions;
  const { engine } = await ensureRuntime(merged.tor);
  await executeTop(engine, period, merged);
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
  ).action(async (query: string[], options: CliSearchOptions, command: Command) => {
    const prefix =
      commandName === "kdrama" || commandName === "bollywood" ? `${commandName} ` : "";
    const merged = command.optsWithGlobals() as CliSearchOptions;
    const { engine } = await ensureRuntime(merged.tor);
    await executeSearch(engine, [`${prefix}${query.join(" ")}`], merged, mediaType);
  });
}

program
  .command("sources")
  .description("list built-in source adapters")
  .action(async () => {
    const { sources } = await ensureRuntime(false);
    for (const source of sources) {
      console.log(
        `${source.id.padEnd(12)} reliability ${(source.reliability * 100).toFixed(0)}%  ${source.mediaTypes.join(", ")}`,
      );
    }
  });

program
  .command("doctor")
  .description("check that TorrentX can run on this machine")
  .action(() => executeDoctor(config));

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
}).finally(() => shutdown());
