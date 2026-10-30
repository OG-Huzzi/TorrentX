import { describe, expect, it } from "vitest";
import { openCommand, openableUri } from "../src/services/magnet-actions.js";
import { infoHashFromMagnet } from "../src/utils/magnet.js";
import type { SearchResult } from "../src/types/search.js";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "r1",
    title: "Example",
    source: "test",
    seeders: 1,
    leechers: 0,
    trusted: true,
    sourceReliability: 0.9,
    score: 0,
    ...overrides,
  };
}

const HOSTILE_MAGNET =
  "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&dn=x&\\\\host\\share\\x.exe";

describe("openCommand", () => {
  it("never routes a URI through cmd.exe on Windows", () => {
    const [command, args] = openCommand(HOSTILE_MAGNET, "win32");
    expect(command).toBe("rundll32.exe");
    expect(args).toEqual(["url.dll,FileProtocolHandler", HOSTILE_MAGNET]);
  });

  it("passes the URI as a single argument everywhere else", () => {
    expect(openCommand(HOSTILE_MAGNET, "darwin")).toEqual(["open", [HOSTILE_MAGNET]]);
    expect(openCommand(HOSTILE_MAGNET, "linux", false)).toEqual(["xdg-open", [HOSTILE_MAGNET]]);
    expect(openCommand(HOSTILE_MAGNET, "linux", true)).toEqual([
      "termux-open-url",
      [HOSTILE_MAGNET],
    ]);
  });
});

describe("openableUri", () => {
  it("prefers the magnet and falls back to the details page", () => {
    expect(
      openableUri(result({ magnetUri: "magnet:?xt=urn:btih:abc", detailsUrl: "https://x.test" })),
    ).toContain("magnet:?xt=urn:btih:abc");
    expect(openableUri(result({ detailsUrl: "https://fmhy.example/page" }))).toBe(
      "https://fmhy.example/page",
    );
  });

  it("refuses links that are not magnet or web URLs", () => {
    expect(() => openableUri(result({ detailsUrl: "file:///etc/passwd" }))).toThrow(/non-web/);
    expect(() => openableUri(result({ torrentUrl: "smb://host/share/x.torrent" }))).toThrow(/non-web/);
    expect(() => openableUri(result())).toThrow(/no link/);
  });
});

describe("infoHashFromMagnet", () => {
  it("normalizes hex and base32 info hashes to lowercase hex", () => {
    const hex = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a";
    expect(infoHashFromMagnet(`magnet:?xt=urn:btih:${hex.toUpperCase()}&dn=x`)).toBe(hex);
    expect(infoHashFromMagnet("magnet:?xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK&dn=x")).toBe(hex);
    expect(infoHashFromMagnet("magnet:?dn=no-hash")).toBeUndefined();
    expect(infoHashFromMagnet(undefined)).toBeUndefined();
  });
});
