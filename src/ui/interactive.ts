import { render, type Instance } from "ink";
import { createElement } from "react";
import type { SearchEngine } from "../core/search-engine.js";
import { DownloadManager } from "../services/download-manager.js";
import type { SearchOptions } from "../types/search.js";
import { TorrentXApp } from "./app.js";

export async function runInteractive(
  engine: SearchEngine,
  options: SearchOptions & { mobile?: boolean } = {},
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive mode needs a TTY. Use `torrentx search <query>` instead.");
  }

  const downloadManager = new DownloadManager();
  // Resume any interrupted downloads from last session.
  await downloadManager.restore().catch(() => undefined);

  let app: Instance | undefined;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  };
  const stop = () => app?.unmount();

  process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l");
  if (process.platform === "win32") process.title = "TorrentX";
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    app = render(
      createElement(TorrentXApp, { engine, options, downloadManager }),
      {
        exitOnCtrlC: false,
      patchConsole: true,
      },
    );
    await app.waitUntilExit();
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await downloadManager.destroy().catch(() => undefined);
    restore();
  }
}
