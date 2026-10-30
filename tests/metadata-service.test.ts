import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../src/core/config.js";
import {
  MetadataService,
  titlesMatch,
} from "../src/services/metadata-service.js";
import type { SearchIntent, SearchResult } from "../src/types/search.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const INTENT: SearchIntent = {
  query: "inception",
  mediaType: "movie",
  preferredSources: [],
  terms: ["inception"],
};

function result(title: string): SearchResult {
  return {
    id: `id-${Math.random()}`,
    title,
    source: "yts",
    seeders: 50,
    leechers: 5,
    trusted: true,
    sourceReliability: 0.9,
    score: 0,
  };
}

describe("titlesMatch", () => {
  it("accepts noisy torrent titles that share most tokens", () => {
    expect(
      titlesMatch("inception 2010 1080p web dl x264", "Inception"),
    ).toBe(true);
  });

  it("rejects unrelated titles", () => {
    expect(titlesMatch("the matrix 1999", "Finding Nemo")).toBe(false);
  });

  it("rejects empty or single-character tokens", () => {
    expect(titlesMatch("", "Inception")).toBe(false);
    expect(titlesMatch("a b", "c d")).toBe(false);
  });
});

describe("MetadataService", () => {
  it("falls back to OMDB when the TMDB request fails", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (String(input).includes("themoviedb.org")) {
        return new Response("boom", { status: 500 });
      }
      return Response.json({
        Response: "True",
        Title: "Inception",
        Year: "2010",
        imdbRating: "8.8",
        Genre: "Action, Sci-Fi",
        Runtime: "148 min",
        Plot: "A thief who steals corporate secrets...",
        Language: "English",
        Country: "USA",
        Poster: "https://img.example/poster.jpg",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new MetadataService(
      createConfig({ tmdbApiKey: "tmdb", omdbApiKey: "omdb" }),
    );
    const enriched = await service.enrich([result("Inception 2010 1080p")], INTENT);

    expect(enriched[0]?.metadata?.title).toBe("Inception");
    expect(enriched[0]?.metadata?.rating).toBe(8.8);
  });

  it("rejects a TMDB hit whose title is unrelated and does not trust results[0]", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (String(input).includes("themoviedb.org")) {
        return Response.json({
          results: [
            { title: "Finding Nemo", release_date: "2003-05-30", vote_average: 7.8 },
          ],
        });
      }
      return new Response("nope", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new MetadataService(
      createConfig({ tmdbApiKey: "tmdb", omdbApiKey: "omdb" }),
    );
    const enriched = await service.enrich([result("Inception 2010 1080p")], INTENT);

    expect(enriched[0]?.metadata).toBeUndefined();
  });

  it("uses the best similar TMDB candidate, not just the first", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (String(input).includes("themoviedb.org")) {
        return Response.json({
          results: [
            { title: "Finding Nemo", release_date: "2003-05-30" },
            { title: "Inception", release_date: "2010-07-16", vote_average: 8.4 },
          ],
        });
      }
      return new Response("nope", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new MetadataService(createConfig({ tmdbApiKey: "tmdb" }));
    const enriched = await service.enrich([result("Inception 2010 1080p")], INTENT);

    expect(enriched[0]?.metadata?.title).toBe("Inception");
    expect(enriched[0]?.metadata?.year).toBe(2010);
  });

  it("caches lookups within a session", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (String(input).includes("themoviedb.org")) {
        return Response.json({
          results: [{ title: "Inception", release_date: "2010-07-16" }],
        });
      }
      return new Response("nope", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new MetadataService(createConfig({ tmdbApiKey: "tmdb" }));
    await service.enrich([result("Inception 2010 1080p")], INTENT);
    const callsAfterFirst = fetchMock.mock.calls.length;

    await service.enrich([result("Inception 2010 1080p")], INTENT);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("counts enrichment failures for UI surfacing", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = new MetadataService(createConfig({ tmdbApiKey: "tmdb" }));
    await service.enrich([result("Inception 2010 1080p")], INTENT);

    // TMDB fails and no OMDB key → lookup throws → counted as a failure.
    expect(service.enrichmentFailures).toBe(1);
  });
});
