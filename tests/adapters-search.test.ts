import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BitsearchAdapter } from "../src/sources/bitsearch.js";
import { EztvAdapter } from "../src/sources/eztv.js";
import { FitGirlAdapter } from "../src/sources/fitgirl.js";
import { FmhyAdapter } from "../src/sources/fmhy.js";
import { LimeTorrentsAdapter } from "../src/sources/limetorrents.js";
import { NyaaAdapter } from "../src/sources/nyaa.js";
import { PirateBayAdapter } from "../src/sources/piratebay.js";
import { SubsPleaseAdapter } from "../src/sources/subsplease.js";
import { TorrentGalaxyAdapter } from "../src/sources/torrentgalaxy.js";
import { YtsAdapter } from "../src/sources/yts.js";
import { CacheService } from "../src/services/cache-service.js";
import type { HttpClient } from "../src/services/http-client.js";
import type { SearchRequest, SourceAdapter } from "../src/types/search.js";

/**
 * Adapter search() coverage with a stub HttpClient: exercises URL building,
 * mapping and the top-listing branches without touching the network.
 */

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query: "test",
    intent: {
      query: "test",
      preferredSources: [],
      terms: ["test"],
    },
    filters: {},
    limit: 10,
    ...overrides,
  };
}

function stubHttp(handlers: {
  json?: (url: string) => unknown;
  text?: (url: string) => string;
}): HttpClient {
  return {
    json: async (url: string) => (handlers.json ? handlers.json(url) : {}),
    text: async (url: string) => (handlers.text ? handlers.text(url) : "<html></html>"),
  } as unknown as HttpClient;
}

const YTS_PAYLOAD = {
  data: {
    movies: [
      {
        id: 1,
        title_long: "Test Movie (2026)",
        year: 2026,
        url: "https://yts.gg/movies/test-movie",
        torrents: [
          {
            hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            quality: "1080p",
            type: "web",
            seeds: 42,
            peers: 3,
            size_bytes: 2_000_000_000,
            date_uploaded: new Date().toISOString(),
          },
        ],
      },
    ],
  },
};

const EZTV_PAYLOAD = {
  torrents: [
    {
      id: 1,
      hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      filename: "Test.Show.S01E01.1080p",
      torrent_url: "https://eztv.tf/torrents/1.torrent",
      magnet_url: "magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      title: "Test Show S01E01",
      seeds: 77,
      peers: 4,
      size_bytes: "900000000",
      date_released_unix: Math.floor(Date.now() / 1000),
    },
  ],
};

const NYAA_XML = `<?xml version="1.0"?><rss><channel><item>
  <title>Test Anime 1080p</title>
  <link>https://nyaa.si/download/1.torrent</link>
  <guid>https://nyaa.si/view/1</guid>
  <pubDate>${new Date().toUTCString()}</pubDate>
  <nyaa:seeders>88</nyaa:seeders>
  <nyaa:leechers>2</nyaa:leechers>
  <nyaa:size>1.4 GiB</nyaa:size>
  <nyaa:infoHash>cccccccccccccccccccccccccccccccccccccccc</nyaa:infoHash>
  <nyaa:trusted>Yes</nyaa:trusted>
</item></channel></rss>`;

const SUBSPLEASE_PAYLOAD = {
  "Test Show - 01": {
    show: "Test Show",
    episode: "01",
    release_date: new Date().toISOString(),
    downloads: [
      { res: "1080", magnet: "magnet:?xt=urn:btih:dddddddddddddddddddddddddddddddddddddddd&xl=500" },
    ],
  },
};

const FITGIRL_XML = `<rss><channel><item>
  <title>Test Game Repack</title>
  <link>https://fitgirl-repacks.site/test-game/</link>
  <pubDate>${new Date().toUTCString()}</pubDate>
  <description><![CDATA[<a href="magnet:?xt=urn:btih:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee">magnet</a>]]></description>
</item></channel></rss>`;

const PIRATEBAY_PAYLOAD = [
  {
    id: "5",
    name: "Test Ubuntu",
    info_hash: "ffffffffffffffffffffffffffffffffffffffff",
    leechers: "2",
    seeders: "300",
    num_files: "1",
    size: "1500000000",
    username: "u",
    added: String(Math.floor(Date.now() / 1000)),
    status: "trusted",
    category: "100",
  },
];

const SOLID_PAYLOAD = {
  results: [
    {
      id: "abc",
      infohash: "1111111111111111111111111111111111111111",
      title: "Test Linux ISO",
      size: 1_000_000,
      category: 1,
      seeders: 9,
      leechers: 1,
      downloads: 3,
      verified: true,
      updatedAt: new Date().toISOString(),
    },
  ],
};

