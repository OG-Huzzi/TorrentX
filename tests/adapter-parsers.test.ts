import { describe, expect, it } from "vitest";
import { mapBitsearchResults } from "../src/sources/bitsearch.js";
import { mapEztvResults } from "../src/sources/eztv.js";
import { parseFitgirlResults } from "../src/sources/fitgirl.js";
import { LimeTorrentsAdapter } from "../src/sources/limetorrents.js";
import { parseNyaaResults } from "../src/sources/nyaa.js";
import { mapPirateBayResults } from "../src/sources/piratebay.js";
import { mapSubsPleaseResults } from "../src/sources/subsplease.js";
import {
  approxIsoFromAge,
  parseTgxLegacyListing,
  parseTgxListing,
} from "../src/sources/torrentgalaxy.js";
import { mapYtsResults } from "../src/sources/yts.js";
import type { HttpClient } from "../src/services/http-client.js";

const fakeHttp = {} as HttpClient;

describe("torrentgalaxy legacy parser", () => {
  const HTML = `<html><body>
    <div class="tgxtablerow txlight">
      <a href="/torrent/111/some-movie-2024" title="Some Movie 2024">Some Movie 2024</a>
      <a href="magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&amp;dn=Some">M</a>
      <font color="green">123</font>
      <font color="red">45</font>
      <span>2.5 GB</span>
    </div>
    <div class="tgxtablerow txlight">
      <a href="/torrent/222/other-show" title="Other Show">Other Show</a>
      <a href="magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&amp;dn=Other">M</a>
      <font color="green">7</font>
      <font color="red">1</font>
      <span>800 MB</span>
    </div>
  </body></html>`;

  it("extracts titles, magnets, peers and sizes", () => {
    const rows = parseTgxLegacyListing(HTML);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: "Some Movie 2024",
      seeders: 123,
      leechers: 45,
      sizeBytes: 2_500_000_000,
    });
    expect(rows[0]?.magnetUri).toContain("urn:btih:aaaaaaaa");
    expect(rows[0]?.magnetUri).not.toContain("&amp;");
    expect(rows[1]?.seeders).toBe(7);
  });

  it("returns nothing when the page has no result rows", () => {
    expect(parseTgxLegacyListing("<html>captcha</html>")).toEqual([]);
  });
});

