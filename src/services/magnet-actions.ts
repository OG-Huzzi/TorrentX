import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { SearchResult } from "../types/search.js";

export class MagnetActions {
  async copy(result: SearchResult): Promise<string> {
    const uri = actionableUri(result);
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
    throw new Error(`No clipboard command found. Magnet: ${uri}`);
  }

  async open(result: SearchResult): Promise<string> {
    const uri = actionableUri(result);
    const [command, args] =
      process.platform === "win32"
        ? ["cmd.exe", ["/c", "start", "", uri]]
        : process.platform === "darwin"
          ? ["open", [uri]]
          : process.env.TERMUX_VERSION
            ? ["termux-open-url", [uri]]
            : ["xdg-open", [uri]];

    await spawnDetached(command, args);
    return uri;
  }

  async export(result: SearchResult, file?: string): Promise<string> {
    const destination = path.resolve(file ?? "torrentx-magnet.txt");
    await writeFile(destination, `${actionableUri(result)}\n`, "utf8");
    return destination;
  }
}

import { sanitizeMagnet } from "../utils/magnet.js";

export function actionableUri(result: SearchResult): string {
  const uri = result.magnetUri ?? result.torrentUrl;
  if (!uri) {
    throw new Error(`${result.source} provides a details page only for this result.`);
  }
  return sanitizeMagnet(uri);
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