const TGX_LISTING = `<html><body>
  <div class="tgxtablerow txlight">
    <div class="tgxtablecell clickable-row click textshadow rounded txlight" id="click"
      data-href="/post-detail/aa11/test-item/">
      <div><a class="txlight" title="Test Item" href="/post-detail/aa11/test-item/">
        <span src="torrent"><b>Test Item</b></span></a></div>
    </div>
    <div class="tgxtablecell collapsehide rounded txlight" style="text-align:right;">
      <span class="badge badge-secondary txlight">2.5 GB</span>
    </div>
    <div class="tgxtablecell collapsehide rounded txlight">
      <span title="Seeders/Leechers">[<font color="green"><b>55</b></font>/<font color="#ff0000"><b>4</b></font> ]</span>
    </div>
    <div class="tgxtablecell collapsehide rounded txlight" style="text-align:right"> 3 days
    <div class="tgxtablecell bighide rounded txlight"></div>
  </div>
</body></html>`;

const TGX_DETAIL = `<html><body>
  <a href="magnet:?xt=urn:btih:9999999999999999999999999999999999999999&amp;dn=Test">magnet</a>
</body></html>`;

const LIME_HTML = `<html><body><table>
  <tr bgcolor="#EAEAEA">
    <td><div class="tt-name"><a href="https://itorrents.net/torrent/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB.torrent">dl</a> <a href="/test-item-torrent.html">Test Item</a></div></td>
    <td>1.5 GB</td>
    <td class="tdseed">321</td>
    <td class="tdleech">12</td>
  </tr>
</table></body></html>`;

const FMHY_MD = [
  "## Streaming",
  "* ⭐ **[Zqwx Unique Probe Site](https://zqwx.example/)** - Testing / [Info](https://info.test)",
].join("\n");

