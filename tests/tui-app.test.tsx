import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { TorrentXApp } from "../src/ui/app.js";
import { createConfig } from "../src/core/config.js";
import { SearchEngine } from "../src/core/search-engine.js";
import { CacheService } from "../src/services/cache-service.js";
import { createResult } from "../src/sources/source-utils.js";
import type { SourceAdapter } from "../src/types/search.js";

describe("TorrentXApp", () => {
  it("opens on a search field and streams results after submit", async () => {
    const source: SourceAdapter = {
      id: "demo",
      name: "Demo",
      reliability: 0.9,
      mediaTypes: ["other"],
      regions: ["global"],
      async search() {
        return [
          createResult({
            title: "Ubuntu Linux ISO",
            source: "demo",
            sourceReliability: 0.9,
            seeders: 42,
          }),
        ];
      },
    };
    const directory = await mkdtemp(path.join(os.tmpdir(), "torrentx-tui-test-"));
    const config = createConfig({ tmdbApiKey: undefined, omdbApiKey: undefined });
    const engine = new SearchEngine(
      [source],
      config,
      new CacheService(config.cacheTtlMs, directory),
    );
    const app = render(<TorrentXApp engine={engine} options={{ cache: false, enrich: false }} />);

    expect(app.lastFrame()).toContain("Search movies, anime, games");
    await new Promise((resolve) => setTimeout(resolve, 10));
    app.stdin.write("ubuntu");
    await new Promise((resolve) => setTimeout(resolve, 10));
    app.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(app.lastFrame()).toContain("Ubuntu Linux ISO");
    expect(app.lastFrame()).toContain("42");
    app.unmount();
  });
});
