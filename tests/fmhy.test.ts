import { describe, expect, it, vi } from "vitest";
import { FmhyAdapter } from "../src/sources/fmhy.js";
import type { HttpClient } from "../src/services/http-client.js";
import { inferSearchIntent } from "../src/core/query-intelligence.js";
import type { SearchRequest } from "../src/types/search.js";

const sampleMarkdown = `
# ► Adblocking

* **Note** - Many sites contain ads, popups or redirects, so we [highly recommend](https://fmhy.net/beginners-guide#adblocking) using an adblocker.
* ⭐ **[uBlock Origin](https://github.com/gorhill/uBlock)** - Popular extension
* [Disblock Origin](https://codeberg.org/AllPurposeMat/Disblock-Origin) - Hide Discord Nitro Ads

# ► Video Streaming

* 🌐 **[Fmovies](https://fmovies.to)** - Streaming movies and TV shows
* [Soap2day](https://soap2day.to)
`;

describe("FmhyAdapter", () => {
  it("correctly parses markdown, filters search query, and returns results", async () => {
    const mockHttp = {
      text: vi.fn().mockResolvedValue(sampleMarkdown),
      json: vi.fn(),
    } as unknown as HttpClient;

    const adapter = new FmhyAdapter(mockHttp);
    const request: SearchRequest = {
      query: "disblock",
      intent: inferSearchIntent("disblock"),
      filters: {},
      limit: 10,
    };

    const results = await adapter.search(request);

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("[FMHY] [Adblocking] Disblock Origin - Hide Discord Nitro Ads");
    expect(results[0]?.detailsUrl).toBe("https://codeberg.org/AllPurposeMat/Disblock-Origin");
    expect(results[0]?.seeders).toBe(0);
    expect(results[0]?.source).toBe("fmhy");

    // Search for "movies" which should match Fmovies category "Video Streaming" and description
    const results2 = await adapter.search({
      query: "movies",
      intent: inferSearchIntent("movies"),
      filters: {},
      limit: 10,
    });
    expect(results2).toHaveLength(1);
    expect(results2[0]?.title).toBe("[FMHY] [Video Streaming] Fmovies - Streaming movies and TV shows");
    expect(results2[0]?.detailsUrl).toBe("https://fmovies.to");
  });
});
