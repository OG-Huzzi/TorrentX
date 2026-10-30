import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
const systemLookupMock = vi.fn();

vi.mock("undici", async (importOriginal) => {
  const original = await importOriginal<typeof import("undici")>();
  return { ...original, fetch: (...args: unknown[]) => fetchMock(...args) };
});

vi.mock("node:dns", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:dns")>();
  return { ...original, lookup: (...args: unknown[]) => systemLookupMock(...args) };
});

const { createDohLookup } = await import("../src/services/dns-lookup.js");

function dohResponse(records: Array<{ type: number; data: string; ttl?: number }>) {
  return new Response(
    JSON.stringify({
      Status: 0,
      Answer: records.map((r) => ({ type: r.type, data: r.data, TTL: r.ttl ?? 300 })),
    }),
  );
}

function lookupAsync(
  lookup: ReturnType<typeof createDohLookup>,
  hostname: string,
  options?: { all?: boolean; family?: number },
): Promise<{ address: string; family: number }[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, options ?? {}, (err, address) => {
      if (err) return reject(err);
      const list = Array.isArray(address) ? address : [{ address: address as string, family: 4 }];
      resolve(list);
    });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  systemLookupMock.mockReset();
});

describe("createDohLookup", () => {
  it("resolves A/AAAA via the DoH JSON API", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      return url.includes("type=1")
        ? dohResponse([{ type: 1, data: "1.2.3.4" }])
        : dohResponse([{ type: 28, data: "2606:4700::1" }]);
    });

    const lookup = createDohLookup();
    const addresses = await lookupAsync(lookup, "example.com", { all: true });

    expect(addresses).toEqual([
      { address: "1.2.3.4", family: 4 },
      { address: "2606:4700::1", family: 6 },
    ]);
  });

  it("caches results and does not re-query within the TTL", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("type=1")
        ? dohResponse([{ type: 1, data: "9.9.9.9" }])
        : dohResponse([]),
    );

    const lookup = createDohLookup();
    await lookupAsync(lookup, "cached.example");
    await lookupAsync(lookup, "cached.example");
    await lookupAsync(lookup, "cached.example");

    // One A + one AAAA query total; repeat lookups hit the cache.
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it("filters by address family", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("type=1")
        ? dohResponse([{ type: 1, data: "1.2.3.4" }])
        : dohResponse([{ type: 28, data: "2606:4700::1" }]),
    );

    const lookup = createDohLookup();
    const v6only = await lookupAsync(lookup, "family.example", { all: true, family: 6 });
    expect(v6only).toEqual([{ address: "2606:4700::1", family: 6 }]);
  });

  it("fails without touching the hijackable system resolver", async () => {
    // On censored networks the system resolver answers with sinkhole
    // addresses; falling back to it would defeat the entire point of DoH.
    fetchMock.mockRejectedValue(new Error("DoH endpoints down"));

    const lookup = createDohLookup();
    await expect(lookupAsync(lookup, "fallback.example")).rejects.toThrow(
      /DNS-over-HTTPS failed/,
    );
    expect(systemLookupMock).not.toHaveBeenCalled();
  });

  it("falls back to the secondary DoH provider when the primary is down", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("cloudflare-dns.com")) {
        throw new Error("primary down");
      }
      // dns.google: JSON API with Status/Answer shape
      return url.includes("type=1")
        ? dohResponse([{ type: 1, data: "5.6.7.8" }])
        : dohResponse([]);
    });

    const lookup = createDohLookup();
    const addresses = await lookupAsync(lookup, "secondary.example");
    expect(addresses).toEqual([{ address: "5.6.7.8", family: 4 }]);
    expect(systemLookupMock).not.toHaveBeenCalled();
  });

  it("passes IP literals through to system lookup", async () => {
    systemLookupMock.mockImplementation(
      (_host: string, _opts: unknown, cb: (err: null, addrs: unknown) => void) =>
        cb(null, [{ address: "127.0.0.1", family: 4 }]),
    );

    const lookup = createDohLookup();
    const addresses = await lookupAsync(lookup, "127.0.0.1");
    expect(addresses[0]?.address).toBe("127.0.0.1");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