describe("torrentgalaxy current-era parser", () => {
  // Trimmed from a real /get-posts/ response (2026 layout: title attr on the
  // post-detail link, [green/red] peer badge, relative age cell).
  const HTML = `<html><body>
    <div class="tgxtablerow txlight">
      <div class="tgxtablecell shrink rounded txlight">
        <a href="/get-posts/category:Other:time:10D"><small>Other</small></a>
      </div>
      <div class="tgxtablecell collapsehide rounded txlight">
        <i class="fas fa-check" style="color:green" title="Verified by TGx"></i>
      </div>
      <div class="tgxtablecell clickable-row click textshadow rounded txlight" id="click"
        data-href="/post-detail/810de9/ubuntu-linux-bible-11e-by-david-clinton-epub-nonfiction/">
        <div><a class="txlight" title="Ubuntu Linux Bible 11E by David Clinton epub Nonfiction"
          href="/post-detail/810de9/ubuntu-linux-bible-11e-by-david-clinton-epub-nonfiction/">
          <span src="torrent"><b>Ubuntu Linux Bible 11E by David Clinton epub Nonfiction</b></span></a></div>
      </div>
      <div class="tgxtablecell collapsehide rounded txlight">
        <a class="username" href="/get-posts/user:Bilbo76/"><span class="username trusted-uploader txlight">Bilbo76</span></a>
      </div>
      <div class="tgxtablecell collapsehide rounded txlight" style="text-align:right;">
        <span class="badge badge-secondary txlight" style="border-radius:4px;">8.1 MB</span>
      </div>
      <div class="tgxtablecell collapsehide rounded txlight">
        <span class="badge badge-warning" title="Views"> <font color="orange"><b>1</b></font> </span>
      </div>
      <div class="tgxtablecell collapsehide rounded txlight">
        <span title="Seeders/Leechers">[<font color="green"><b>149</b></font>/<font color="#ff0000"><b>3</b></font> ]</span>
      </div>
      <div class="tgxtablecell collapsehide rounded txlight" style="text-align:right"> 10 months
      <div class="tgxtablecell bighide rounded txlight">
      </div>
    </div>
    <div class="tgxtablerow txlight">
      <div class="tgxtablecell clickable-row click textshadow rounded txlight" id="click"
        data-href="/post-detail/92f1ac/other-show-s01/">
        <div><a class="txlight" title="Other Show S01 720p"
          href="/post-detail/92f1ac/other-show-s01/"><span src="torrent"><b>Other Show S01 720p</b></span></a></div>
      </div>
      <div class="tgxtablecell collapsehide rounded txlight" style="text-align:right;">
        <span class="badge badge-secondary txlight" style="border-radius:4px;">2.5 GB</span>
      </div>
      <div class="tgxtablecell collapsehide rounded txlight">
        <span title="Seeders/Leechers">[<font color="green"><b>7</b></font>/<font color="#ff0000"><b>1</b></font> ]</span>
      </div>
      <div class="tgxtablecell collapsehide rounded txlight" style="text-align:right"> 3 days
      <div class="tgxtablecell bighide rounded txlight"></div>
    </div>
  </body></html>`;

  it("extracts titles, post-detail links, peers, sizes and age", () => {
    const rows = parseTgxListing(HTML);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: "Ubuntu Linux Bible 11E by David Clinton epub Nonfiction",
      detailPath: "/post-detail/810de9/ubuntu-linux-bible-11e-by-david-clinton-epub-nonfiction/",
      seeders: 149,
      leechers: 3,
      sizeBytes: 8_100_000,
      trusted: true,
    });
    expect(rows[0]?.ageText).toContain("10 months");
    expect(rows[1]).toMatchObject({
      title: "Other Show S01 720p",
      seeders: 7,
      leechers: 1,
      sizeBytes: 2_500_000_000,
      trusted: false,
    });
  });

  it("approximates timestamps from relative ages", () => {
    const threeDays = approxIsoFromAge("3 days")!;
    expect(Date.now() - Date.parse(threeDays)).toBeGreaterThan(2.5 * 86_400_000);
    expect(Date.now() - Date.parse(threeDays)).toBeLessThan(3.5 * 86_400_000);
    expect(approxIsoFromAge("10 months")).toBeDefined();
    expect(approxIsoFromAge("soon")).toBeUndefined();
  });

  it("returns nothing for non-listing pages", () => {
    expect(parseTgxListing("<html><title>tgx.rs</title></html>")).toEqual([]);
  });
});

describe("limetorrents parser", () => {
  const HTML = `<html><body>
    <table>
      <tr bgcolor="#EAEAEA">
        <td><div class="tt-name"><a href="https://itorrents.net/torrent/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.torrent">dl</a> <a href="/some-movie-torrent.html">Some Movie</a></div></td>
        <td>1.5 GB</td>
        <td class="tdseed">321</td>
        <td class="tdleech">12</td>
      </tr>
      <tr bgcolor="#EAEAEA">
        <td><div class="tt-name"><a href="/ads.html">Buy stuff now!</a></div></td>
        <td>1 KB</td>
      </tr>
    </table>
  </body></html>`;

  it("extracts real rows and skips ad rows without itorrents links", () => {
    const results = new LimeTorrentsAdapter(fakeHttp).parseResults(HTML, "www.limetorrents.lol", 10);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Some Movie",
      seeders: 321,
      leechers: 12,
      sizeBytes: 1_500_000_000,
    });
    expect(results[0]?.magnetUri?.toLowerCase()).toContain("urn:btih:aaaa");
    expect(results[0]?.detailsUrl).toBe("https://www.limetorrents.lol/some-movie-torrent.html");
  });
});

