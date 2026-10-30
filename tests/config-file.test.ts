import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `torrentx-test-config-${Date.now()}`);

const { loadConfigFile } = await import("../src/core/config-file.js");
const { loadPluginSources } = await import("../src/core/plugins.js");
const { createConfig } = await import("../src/core/config.js");

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("loadConfigFile", () => {
  it("reads the first config file that exists", async () => {
    const primary = join(TEST_DIR, "torrentx.json");
    const secondary = join(TEST_DIR, ".torrentxrc");
    await writeFile(primary, JSON.stringify({ sourceTimeoutMs: 5000 }), "utf8");
    await writeFile(secondary, JSON.stringify({ sourceTimeoutMs: 9000 }), "utf8");

    const config = loadConfigFile([primary, secondary]);
    expect(config.sourceTimeoutMs).toBe(5000);
  });

  it("ignores malformed JSON and falls through to the next candidate", async () => {
    const broken = join(TEST_DIR, "torrentx.json");
    const valid = join(TEST_DIR, ".torrentxrc");
    await writeFile(broken, "{not json", "utf8");
    await writeFile(valid, JSON.stringify({ metadataLimit: 3 }), "utf8");

    expect(loadConfigFile([broken, valid]).metadataLimit).toBe(3);
    expect(loadConfigFile([broken])).toEqual({});
  });

  it("drops unknown keys and malformed values", async () => {
    const file = join(TEST_DIR, "torrentx.json");
    await writeFile(
      file,
      JSON.stringify({
        cacheTtlMs: -5,
        maxConcurrency: 4,
        userAgent: "  ",
        tmdbApiKey: "key",
        plugins: ["./plugin.js", 42, ""],
        totallyUnknown: true,
      }),
      "utf8",
    );

    const config = loadConfigFile([file], TEST_DIR);
    expect(config.cacheTtlMs).toBeUndefined();
    expect(config.maxConcurrency).toBe(4);
    expect(config.userAgent).toBeUndefined();
    expect(config.tmdbApiKey).toBe("key");
    expect(config.plugins).toEqual([join(TEST_DIR, "plugin.js")]);
    expect("totallyUnknown" in config).toBe(false);
  });

  it("ignores plugins outside the user config directory", async () => {
    const file = join(TEST_DIR, "torrentx.json");
    await writeFile(file, JSON.stringify({ plugins: ["./evil.js"], maxConcurrency: 2 }), "utf8");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const config = loadConfigFile([file], join(TEST_DIR, "user-config"));
      expect(config.plugins).toBeUndefined();
      expect(config.maxConcurrency).toBe(2);
      expect(stderr.mock.calls.flat().join("")).toContain("ignoring \"plugins\"");
    } finally {
      stderr.mockRestore();
    }
  });
});

describe("createConfig precedence", () => {
  afterEach(() => {
    delete process.env.TMDB_API_KEY;
  });

  it("lets env vars override config file values", async () => {
    const file = join(TEST_DIR, "torrentx.json");
    await writeFile(file, JSON.stringify({ tmdbApiKey: "file-key" }), "utf8");
    vi.spyOn(process, "cwd").mockReturnValue(TEST_DIR);

    process.env.TMDB_API_KEY = "env-key";
    const config = createConfig();
    expect(config.tmdbApiKey).toBe("env-key");

    delete process.env.TMDB_API_KEY;
    expect(createConfig().tmdbApiKey).toBe("file-key");
    expect(createConfig({ tmdbApiKey: "override-key" }).tmdbApiKey).toBe("override-key");
  });
});

describe("createConfig network settings", () => {
  const saved: Record<string, string | undefined> = {};
  const KEYS = [
    "TORRENTX_DNS",
    "TORRENTX_SOCKS5_PROXY",
    "TORRENTX_HTTP_PROXY",
    "ALL_PROXY",
    "all_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
  ];

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("parses TORRENTX_DNS as system, doh, or doh:<url>", () => {
    process.env.TORRENTX_DNS = "doh";
    expect(createConfig().dnsResolver).toBe("doh");

    process.env.TORRENTX_DNS = "doh:https://dns.google/resolve";
    const custom = createConfig();
    expect(custom.dnsResolver).toBe("doh");
    expect(custom.dohUrl).toBe("https://dns.google/resolve");

    process.env.TORRENTX_DNS = "system";
    expect(createConfig().dnsResolver).toBe("system");
  });

  it("prefers explicit proxy vars and falls back to standard env names", () => {
    process.env.ALL_PROXY = "socks5://127.0.0.1:1080";
    expect(createConfig().socks5Proxy).toBe("socks5://127.0.0.1:1080");

    process.env.TORRENTX_HTTP_PROXY = "http://proxy.local:8080";
    const config = createConfig();
    expect(config.httpProxy).toBe("http://proxy.local:8080");
    expect(config.socks5Proxy).toBeUndefined();

    delete process.env.ALL_PROXY;
    delete process.env.TORRENTX_HTTP_PROXY;
    process.env.https_proxy = "http://fallback.local:3128";
    expect(createConfig().httpProxy).toBe("http://fallback.local:3128");
  });
});

describe("loadPluginSources", () => {
  it("loads adapter instances and factories from plugin modules", async () => {
    const instancePath = join(TEST_DIR, "instance-plugin.mjs");
    await writeFile(
      instancePath,
      `export default {
         id: "plugin-a", name: "Plugin A", reliability: 0.5,
         mediaTypes: ["other"], regions: ["global"],
         search: async () => [],
       };`,
      "utf8",
    );
    const factoryPath = join(TEST_DIR, "factory-plugin.mjs");
    await writeFile(
      factoryPath,
      `export function createSource() {
         return {
           id: "plugin-b", name: "Plugin B", reliability: 0.5,
           mediaTypes: ["other"], regions: ["global"],
           search: async () => [],
         };
       }`,
      "utf8",
    );

    const sources = await loadPluginSources([instancePath, factoryPath], {} as never);
    expect(sources.map((s) => s.id)).toEqual(["plugin-a", "plugin-b"]);
  });

  it("rejects modules without a valid adapter", async () => {
    const badPath = join(TEST_DIR, "bad-plugin.mjs");
    await writeFile(badPath, `export default { nope: true };`, "utf8");

    await expect(loadPluginSources([badPath], {} as never)).rejects.toThrow(
      /does not export a valid SourceAdapter/,
    );
  });

  it("surfaces import errors with the plugin path", async () => {
    await expect(
      loadPluginSources([join(TEST_DIR, "missing-plugin.mjs")], {} as never),
    ).rejects.toThrow(/Failed to load source plugin/);
  });
});