describe("adapter search() with stubbed HTTP", () => {
  it("yts searches and serves top", async () => {
    const urls: string[] = [];
    const adapter = new YtsAdapter(
      stubHttp({ json: (url) => (urls.push(url), YTS_PAYLOAD) }),
    );

    const found = await adapter.search(request());
    expect(found[0]?.title).toContain("Test Movie");
    expect(urls[0]).toContain("query_term=test");

    urls.length = 0;
    const top = await adapter.search(request({ top: "today", query: "" }));
    expect(top[0]?.seeders).toBe(42);
    expect(urls[0]).toContain("sort_by=seeds");
  });

  it("eztv searches with query filter and serves top", async () => {
    const adapter = new EztvAdapter(stubHttp({ json: () => EZTV_PAYLOAD }));

    const found = await adapter.search(request({ query: "test show", intent: { query: "test show", preferredSources: [], terms: ["test", "show"] } }));
    expect(found[0]?.title).toContain("Test.Show");
    expect(await adapter.search(request({ query: "nope", intent: { query: "nope", preferredSources: [], terms: ["nope"] } }))).toEqual([]);

    const top = await adapter.search(request({ top: "week", query: "" }));
    expect(top[0]?.seeders).toBe(77);
  });

  it("nyaa searches and serves category-scoped top", async () => {
    const urls: string[] = [];
    const adapter = new NyaaAdapter(stubHttp({ text: (url) => (urls.push(url), NYAA_XML) }));

    const found = await adapter.search(request());
    expect(found[0]?.title).toContain("Test Anime");

    urls.length = 0;
    const top = await adapter.search(request({ top: "today", query: "", intent: { query: "", preferredSources: [], terms: [], mediaType: "anime" } }));
    expect(top[0]?.seeders).toBe(88);
    expect(urls[0]).toContain("s=seeders");
    expect(urls[0]).toContain("c=1_2");
  });

  it("subsplease searches and serves the latest feed for top", async () => {
    const urls: string[] = [];
    const adapter = new SubsPleaseAdapter(stubHttp({ json: (url) => (urls.push(url), SUBSPLEASE_PAYLOAD) }));

    const found = await adapter.search(request({ intent: { query: "test", preferredSources: [], terms: ["test"], mediaType: "anime" } }));
    expect(found[0]?.title).toBe("Test Show - 01");

    urls.length = 0;
    const top = await adapter.search(request({ top: "week", query: "", intent: { query: "", preferredSources: [], terms: [], mediaType: "anime" } }));
    expect(top).toHaveLength(1);
    expect(urls[0]).toContain("f=latest");
    expect(urls[0]).toContain("h=168");
  });

  it("fitgirl searches and serves top from the main feed", async () => {
    const urls: string[] = [];
    const adapter = new FitGirlAdapter(stubHttp({ text: (url) => (urls.push(url), FITGIRL_XML) }));

    const found = await adapter.search(request({ intent: { query: "test", preferredSources: [], terms: ["test"], mediaType: "game" } }));
    expect(found[0]?.title).toBe("Test Game Repack");

    urls.length = 0;
    const top = await adapter.search(request({ top: "today", query: "", intent: { query: "", preferredSources: [], terms: [], mediaType: "game" } }));
    expect(top[0]?.magnetUri).toContain("eeee");
    expect(urls[0]).toContain("/feed/");
  });

  it("piratebay maps api results", async () => {
    const adapter = new PirateBayAdapter(stubHttp({ json: () => PIRATEBAY_PAYLOAD }));
    const found = await adapter.search(request());
    expect(found[0]).toMatchObject({ title: "Test Ubuntu", seeders: 300, trusted: true });
    expect(await adapter.search(request({ top: "today", query: "" }))).toEqual([]);
  });

  it("bitsearch maps api results and skips top", async () => {
    const bitsearch = new BitsearchAdapter(stubHttp({ json: () => SOLID_PAYLOAD }));
    const found2 = await bitsearch.search(request());
    expect(found2[0]).toMatchObject({ title: "Test Linux ISO", seeders: 9 });
    expect(await bitsearch.search(request({ top: "week", query: "" }))).toEqual([]);
  });

  it("limetorrents maps rows and skips top", async () => {
    const adapter = new LimeTorrentsAdapter(stubHttp({ text: () => LIME_HTML }));
    const found = await adapter.search(request());
    expect(found[0]).toMatchObject({ title: "Test Item", seeders: 321 });
    expect(await adapter.search(request({ top: "week", query: "" }))).toEqual([]);
  });

  it("torrentgalaxy searches via post-details and serves time-filtered top", async () => {
    const urls: string[] = [];
    const adapter = new TorrentGalaxyAdapter(
      stubHttp({
        text: (url) => {
          urls.push(url);
          return url.includes("/post-detail/") ? TGX_DETAIL : TGX_LISTING;
        },
      }),
    );

    const found = await adapter.search(request());
    expect(found[0]).toMatchObject({ title: "Test Item", seeders: 55 });
    expect(found[0]?.magnetUri).toContain("99999999");
    expect(urls.some((u) => u.includes("/get-posts/keywords:test"))).toBe(true);

    urls.length = 0;
    const top = await adapter.search(
      request({ top: "today", query: "", intent: { query: "", preferredSources: [], terms: [], mediaType: "movie" } }),
    );
    expect(top[0]?.seeders).toBe(55);
    expect(urls[0]).toContain("/get-posts/category:Movies:time:1D");
  });

  it("fmhy serves fallback links and skips top", async () => {
    // Isolated cache: the default cache lives on disk and would leak entries
    // from previous real runs into this test.
    const cacheDir = await mkdtemp(join(tmpdir(), "fmhy-cache-"));
    const adapter = new FmhyAdapter(
      stubHttp({ text: () => FMHY_MD }),
      new CacheService(60_000, cacheDir),
    );
    const found = await adapter.search(request({ query: "zqwx unique probe" }));
    expect(found[0]?.title).toContain("Zqwx Unique Probe Site");
    expect(await adapter.search(request({ top: "week", query: "" }))).toEqual([]);
  });

  it("media-type guards return empty for mismatched intents", async () => {
    const eztv = new EztvAdapter(stubHttp({ json: () => EZTV_PAYLOAD }));
    expect(
      await eztv.search(request({ intent: { query: "test", preferredSources: [], terms: ["test"], mediaType: "game" } })),
    ).toEqual([]);

    const yts = new YtsAdapter(stubHttp({ json: () => YTS_PAYLOAD }));
    expect(
      await yts.search(request({ intent: { query: "test", preferredSources: [], terms: ["test"], mediaType: "tv" } })),
    ).toEqual([]);
  });

  it("every adapter declares its top capability consistently", () => {
    const supports = (a: SourceAdapter) => a.supportsTop === true;
    expect(supports(new YtsAdapter(stubHttp({})))).toBe(true);
    expect(supports(new NyaaAdapter(stubHttp({})))).toBe(true);
    expect(supports(new SubsPleaseAdapter(stubHttp({})))).toBe(true);
    expect(supports(new EztvAdapter(stubHttp({})))).toBe(true);
    expect(supports(new FitGirlAdapter(stubHttp({})))).toBe(true);
    expect(supports(new TorrentGalaxyAdapter(stubHttp({})))).toBe(true);
    expect(supports(new PirateBayAdapter(stubHttp({})))).toBe(false);
    expect(supports(new FmhyAdapter(stubHttp({})))).toBe(false);
    expect(supports(new LimeTorrentsAdapter(stubHttp({})))).toBe(false);
  });
});

describe("top period sorting across adapters", () => {
  it("keeps only in-period results and orders by seeders", async () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    const payload = {
      data: {
        movies: [
          { ...(YTS_PAYLOAD.data.movies[0]!), torrents: [{ ...YTS_PAYLOAD.data.movies[0]!.torrents[0]!, seeds: 999, date_uploaded: oldDate }] },
          { ...YTS_PAYLOAD.data.movies[0]!, id: 2, title_long: "Fresh (2026)", torrents: [{ ...YTS_PAYLOAD.data.movies[0]!.torrents[0]!, seeds: 5 }] },
        ],
      },
    };
    const adapter = new YtsAdapter(stubHttp({ json: () => payload }));
    const top = await adapter.search(request({ top: "week", query: "" }));
    expect(top).toHaveLength(1);
    expect(top[0]?.title).toContain("Fresh");
  });
});