describe("yts mapper", () => {
  it("flattens movies into one result per torrent", () => {
    const results = mapYtsResults({
      data: {
        movies: [
          {
            id: 42,
            title_long: "Some Movie (2024)",
            year: 2024,
            language: "english",
            url: "https://yts.mx/movies/some-movie-2024",
            torrents: [
              { hash: "cccccccccccccccccccccccccccccccccccccccc", quality: "1080p", type: "web", seeds: 300, peers: 20, size_bytes: 2_000_000_000, date_uploaded: "2024-05-01 12:00:00" },
              { hash: "dddddddddddddddddddddddddddddddddddddddd", quality: "720p", type: "web", seeds: 90, peers: 5, size_bytes: 1_000_000_000, date_uploaded: "2024-05-01 12:00:00" },
            ],
          },
        ],
      },
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: "Some Movie (2024) 1080p web",
      seeders: 300,
      quality: "1080p",
      language: "english",
      mediaType: "movie",
    });
    expect(results[0]?.magnetUri).toContain("cccccccc");
  });

  it("handles an empty payload", () => {
    expect(mapYtsResults({})).toEqual([]);
    expect(mapYtsResults({ data: { movies: [] } })).toEqual([]);
  });
});

describe("eztv mapper", () => {
  const payload = {
    torrents: [
      { id: 1, hash: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", filename: "Show.S01E01.720p", torrent_url: "https://eztv.re/torrents/1.torrent", magnet_url: "magnet:?xt=urn:btih:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", title: "Show S01E01", seeds: 50, peers: 3, size_bytes: "500000000", date_released_unix: 1700000000 },
      { id: 2, hash: "ffffffffffffffffffffffffffffffffffffffff", filename: "Unrelated.S02E01.720p", torrent_url: "https://eztv.re/torrents/2.torrent", magnet_url: "magnet:?xt=urn:btih:ffffffffffffffffffffffffffffffffffffffff", title: "Unrelated Show S02E01", seeds: 9, peers: 1, size_bytes: "600000000", date_released_unix: 0 },
    ],
  };

  it("filters by query words and maps fields", () => {
    const results = mapEztvResults(payload, ["show", "s01e01"], 10);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ title: "Show.S01E01.720p", seeders: 50, mediaType: "tv" });
    expect(results[0]?.uploadedAt).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it("omits bogus epoch-0 dates instead of emitting 1970", () => {
    const results = mapEztvResults(payload, ["unrelated"], 10);
    expect(results[0]?.uploadedAt).toBeUndefined();
  });
});

describe("bitsearch mapper", () => {
  const payload = {
    results: [
      { id: "abc", infohash: "1111111111111111111111111111111111111111", title: "Some Linux ISO", size: 2_500_000_000, category: 1, seeders: 200, leechers: 10, downloads: 5, verified: true, updatedAt: "2024-05-01T12:00:00Z" },
    ],
  };

  it("maps results with magnets and dates", () => {
    const results = mapBitsearchResults(payload, "bitsearch.eu", 10);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Some Linux ISO",
      seeders: 200,
      trusted: true,
      sizeBytes: 2_500_000_000,
    });
    expect(results[0]?.magnetUri).toContain("11111111");
    expect(results[0]?.uploadedAt).toBe(new Date("2024-05-01T12:00:00Z").toISOString());
  });

  it("maps bitsearch results and ignores malformed dates", () => {
    const results = mapBitsearchResults(
      { results: [{ ...payload.results[0]!, updatedAt: "not-a-date" }] },
      "bitsearch.to",
      10,
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.uploadedAt).toBeUndefined();
    expect(results[0]?.detailsUrl).toBe("https://bitsearch.to/view/abc");
  });
});

describe("piratebay mapper", () => {
  it("maps apibay items and parses trusted status", () => {
    const results = mapPirateBayResults(
      [
        {
          id: "123",
          name: "Some Movie 2024",
          info_hash: "2222222222222222222222222222222222222222",
          leechers: "4",
          seeders: "500",
          num_files: "1",
          size: "1500000000",
          username: "uploader",
          added: "1700000000",
          status: "trusted",
          category: "100",
        },
        {
          id: "456",
          name: "Other",
          info_hash: "3333333333333333333333333333333333333333",
          leechers: "1",
          seeders: "2",
          num_files: "1",
          size: "100",
          username: "anon",
          added: "0",
          status: "member",
          category: "100",
        },
      ],
      10,
      "global",
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ title: "Some Movie 2024", seeders: 500, trusted: true, region: "global" });
    expect(results[0]?.uploadedAt).toBe(new Date(1700000000 * 1000).toISOString());
    expect(results[1]).toMatchObject({ trusted: false });
    expect(results[1]?.uploadedAt).toBeUndefined();
  });
});

