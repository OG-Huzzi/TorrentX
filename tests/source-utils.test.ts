import { describe, expect, it } from "vitest";
import { createResult, peerCount, raceMirrors, safeIsoDate } from "../src/sources/source-utils.js";

describe("raceMirrors", () => {
  it("starts a fallback before a stalled primary request can exhaust the source timeout", async () => {
    const attempts: string[] = [];
    const result = await raceMirrors(
      ["stalled", "healthy"],
      async (domain, signal) => {
        attempts.push(domain);
        if (domain === "stalled") return waitUntilAborted(signal);
        return "healthy result";
      },
      undefined,
      { staggerMs: 1 },
    );

    expect(result).toBe("healthy result");
    expect(attempts).toEqual(["stalled", "healthy"]);
  });

  it("honors cancellation from the parent source request", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      raceMirrors(["one"], async () => "unreachable", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects an empty result and keeps racing until a non-empty mirror answers", async () => {
    const attempts: string[] = [];
    const result = await raceMirrors(
      ["blank", "healthy"],
      async (domain) => {
        attempts.push(domain);
        if (domain === "blank") return [] as string[];
        return ["real", "results"] as string[];
      },
      undefined,
      { staggerMs: 1, isEmpty: (r) => r.length === 0 },
    );

    expect(result).toEqual(["real", "results"]);
    expect(attempts).toEqual(["blank", "healthy"]);
  });

  it("returns the empty result when every mirror parses to nothing", async () => {
    const result = await raceMirrors(
      ["a", "b"],
      async () => [] as number[],
      undefined,
      { staggerMs: 1, isEmpty: (r) => r.length === 0 },
    );

    expect(result).toEqual([]);
  });

  it("accepts an empty result after the grace period when another mirror hangs", async () => {
    const startedAt = Date.now();
    const result = await raceMirrors(
      ["blank", "blackholed"],
      async (domain, signal) => {
        if (domain === "blank") return [] as string[];
        return waitUntilAborted(signal);
      },
      undefined,
      { staggerMs: 1, emptyGraceMs: 30, isEmpty: (r) => r.length === 0 },
    );

    expect(result).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("prefers a non-empty mirror that answers within the grace period", async () => {
    const result = await raceMirrors(
      ["blank", "slow"],
      async (domain) => {
        if (domain === "blank") return [] as string[];
        await new Promise((resolve) => setTimeout(resolve, 20));
        return ["late", "hit"];
      },
      undefined,
      { staggerMs: 1, emptyGraceMs: 500, isEmpty: (r) => r.length === 0 },
    );

    expect(result).toEqual(["late", "hit"]);
  });

  it("returns a real empty answer even when other mirrors are dead", async () => {
    const result = await raceMirrors(
      ["dead-domain", "healthy-but-no-matches"],
      async (domain) => {
        if (domain === "dead-domain") throw new TypeError("fetch failed");
        return [] as string[];
      },
      undefined,
      { staggerMs: 1, isEmpty: (r) => r.length === 0 },
    );

    expect(result).toEqual([]);
  });

  it("still surfaces real errors when a mirror fails outright", async () => {
    await expect(
      raceMirrors(
        ["broken"],
        async () => {
          throw new Error("boom");
        },
        undefined,
        { staggerMs: 1, isEmpty: (r: string[]) => r.length === 0 },
      ),
    ).rejects.toThrow("boom");
  });
});

function waitUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("The operation was aborted", "AbortError")),
      { once: true },
    );
  });
}

describe("safeIsoDate", () => {
  it("parses valid timestamps into ISO format", () => {
    expect(safeIsoDate("2024-01-15T10:30:00Z")).toBe("2024-01-15T10:30:00.000Z");
    expect(safeIsoDate(1705300200000)).toBe(new Date(1705300200000).toISOString());
  });

  it("returns undefined for malformed dates instead of throwing", () => {
    expect(safeIsoDate("not-a-date")).toBeUndefined();
    expect(safeIsoDate("")).toBeUndefined();
    expect(safeIsoDate(undefined)).toBeUndefined();
    expect(safeIsoDate("0000-00-00")).toBeUndefined();
  });
});

describe("createResult", () => {
  it("strips terminal control sequences from scraped titles", () => {
    const result = createResult({
      title: "Movie\u001b[2J\u001b]0;pwned\u0007 1080p",
      source: "test",
      sourceReliability: 0.5,
    });
    expect(result.title).toBe("Movie [2J ]0;pwned 1080p");
  });
});

describe("peerCount", () => {
  it("undoes 32-bit wraparound and rejects impossible counts", () => {
    expect(peerCount(4294967317)).toBe(21);
    expect(peerCount(4294967231)).toBe(0); // wraps to a negative count
    expect(peerCount(1495)).toBe(1495);
    expect(peerCount(-3)).toBe(0);
    expect(peerCount(Number.NaN)).toBe(0);
    expect(peerCount(undefined)).toBe(0);
  });
});
