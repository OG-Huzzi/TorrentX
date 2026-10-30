/**
 * Live smoke test for every built-in source adapter.
 *
 * Queries each source with a probe query and fails when a parser returns
 * zero results or errors — the early-warning system for upstream template
 * or endpoint changes (which previously surfaced only as silently empty
 * search results for users).
 *
 * Usage:  node scripts/smoke-sources.mjs [default-query]
 * Expects `npm run build` to have produced dist/index.js first.
 *
 * Run manually or via .github/workflows/smoke.yml (scheduled weekly).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "dist", "index.js");

if (!existsSync(bundlePath)) {
  console.error("smoke: dist/index.js not found — run `npm run build` first.");
  process.exit(2);
}

const { createConfig, createDefaultSources, inferSearchIntent } = await import(
  pathToFileURL(bundlePath).href
);

/** Per-source probe queries that should always return results. */
const PROBE_QUERIES = {
  yts: "inception",
  nyaa: "naruto",
  subsplease: "naruto",
  eztv: "1080p",
  fitgirl: "skyrim",
  piratebay: "ubuntu",
  torrentgalaxy: "ubuntu",
  bitsearch: "ubuntu",
  limetorrents: "ubuntu",
  fmhy: "streaming",
};

const DEFAULT_TIMEOUT_MS = 20_000;
const config = createConfig({ sourceTimeoutMs: DEFAULT_TIMEOUT_MS });
const sources = createDefaultSources(config);
const fallbackQuery = process.argv[2] ?? "ubuntu";

console.log(`smoke: probing ${sources.length} sources...\n`);

const failures = [];

for (const source of sources) {
  const query = PROBE_QUERIES[source.id] ?? fallbackQuery;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  let outcome;
  try {
    const results = await source.search({
      query,
      intent: inferSearchIntent(query),
      filters: {},
      limit: 10,
      signal: controller.signal,
    });
    outcome = { ok: results.length > 0, detail: `${results.length} results` };
  } catch (error) {
    outcome = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - startedAt;
  const status = outcome.ok ? "OK  " : "FAIL";
  console.log(
    `${status}  ${source.id.padEnd(14)} ${String(durationMs).padStart(6)}ms  "${query}"  ${outcome.detail}`,
  );
  if (!outcome.ok) failures.push(`${source.id}: ${outcome.detail}`);
}

console.log();
if (failures.length > 0) {
  console.error(`smoke: ${failures.length} source(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("smoke: all sources healthy.");
