import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import envPaths from "env-paths";
import type { TorrentXConfig } from "../types/config.js";
import { verifyWebtorrentPatches } from "../services/download-engine.js";
import { findTorBinary, torInstallHint } from "../services/tor-service.js";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Environmental diagnostics: answers "will TorrentX work on this machine?"
 * without touching the network. Run `torrentx doctor` when reporting issues.
 */
export function executeDoctor(config: TorrentXConfig): void {
  const checks: Check[] = [];

  // Node.js version (package requires >= 22).
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node version",
    ok: major >= 22,
    detail: `${process.versions.node}${major >= 22 ? "" : " — TorrentX requires Node 22+"}`,
  });

  // webtorrent runtime patches (null-piece crashes, uTP error handlers).
  try {
    verifyWebtorrentPatches();
    checks.push({ name: "webtorrent patches", ok: true, detail: "applied" });
  } catch (error) {
    checks.push({
      name: "webtorrent patches",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // Download directory writability.
  checks.push(dirCheck("download dir", config.downloadDir ?? join(homedir(), "Downloads")));

  // State directory writability (download records, cached .torrent files).
  checks.push(
    dirCheck("state dir", process.env.TORRENTX_STATE_DIR ?? envPaths("torrentx", { suffix: "" }).data),
  );

  // Tor availability (only informational — needed for --tor).
  const torBinary = config.torBinary ?? findTorBinary();
  const torUsable = Boolean(torBinary && existsSync(torBinary));
  checks.push({
    name: "tor client",
    ok: torUsable,
    detail: torUsable
      ? torBinary!
      : torBinary
        ? `${torBinary} — not found on disk. ${torInstallHint()}`
        : `not found — ${torInstallHint()}`,
  });

  // Effective network settings, so support can see what is in play.
  const network = [
    config.tor ? (config.proxyFallback === true ? "tor(direct-fallback)" : "tor(strict)") : null,
    config.socks5Proxy ? `socks5=${config.socks5Proxy}` : null,
    config.httpProxy ? `http=${config.httpProxy}` : null,
    config.dnsResolver === "doh" ? `dns=doh(${config.dohUrl ?? "cloudflare"})` : "dns=system",
    config.sourceProxyUrl ? "source-proxy" : null,
  ]
    .filter(Boolean)
    .join("  ");

  for (const check of checks) {
    console.log(`${check.ok ? "ok  " : "FAIL"}  ${check.name.padEnd(18)} ${check.detail}`);
  }
  console.log(`      ${"network".padEnd(18)} ${network}`);

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

function dirCheck(name: string, dir: string): Check {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return { name, ok: true, detail: dir };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: `${dir} — ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
