import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { SearchResult } from "../types/search.js";
import { sanitizeMagnet } from "../utils/magnet.js";

/** Schemes TorrentX will hand to the system opener or clipboard. */
const OPENABLE_SCHEMES = ["magnet:", "http:", "https:"];

export class MagnetActions {
  async copy(result: SearchResult): Promise<string> {
    const uri = openableUri(result);
    const commands =
      process.platform === "win32"
        ? [["clip.exe", []] as const]
        : process.platform === "darwin"
          ? [["pbcopy", []] as const]
          : process.env.TERMUX_VERSION
            ? [["termux-clipboard-set", []] as const]
            : [
                ["xclip", ["-selection", "clipboard"]] as const,
                ["xsel", ["--clipboard", "--input"]] as const,
              ];

    for (const [command, args] of commands) {
      try {
        await pipeToCommand(command, [...args], uri);
        return uri;
      } catch {
        // Try the next clipboard provider.
      }
    }
    throw new Error(`No clipboard command found. Link: ${uri}`);
  }

  async open(result: SearchResult): Promise<string> {
    const uri = openableUri(result);
    await spawnDetached(...openCommand(uri));
    return uri;
  }

  async export(result: SearchResult, file?: string): Promise<string> {
    const destination = path.resolve(file ?? "torrentx-magnet.txt");
    await writeFile(destination, `${openableUri(result)}\n`, "utf8");
    return destination;
  }
}

/** The magnet or .torrent URL the built-in client can download. */
export function actionableUri(result: SearchResult): string {
  const uri = result.magnetUri ?? result.torrentUrl;
  if (!uri) {
    throw new Error(`${result.source} provides a details page only for this result.`);
  }
  return sanitizeMagnet(uri);
}

/**
 * The link to open, copy or export: the magnet / .torrent URL when there is
 * one, otherwise the details page (FMHY fallbacks are pages, not torrents).
 * Only magnet and web links are allowed — the value comes from scraped pages
 * and is passed to the system opener, which would also launch file:, smb:
 * or app-specific URLs.
 */
export function openableUri(result: SearchResult): string {
  const uri = result.magnetUri ?? result.torrentUrl ?? result.detailsUrl;
  if (!uri) {
    throw new Error(`${result.source} provides no link for this result.`);
  }
  if (!OPENABLE_SCHEMES.some((scheme) => uri.toLowerCase().startsWith(scheme))) {
    throw new Error(`Refusing to open a non-web link: ${uri.slice(0, 80)}`);
  }
  return uri.startsWith("magnet:") ? sanitizeMagnet(uri) : uri;
}

/**
 * Platform opener for a URI. On Windows this avoids `cmd.exe /c start`:
 * cmd re-parses its command line, so the `&` separators in every magnet
 * would split it into extra commands. rundll32 receives the URI verbatim.
 */
export function openCommand(
  uri: string,
  platform: NodeJS.Platform = process.platform,
  termux = Boolean(process.env.TERMUX_VERSION),
): [string, string[]] {
  if (platform === "win32") return ["rundll32.exe", ["url.dll,FileProtocolHandler", uri]];
  if (platform === "darwin") return ["open", [uri]];
  if (termux) return ["termux-open-url", [uri]];
  return ["xdg-open", [uri]];
}

function pipeToCommand(command: string, args: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    );
    child.stdin.end(input);
  });
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
