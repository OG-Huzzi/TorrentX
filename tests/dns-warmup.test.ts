import { describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:dns/promises")>();
  return { ...original, lookup: (...args: unknown[]) => lookupMock(...args) };
});

const { warmupDns, warmupDnsFast } = await import("../src/services/dns-warmup.js");

describe("dns-warmup", () => {
  it("warms every supplied host without throwing", () => {
    lookupMock.mockResolvedValue({ address: "1.2.3.4", family: 4 });
    warmupDns(["a.test", "b.test"]);
    warmupDnsFast(["c.test"]);

    expect(lookupMock.mock.calls.map((c) => c[0])).toEqual(["a.test", "b.test", "c.test"]);
  });

  it("swallows resolution failures (offline domains are fine)", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    expect(() => warmupDns(["missing.test"])).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("shouldWarmupDns", () => {
  it("only warms the system resolver when sources actually use it", async () => {
    const { shouldWarmupDns } = await import("../src/services/dns-warmup.js");
    expect(shouldWarmupDns({})).toBe(true);
    expect(shouldWarmupDns({ dnsResolver: "system" })).toBe(true);
    expect(shouldWarmupDns({ tor: true })).toBe(false);
    expect(shouldWarmupDns({ socks5Proxy: "socks5h://127.0.0.1:9050" })).toBe(false);
    expect(shouldWarmupDns({ httpProxy: "http://127.0.0.1:8080" })).toBe(false);
    expect(shouldWarmupDns({ sourceProxyUrl: "https://proxy.example/?url={url}" })).toBe(false);
    expect(shouldWarmupDns({ dnsResolver: "doh" })).toBe(false);
  });
});
