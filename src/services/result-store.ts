import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SearchResult } from "../types/search.js";

export class ResultStore {
  private readonly file: string;

  constructor(file?: string) {
    const stateDirectory =
      process.env.TORRENTX_STATE_DIR ??
      path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "torrentx");
    this.file = file ?? path.join(stateDirectory, "last-results.json");
  }

  async save(results: SearchResult[]): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(results.slice(0, 100)), "utf8");
  }

  async get(index: number): Promise<SearchResult | undefined> {
    try {
      const results = JSON.parse(await readFile(this.file, "utf8")) as SearchResult[];
      return results[index - 1];
    } catch {
      return undefined;
    }
  }
}
