import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../src/core/config.js";
import { HttpClient } from "../src/services/http-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpClient", () => {
  it("uses the configured proxy template for source requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient(
      createConfig({
        sourceProxyUrl: "https://proxy.example/fetch?target={url}",
      }),
    );
    await expect(client.text("https://source.example/search?q=test")).resolves.toBe("ok");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://proxy.example/fetch?target=https%3A%2F%2Fsource.example%2Fsearch%3Fq%3Dtest",
      expect.objectContaining({
        headers: expect.objectContaining({
          "accept-language": "en-US,en;q=0.9",
        }),
      }),
    );
  });
});
