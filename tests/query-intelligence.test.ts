import { describe, expect, it } from "vitest";
import { inferSearchIntent } from "../src/core/query-intelligence.js";

describe("inferSearchIntent", () => {
  it("prioritizes anime sources", () => {
    const intent = inferSearchIntent("anime attack on titan");
    expect(intent.query).toBe("attack on titan");
    expect(intent.mediaType).toBe("anime");
    expect(intent.region).toBe("japan");
    expect(intent.preferredSources[0]).toBe("nyaa");
  });

  it("recognizes Indian language and region hints", () => {
    const intent = inferSearchIntent("bollywood kgf hindi");
    expect(intent.query).toBe("kgf");
    expect(intent.mediaType).toBe("movie");
    expect(intent.region).toBe("india");
    expect(intent.language).toBe("hindi");
    expect(intent.preferredSources).toContain("piratebay");
  });

  it("recognizes Korean drama", () => {
    const intent = inferSearchIntent("kdrama squid game");
    expect(intent.query).toBe("squid game");
    expect(intent.mediaType).toBe("tv");
    expect(intent.region).toBe("korea");
  });
});
