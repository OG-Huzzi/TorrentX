import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import type { DownloadManager } from "../services/download-manager.js";
import type { DownloadItem, DownloadStatus } from "../types/download.js";
import { formatSize } from "../utils/size.js";
import { truncate } from "../utils/text.js";
import { ProgressBar } from "./progress-bar.js";
import { TUI_COLOR, TUI_ICON } from "./tui-theme.js";
import { visibleWindow, wrapIndex } from "./tui-utils.js";

interface DownloadsPanelProps {
  manager: DownloadManager;
  width: number;
  rows: number;
  compact: boolean;
  active: boolean;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "0 B/s";
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024)
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatEta(seconds: number): string {
  if (seconds < 0) return "--:--";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m${s.toString().padStart(2, "0")}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m.toString().padStart(2, "0")}m`;
}

const STATUS_ICON: Record<DownloadStatus, string> = {
  queued: TUI_ICON.pending,
  downloading: "↓",
  paused: "⏸",
  completed: TUI_ICON.done,
  seeding: "↑",
  error: TUI_ICON.error,
};

const STATUS_COLOR: Record<DownloadStatus, string> = {
  queued: TUI_COLOR.muted,
  downloading: TUI_COLOR.accent,
  paused: TUI_COLOR.warn,
  completed: TUI_COLOR.good,
  seeding: TUI_COLOR.blue,
  error: TUI_COLOR.bad,
};

export function DownloadsPanel({
  manager,
  width,
  rows,
  compact,
  active,
}: DownloadsPanelProps) {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  // Listen to manager events with a 200ms throttle for UI updates, matching torlink exactly.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const triggerUpdate = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setDownloads(manager.getDownloads());
      }, 200);
    };

    manager.on("progress", triggerUpdate);
    manager.on("added", triggerUpdate);
    manager.on("removed", triggerUpdate);
    manager.on("done", triggerUpdate);
    manager.on("error", triggerUpdate);

    // Initial load
    setDownloads(manager.getDownloads());

    // Fallback interval just in case we miss any state updates
    const interval = setInterval(triggerUpdate, 1000);

    return () => {
      manager.off("progress", triggerUpdate);
      manager.off("added", triggerUpdate);
      manager.off("removed", triggerUpdate);
      manager.off("done", triggerUpdate);
      manager.off("error", triggerUpdate);
      clearInterval(interval);
      if (timer) clearTimeout(timer);
    };
  }, [manager]);

  // Clear notice after 3s.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Keep selection in bounds.
  useEffect(() => {
    if (downloads.length === 0) setSelectedIndex(0);
    else if (selectedIndex >= downloads.length)
      setSelectedIndex(downloads.length - 1);
  }, [downloads.length, selectedIndex]);

  const selected = downloads[selectedIndex];

  useInput(
    (input, key) => {
      if (!active) return;
      if (key.upArrow || input === "k") {
        setSelectedIndex((i) => wrapIndex(i, -1, downloads.length));
      } else if (key.downArrow || input === "j") {
        setSelectedIndex((i) => wrapIndex(i, 1, downloads.length));
      } else if (input === "p" && selected) {
        if (selected.status === "downloading") {
          void manager.pauseDownload(selected.id);
          setNotice("Paused.");
        } else if (selected.status === "paused") {
          void manager.resumeDownload(selected.id);
          setNotice("Resumed.");
        }
      } else if (input === "x" && selected) {
        void manager.cancelDownload(selected.id);
        setNotice("Cancelled.");
      } else if (input === "t" && selected) {
        void manager.toggleSeed(selected.id).then((newStatus) => {
          if (newStatus) setNotice(`Now: ${newStatus}`);
        });
      }
    },
    { isActive: active },
  );

  const capacity = compact
    ? Math.max(2, Math.floor((rows - 9) / 3))
    : Math.max(3, Math.floor((rows - 9) / 2));
  const start = visibleWindow(selectedIndex, downloads.length, capacity);
  const visible = downloads.slice(start, start + capacity);
  const barWidth = Math.max(10, width - 16);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="round"
      borderColor={TUI_COLOR.rule}
      paddingX={1}
      overflow="hidden"
    >
      <Box justifyContent="space-between">
        <Text bold color={TUI_COLOR.text}>
          {`Downloads ${downloads.length ? `(${downloads.length})` : ""}`}
        </Text>
        {notice ? (
          <Text color={TUI_COLOR.good}>{notice}</Text>
        ) : (
          <Text dimColor>p pause/resume  x cancel  t toggle seed</Text>
        )}
      </Box>
      {downloads.length === 0 ? (
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text color={TUI_COLOR.muted}>
            No downloads. Press Shift+D on a search result to start.
          </Text>
        </Box>
      ) : (
        visible.map((item, offset) => {
          const here = start + offset === selectedIndex;
          return (
            <DownloadRow
              key={item.id}
              item={item}
              selected={here}
              width={width}
              barWidth={barWidth}
              compact={compact}
            />
          );
        })
      )}
    </Box>
  );
}

function DownloadRow({
  item,
  selected,
  width,
  barWidth,
  compact,
}: {
  item: DownloadItem;
  selected: boolean;
  width: number;
  barWidth: number;
  compact: boolean;
}) {
  const icon = STATUS_ICON[item.status];
  const color = STATUS_COLOR[item.status];
  const prog = item.liveProgress;
  const progress = prog?.progress ?? (item.totalBytes > 0 ? item.downloadedBytes / item.totalBytes : 0);
  const titleMax = Math.max(10, width - 48);
  const hasError = !!item.errorMessage;

  if (compact) {
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color={TUI_COLOR.accent}>{selected ? `${TUI_ICON.pointer} ` : "  "}</Text>
          <Text color={color}>{icon} </Text>
          <Text bold={selected} color={selected ? TUI_COLOR.accentBright : TUI_COLOR.text}>
            {truncate(item.title, titleMax)}
          </Text>
        </Text>
        <Box paddingLeft={4}>
          <ProgressBar progress={progress} width={Math.max(8, barWidth - 4)} />
          {prog ? (
            <Text dimColor>{`  ${formatSpeed(prog.downloadSpeed)}  ${formatEta(prog.eta)}  (${prog.peers} peers)`}</Text>
          ) : null}
        </Box>
        {hasError ? (
          <Box paddingLeft={4}>
            <Text color={TUI_COLOR.bad} wrap="truncate-end">
              {truncate(item.errorMessage!, Math.max(10, width - 8))}
            </Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Box width={3}>
          <Text bold color={TUI_COLOR.accent}>
            {selected ? TUI_ICON.pointer : ""}
          </Text>
        </Box>
        <Box width={3}>
          <Text color={color}>{icon}</Text>
        </Box>
        <Box width={titleMax} minWidth={0}>
          <Text
            bold={selected}
            color={selected ? TUI_COLOR.accentBright : TUI_COLOR.text}
            wrap="truncate-end"
          >
            {item.title}
          </Text>
        </Box>
        <Box width={10}>
          <Text dimColor>{formatSize(item.totalBytes)}</Text>
        </Box>
        {prog ? (
          <>
            <Box width={12}>
              <Text color={TUI_COLOR.accent}>
                {formatSpeed(prog.downloadSpeed)}
              </Text>
            </Box>
            <Box width={10}>
              <Text dimColor>{`${prog.peers} peers`}</Text>
            </Box>
            <Box width={8}>
              <Text dimColor>{formatEta(prog.eta)}</Text>
            </Box>
          </>
        ) : (
          <Box width={30}>
            {hasError ? (
              <Text color={TUI_COLOR.bad}>{item.status} !</Text>
            ) : (
              <Text dimColor>{item.status}</Text>
            )}
          </Box>
        )}
      </Box>
      <Box paddingLeft={6}>
        <ProgressBar progress={progress} width={Math.max(8, barWidth - 6)} />
      </Box>
      {hasError ? (
        <Box paddingLeft={6}>
          <Text color={TUI_COLOR.bad} wrap="truncate-end">
            {truncate(item.errorMessage!, Math.max(10, width - 10))}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

