import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { TorrentXConfig } from "../types/config.js";

/**
 * Optional JSON config file, merged between the built-in defaults and the
 * environment: defaults < config file < env vars < explicit overrides.
 *
 * Looked up at (first match wins):
 *   ./torrentx.json
 *   ./.torrentxrc
 *   $XDG_CONFIG_HOME/torrentx/config.json  (or ~/.config/torrentx/config.json)
 *
 * Unknown keys are ignored; malformed values fall back to defaults instead
 * of crashing the CLI.
 *
 * `plugins` run arbitrary code, so they are only honoured from the user's
 * own config directory — never from a file that merely sits in the current
 * directory (which could be a downloaded torrent's folder).
 */
export function userConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME ?? join(os.homedir(), ".config");
  return join(xdg, "torrentx");
}

export function defaultConfigCandidates(): string[] {
  return [
    join(process.cwd(), "torrentx.json"),
    join(process.cwd(), ".torrentxrc"),
    join(userConfigDir(), "config.json"),
    join(userConfigDir(), "torrentx.json"),
  ];
}

const NUMERIC_KEYS = [
  "cacheTtlMs",
  "sourceTimeoutMs",
  "maxConcurrency",
  "metadataLimit",
] as const;

const STRING_KEYS = [
  "tmdbApiKey",
  "omdbApiKey",
  "userAgent",
  "sourceProxyUrl",
  "downloadDir",
  "dohUrl",
  "socks5Proxy",
  "httpProxy",
  "torBinary",
] as const;

export function loadConfigFile(
  candidates: readonly string[] = defaultConfigCandidates(),
  pluginDir: string = userConfigDir(),
): Partial<TorrentXConfig> {
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(candidate, "utf8"));
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const file = resolve(candidate);
        return sanitize(parsed as Record<string, unknown>, {
          file,
          allowPlugins: file.startsWith(resolve(pluginDir) + sep),
        });
      }
    } catch {
      // Malformed file — ignore it and try the next candidate.
    }
  }
  return {};
}

function sanitize(
  raw: Record<string, unknown>,
  source: { file: string; allowPlugins: boolean },
): Partial<TorrentXConfig> {
  const config: Partial<TorrentXConfig> = {};

  for (const key of NUMERIC_KEYS) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      config[key] = Math.round(value);
    }
  }

  for (const key of STRING_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && value.trim() !== "") {
      config[key] = value.trim();
    }
  }

  const dns = raw["dns"];
  if (dns === "system" || dns === "doh") {
    config.dnsResolver = dns;
  }

  const tor = raw["tor"];
  if (typeof tor === "boolean") {
    config.tor = tor;
  }

  const proxyFallback = raw["proxyFallback"];
  if (typeof proxyFallback === "boolean") {
    config.proxyFallback = proxyFallback;
  }

  const plugins = raw["plugins"];
  if (Array.isArray(plugins) && plugins.length > 0) {
    if (source.allowPlugins) {
      // Relative entries are relative to the config file, not the cwd.
      config.plugins = plugins
        .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
        .map((entry) => resolve(dirname(source.file), entry.trim()));
    } else {
      process.stderr.write(
        `torrentx: ignoring "plugins" in ${source.file} — plugins are only loaded from ` +
          `${join(userConfigDir(), "config.json")}\n`,
      );
    }
  }

  return config;
}