describe("nyaa parser", () => {
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <item>
        <title>Some Anime 1080p</title>
        <link>https://nyaa.si/download/1.torrent</link>
        <guid>https://nyaa.si/view/1</guid>
        <pubDate>Mon, 15 Jan 2024 10:30:00 +0000</pubDate>
        <nyaa:seeders>42</nyaa:seeders>
        <nyaa:leechers>3</nyaa:leechers>
        <nyaa:size>1.4 GiB</nyaa:size>
        <nyaa:infoHash>abcdef0123456789abcdef0123456789abcdef01</nyaa:infoHash>
        <nyaa:trusted>Yes</nyaa:trusted>
      </item>
    </channel>
  </rss>`;

  it("parses RSS items with nyaa namespaced fields", () => {
    const results = parseNyaaResults(XML, 10);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Some Anime 1080p",
      seeders: 42,
      leechers: 3,
      trusted: true,
      mediaType: "anime",
      region: "japan",
    });
    expect(results[0]?.magnetUri).toContain("abcdef0123456789");
    expect(results[0]?.sizeBytes).toBe(Math.round(1.4 * 1073741824));
    expect(results[0]?.uploadedAt).toBe(new Date("Mon, 15 Jan 2024 10:30:00 +0000").toISOString());
  });

  it("handles an empty channel", () => {
    expect(parseNyaaResults("<rss><channel></channel></rss>", 10)).toEqual([]);
  });
});

describe("fitgirl parser", () => {
  const XML = `<rss><channel>
    <item>
      <title>Some Game Repack</title>
      <link>https://fitgirl-repacks.site/some-game/</link>
      <pubDate>Wed, 10 Apr 2024 08:00:00 +0000</pubDate>
      <description><![CDATA[<a href="magnet:?xt=urn:btih:4444444444444444444444444444444444444444&amp;dn=Some">magnet</a>]]></description>
    </item>
    <item>
      <title>Updates Digest April 2024</title>
      <link>https://fitgirl-repacks.site/updates-digest/</link>
      <pubDate>Wed, 10 Apr 2024 08:00:00 +0000</pubDate>
      <description>no magnet here</description>
    </item>
    <item>
      <title>Game &amp; DLC Repack</title>
      <link>https://fitgirl-repacks.site/game-dlc/</link>
      <pubDate>not a date</pubDate>
      <description><a href="magnet:?xt=urn:btih:5555555555555555555555555555555555555555">magnet</a></description>
    </item>
  </channel></rss>`;

  it("extracts game items and skips digest posts without magnets", () => {
    const results = parseFitgirlResults(XML, 10);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ title: "Some Game Repack", mediaType: "game", trusted: true });
    expect(results[0]?.magnetUri).toContain("44444444");
    expect(results[0]?.uploadedAt).toBe(new Date("Wed, 10 Apr 2024 08:00:00 +0000").toISOString());
    expect(results[1]?.title).toBe("Game & DLC Repack");
    expect(results[1]?.uploadedAt).toBeUndefined();
  });
});

describe("subsplease mapper", () => {
  it("prefers 1080p downloads from subsplease entries", () => {
    const results = mapSubsPleaseResults(
      {
        "ep1": {
          show: "Great Show",
          episode: "01",
          release_date: "2024-05-01 12:00:00",
          downloads: [
            { res: "480", magnet: "magnet:?xt=urn:btih:6666666666666666666666666666666666666666&xl=100" },
            { res: "1080", magnet: "magnet:?xt=urn:btih:7777777777777777777777777777777777777777&xl=500" },
          ],
        },
      },
      10,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Great Show - 01",
      quality: "1080p",
      mediaType: "anime",
      language: "japanese",
    });
    expect(results[0]?.sizeBytes).toBe(500);
  });
});
