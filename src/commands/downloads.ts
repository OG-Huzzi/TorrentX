import { DownloadStore } from "../services/download-store.js";
import { formatSize } from "../utils/size.js";

const STATUS_ICONS: Record<string, string> = {
  queued: "·",
  downloading: "↓",
  paused: "⏸",
  completed: "✓",
  seeding: "↑",
  error: "✗",
};

export async function executeDownloadsList(options: {
  json?: boolean;
}): Promise<void> {
  const store = new DownloadStore();
  const records = await store.load();

  if (options.json) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  if (records.length === 0) {
    console.log("No downloads.");
    return;
  }

  console.log(`\n  Downloads (${records.length})\n`);
  for (const [i, record] of records.entries()) {
    const icon = STATUS_ICONS[record.status] ?? "?";
    const pct =
      record.totalBytes > 0
        ? `${Math.round((record.downloadedBytes / record.totalBytes) * 100)}%`
        : "--";
    const size = formatSize(record.totalBytes);
    console.log(
      `  ${(i + 1).toString().padStart(3)}  ${icon}  ${record.status.padEnd(12)}  ${pct.padStart(4)}  ${size.padStart(10)}  ${record.title}`,
    );
  }
  console.log();
}
