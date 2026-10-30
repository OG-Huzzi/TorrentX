import { describe, expect, it } from "vitest";
import { parseSocksProxyUrl } from "../src/services/proxy.js";

describe("parseSocksProxyUrl", () => {
  it("parses host and port with default socks port", () => {
    expect(parseSocksProxyUrl("socks5://127.0.0.1")).toEqual({
      hostname: "127.0.0.1",
      port: 1080,
    });
    expect(parseSocksProxyUrl("socks5h://tor.local:9050")).toEqual({
      hostname: "tor.local",
      port: 9050,
    });
  });

  it("parses authentication", () => {
    expect(parseSocksProxyUrl("socks5://user:pass@10.0.0.1:1080")).toEqual({
      hostname: "10.0.0.1",
      port: 1080,
      userId: "user",
      password: "pass",
    });
  });

  it("rejects invalid ports and URLs", () => {
    expect(() => parseSocksProxyUrl("socks5://host:99999")).toThrow(/Invalid proxy/);
    expect(() => parseSocksProxyUrl("not a url")).toThrow(/Invalid proxy/);
  });
});
