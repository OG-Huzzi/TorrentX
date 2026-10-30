import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  detectCodec,
  detectLanguageFromTitle,
  detectMediaType,
  detectQuality,
  escapeRegExp,
  normalizeTitle,
  stripControlChars,
} from "../src/utils/text.js";

describe("detectQuality", () => {
  it("does not treat HDR as a resolution", () => {
    expect(detectQuality("Movie Name 4K HDR")).toBe("2160p");
    expect(detectQuality("Movie Name 1080p HDR")).toBe("1080p");
    expect(detectQuality("Movie Name HDR")).toBeUndefined();
  });

  it("normalizes common resolutions", () => {
    expect(detectQuality("Movie 4k")).toBe("2160p");
    expect(detectQuality("Movie UHD")).toBe("2160p");
    expect(detectQuality("Movie 1080p")).toBe("1080p");
    expect(detectQuality("Movie 1080i")).toBe("1080i");
    expect(detectQuality("Movie 720p")).toBe("720p");
    expect(detectQuality("Movie 480p")).toBe("480p");
  });

  it("returns undefined when no resolution is present", () => {
    expect(detectQuality("Movie Name")).toBeUndefined();
  });
});

describe("detectCodec", () => {
  it("detects common codecs case-insensitively", () => {
    expect(detectCodec("Movie x265")).toBe("X265");
    expect(detectCodec("Movie HEVC")).toBe("HEVC");
    expect(detectCodec("Movie AVC")).toBeUndefined();
  });
});

describe("detectMediaType", () => {
  it("detects anime from release-group naming", () => {
    expect(detectMediaType("[SubsPlease] Anime Episode 01")).toBe("anime");
  });
});

describe("normalizeTitle", () => {
  it("strips release noise for better deduplication", () => {
    expect(normalizeTitle("Movie.Name.2024.1080p.BluRay.x264-YTS")).toBe("movie name 2024");
  });
});

describe("stripControlChars", () => {
  it("removes terminal escape sequences and other control characters", () => {
    expect(stripControlChars("Movie\u001b]52;c;ZXZpbA==\u0007 1080p")).toBe("Movie ]52;c;ZXZpbA== 1080p");
    expect(stripControlChars("a\u009b31mb\tc\nd")).toBe("a 31mb c d");
    expect(stripControlChars("Ünïcödé — fine")).toBe("Ünïcödé — fine");
  });
});

describe("decodeEntities", () => {
  it("decodes named and numeric entities in one pass", () => {
    expect(decodeEntities("Tom &amp; Jerry &#8211; &quot;Best&quot; &#39;Of&#039;")).toBe(
      "Tom & Jerry – \"Best\" 'Of'",
    );
    expect(decodeEntities("magnet:?xt=urn:btih:abc&#038;dn=x&amp;tr=y")).toBe(
      "magnet:?xt=urn:btih:abc&dn=x&tr=y",
    );
    expect(decodeEntities("&#x41;&#66;")).toBe("AB");
    // Single pass: an escaped entity stays an entity.
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeEntities("&unknown; &#0;")).toBe("&unknown; &#0;");
  });
});

describe("escapeRegExp", () => {
  it("escapes every regex metacharacter", () => {
    const pattern = new RegExp(escapeRegExp("c++ (a|b).*"));
    expect(pattern.test("learn c++ (a|b).* today")).toBe(true);
  });
});

describe("detectLanguageFromTitle", () => {
  it("detects language tags", () => {
    expect(detectLanguageFromTitle("Movie 2024 Hindi 1080p")).toBe("hindi");
    expect(detectLanguageFromTitle("Show S01 Korean")).toBe("korean");
    expect(detectLanguageFromTitle("Plain Title")).toBeUndefined();
  });
});
