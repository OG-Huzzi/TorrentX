import { Box, Text, useApp, useInput, useStdout } from "ink";
import { memo, useEffect, useMemo, useState } from "react";
import type { SearchEngine } from "../core/search-engine.js";
import type { DownloadManager } from "../services/download-manager.js";
import { MagnetActions } from "../services/magnet-actions.js";
import { ResultStore } from "../services/result-store.js";
import type {
  MediaType,
  SearchOptions,
  SearchProgress,
  SearchResult,
  SourceRun,
} from "../types/search.js";
import { formatSize } from "../utils/size.js";
import { truncate } from "../utils/text.js";
import { DownloadsPanel } from "./downloads-panel.js";
import { TextField } from "./text-field.js";
import { sourceColor, sourceTag, TUI_COLOR, TUI_ICON } from "./tui-theme.js";
import {
  nextResultSort,
  sortResults,
  visibleWindow,
  wrapIndex,
  type ResultSort,
} from "./tui-utils.js";

interface AppProps {
  engine: SearchEngine;
  options: SearchOptions & { mobile?: boolean };
  downloadManager?: DownloadManager;
}

interface Category {
  label: string;
  mediaType: MediaType | undefined;
}

const CATEGORIES: readonly Category[] = [
  { label: "All", mediaType: undefined },
  { label: "Movies", mediaType: "movie" },
  { label: "TV", mediaType: "tv" },
  { label: "Anime", mediaType: "anime" },
  { label: "Games", mediaType: "game" },
  { label: "Software", mediaType: "software" },
  { label: "Docs", mediaType: "documentary" },
];

type Screen = "splash" | "results" | "detail" | "downloads";
type Action = "copy" | "open" | "export";

export function TorrentXApp({ engine, options, downloadManager }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout?.columns ?? 100,
    rows: stdout?.rows ?? 28,
  });
  const [screen, setScreen] = useState<Screen>("splash");
  const [draft, setDraft] = useState("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [categoryIndex, setCategoryIndex] = useState(() => {
    const index = CATEGORIES.findIndex((item) => item.mediaType === options.mediaType);
    return Math.max(0, index);
  });
  const [sidebarFocused, setSidebarFocused] = useState(false);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<ResultSort>("rank");
  const [showHelp, setShowHelp] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [searchVersion, setSearchVersion] = useState(0);
  const [downloadCount, setDownloadCount] = useState(0);

  const compact =
    options.mobile === true || Boolean(process.env.TERMUX_VERSION) || size.columns < 76;
  const category = CATEGORIES[categoryIndex]!;
  const results = useMemo(
    () => sortResults(progress?.results ?? [], sort),
    [progress?.results, sort],
  );
  const selectedIndex = Math.max(0, results.findIndex((result) => result.id === selectedId));
  const selected = results[selectedIndex];

  useEffect(() => {
    if (!stdout) return;
    const resize = () =>
      setSize({ columns: stdout.columns ?? 100, rows: stdout.rows ?? 28 });
    stdout.on("resize", resize);
    return () => {
      stdout.off("resize", resize);
    };
  }, [stdout]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  // Poll download count for the header badge.
  useEffect(() => {
    if (!downloadManager) return;
    const tick = () => {
      const dls = downloadManager.getDownloads();
      setDownloadCount(dls.filter((d) => d.status === "downloading" || d.status === "queued").length);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [downloadManager]);

  useEffect(() => {
    if (!results.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !results.some((result) => result.id === selectedId)) {
      setSelectedId(results[0]!.id);
    }
  }, [results, selectedId]);

  useEffect(() => {
    if (activeQuery === null) return;
    const controller = new AbortController();
    setProgress(null);
    setNotice(null);

    const mediaType = category.mediaType ?? options.mediaType;
    const searchOptions: SearchOptions = {
      ...options,
      signal: controller.signal,
      ...(mediaType ? { mediaType } : {}),
    };
    delete (searchOptions as SearchOptions & { mobile?: boolean }).mobile;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingProgress: typeof progress = null;

    const throttledSetProgress = (next: typeof progress) => {
      pendingProgress = next;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (!controller.signal.aborted) {
          setProgress(pendingProgress);
        }
      }, 150);
    };

    void engine
      .search(activeQuery, searchOptions, (next) => {
        throttledSetProgress(next);
      })
      .then(async (report) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (controller.signal.aborted) return;
        setProgress({
          ...report,
          completedSources: report.sources.length,
          totalSources: report.sources.length,
        } as SearchProgress);
        await new ResultStore().save(report.results).catch(() => undefined);
      })
      .catch((error: unknown) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (!controller.signal.aborted) {
          setNotice(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [activeQuery, category.mediaType, engine, options, searchVersion]);

  const submit = (raw: string) => {
    const query = raw.trim();
    if (!query) {
      setNotice("Enter a search query.");
      return;
    }
    setDraft(query);
    setActiveQuery(query);
    setScreen("results");
    setEditing(false);
    setSidebarFocused(false);
    setSelectedId(null);
    setSearchVersion((version) => version + 1);
  };

  const moveSelection = (delta: number) => {
    if (!results.length) return;
    setSelectedId(results[wrapIndex(selectedIndex, delta, results.length)]!.id);
  };

  const performAction = async (action: Action) => {
    if (!selected || actionBusy) return;
    const actions = new MagnetActions();
    setActionBusy(true);
    try {
      if (action === "copy") {
        await actions.copy(selected);
        setNotice("Magnet copied to clipboard.");
      } else if (action === "open") {
        await actions.open(selected);
        setNotice("Opened in your torrent client.");
      } else {
        const destination = await actions.export(selected);
        setNotice(`Exported to ${destination}`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(false);
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (showHelp) {
      setShowHelp(false);
      return;
    }
    if (screen === "splash" || editing) return;
    if (input === "q") {
      exit();
      return;
    }
    if (input === "?") {
      setShowHelp(true);
      return;
    }
    if (key.escape) {
      if (screen === "detail") setScreen("results");
      else if (screen === "downloads") setScreen("results");
      else setScreen("splash");
      return;
    }
    if (input === "w" && downloadManager) {
      setScreen((s) => (s === "downloads" ? "results" : "downloads"));
      return;
    }
    if (screen === "downloads") return;
    if (input === "/") {
      setEditing(true);
      setSidebarFocused(false);
      return;
    }
    if (input === "r") {
      setSearchVersion((version) => version + 1);
      return;
    }
    if (input === "y" || input === "m") {
      void performAction("copy");
      return;
    }
    if (input === "D" && downloadManager && selected) {
      setActionBusy(true);
      downloadManager
        .startDownload(selected)
        .then(() => {
          setNotice("Download started.");
          setScreen("downloads");
        })
        .catch((err: Error) => setNotice(err.message))
        .finally(() => setActionBusy(false));
      return;
    }
    if (input === "d" || input === "o") {
      void performAction("open");
      return;
    }
    if (input === "e") {
      void performAction("export");
      return;
    }
    if (screen === "detail") return;
    if (input === "s") {
      setSort((current) => nextResultSort(current));
      return;
    }
    if (compact && input === "c") {
      setCategoryIndex((current) => wrapIndex(current, 1, CATEGORIES.length));
      return;
    }
    if (!compact && key.tab) {
      setSidebarFocused((focused) => !focused);
      return;
    }
    if (!compact && (key.leftArrow || input === "h")) {
      setSidebarFocused(true);
      return;
    }
    if (!compact && sidebarFocused) {
      if (key.rightArrow || key.return || input === "l") setSidebarFocused(false);
      else if (key.upArrow || input === "k") {
        setCategoryIndex((current) => wrapIndex(current, -1, CATEGORIES.length));
      } else if (key.downArrow || input === "j") {
        setCategoryIndex((current) => wrapIndex(current, 1, CATEGORIES.length));
      }
      return;
    }
    if (key.upArrow || input === "k") moveSelection(-1);
    else if (key.downArrow || input === "j") moveSelection(1);
    else if (key.return && selected) setScreen("detail");
  });

  // Ink clears the entire terminal when outputHeight >= stdout.rows (ink.js L121),
  // causing a full screen flash.  Keep a generous safety margin so rendered
  // height never reaches that threshold even with borders and padding.
  const layoutRows = Math.max(10, size.rows - 4);

  if (showHelp) {
    return <HelpView columns={size.columns} rows={layoutRows} notice={notice} />;
  }

  if (screen === "splash") {
    return (
      <SplashView
        columns={size.columns}
        rows={layoutRows}
        value={draft}
        setValue={setDraft}
        submit={submit}
        notice={notice}
      />
    );
  }

  return (
    <Shell columns={size.columns} rows={layoutRows} category={category.label} notice={notice} downloadCount={downloadCount}>
      {screen === "downloads" && downloadManager ? (
        <DownloadsPanel
          manager={downloadManager}
          width={Math.max(30, size.columns - 4)}
          rows={layoutRows}
          compact={compact}
          active
        />
      ) : screen === "detail" && selected ? (
        <DetailView result={selected} width={Math.max(30, size.columns - 4)} />
      ) : (
        <Box flexGrow={1} overflow="hidden">
          {!compact ? (
            <Sidebar selected={categoryIndex} focused={sidebarFocused} />
          ) : null}
          <Box flexDirection="column" flexGrow={1} minWidth={0}>
            <SearchBar
              value={draft}
              setValue={setDraft}
              submit={submit}
              editing={editing}
              setEditing={setEditing}
              width={compact ? size.columns - 4 : size.columns - 20}
            />
            <SourceStatus
              runs={progress?.sources ?? []}
              sourceIds={engine.getSources().map((source) => source.id)}
              loading={progress === null || progress.completedSources < progress.totalSources}
              width={compact ? size.columns - 4 : size.columns - 20}
            />
            <ResultsPanel
              results={results}
              selectedIndex={selectedIndex}
              sort={sort}
              loading={progress === null || progress.completedSources < progress.totalSources}
              cached={progress?.cached === true}
              rows={layoutRows}
              width={compact ? size.columns - 4 : size.columns - 20}
              compact={compact}
            />
          </Box>
        </Box>
      )}
      <Footer compact={compact} screen={screen} busy={actionBusy} hasDownloads={!!downloadManager} />
    </Shell>
  );
}

function Shell({
  columns,
  rows,
  category,
  notice,
  downloadCount,
  children,
}: {
  columns: number;
  rows: number;
  category: string;
  notice: string | null;
  downloadCount?: number;
  children: React.ReactNode;
}) {
  const noticeWidth = Math.max(0, columns - 44);
  const badge = downloadCount && downloadCount > 0 ? `  ↓${downloadCount}` : "";
  return (
    <Box flexDirection="column" height={rows} paddingX={1} overflow="hidden">
      <Box justifyContent="space-between">
        <Text>
          <Text bold color={TUI_COLOR.accent}>TORRENTX</Text>
          <Text dimColor>{`  /  ${category}`}</Text>
          {badge ? <Text color={TUI_COLOR.accent} bold>{badge}</Text> : null}
        </Text>
        {notice && noticeWidth > 8 ? (
          <Text color={TUI_COLOR.good}>{truncate(notice, noticeWidth)}</Text>
        ) : null}
      </Box>
      <Text color={TUI_COLOR.rule}>{"-".repeat(Math.max(1, columns - 2))}</Text>
      {children}
    </Box>
  );
}

function SplashView({
  columns,
  rows,
  value,
  setValue,
  submit,
  notice,
}: {
  columns: number;
  rows: number;
  value: string;
  setValue(value: string): void;
  submit(value: string): void;
  notice: string | null;
}) {
  const width = Math.max(12, Math.min(72, columns - 2));
  return (
    <Box height={rows} flexDirection="column" alignItems="center" justifyContent="center">
      <Text bold color={TUI_COLOR.accentBright}>TORRENTX</Text>
      <Text color={TUI_COLOR.text}>Fast, curated torrent meta-search.</Text>
      <Text dimColor>Movies  TV  Anime  Games  Software  Documentaries</Text>
      <Box
        marginTop={2}
        width={width}
        borderStyle="round"
        borderColor={TUI_COLOR.accent}
        paddingX={1}
      >
        <Text color={TUI_COLOR.accent}>{`${TUI_ICON.pointer} `}</Text>
        <TextField
          value={value}
          onChange={setValue}
          onSubmit={submit}
          active
          width={width - 6}
          placeholder="Search movies, anime, games..."
        />
      </Box>
      <Box marginTop={1}>
        <Text color={TUI_COLOR.accent}>{TUI_ICON.enter}</Text>
        <Text dimColor> search     </Text>
        <Text color={TUI_COLOR.accent}>^c</Text>
        <Text dimColor> quit</Text>
      </Box>
      {notice ? <Text color={TUI_COLOR.warn}>{notice}</Text> : null}
    </Box>
  );
}

function SearchBar({
  value,
  setValue,
  submit,
  editing,
  setEditing,
  width,
}: {
  value: string;
  setValue(value: string): void;
  submit(value: string): void;
  editing: boolean;
  setEditing(value: boolean): void;
  width: number;
}) {
  return (
    <Box width={Math.max(12, width)} borderStyle="round" borderColor={editing ? TUI_COLOR.accent : TUI_COLOR.rule} paddingX={1}>
      <Text color={TUI_COLOR.accent}>{`${TUI_ICON.pointer} `}</Text>
      <TextField
        value={value}
        onChange={setValue}
        onSubmit={submit}
        onCancel={() => setEditing(false)}
        active={editing}
        width={Math.max(10, width - 6)}
        placeholder="Search..."
      />
    </Box>
  );
}

const Sidebar = memo(function Sidebar({ selected, focused }: { selected: number; focused: boolean }) {
  return (
    <Box width={15} flexDirection="column" marginRight={1} paddingTop={1}>
      {CATEGORIES.map((item, index) => (
        <Box key={item.label}>
          <Box width={2}>
            {index === selected ? (
              <Text bold color={focused ? TUI_COLOR.accent : TUI_COLOR.rule}>{TUI_ICON.bar}</Text>
            ) : null}
          </Box>
          <Text
            bold={focused && index === selected}
            color={index === selected ? TUI_COLOR.accentBright : TUI_COLOR.muted}
            dimColor={index !== selected}
          >
            {item.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
});

const SourceStatus = memo(function SourceStatus({
  runs,
  sourceIds,
  loading,
  width,
}: {
  runs: readonly SourceRun[];
  sourceIds: readonly string[];
  loading: boolean;
  width: number;
}) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!loading) return;
    // 150ms keeps the spinner visible without causing excessive re-renders.
    const timer = setInterval(() => setFrame((current) => current + 1), 150);
    return () => clearInterval(timer);
  }, [loading]);
  const spinner = ["|", "/", "-", "\\"][frame % 4]!;

  return (
    <Box height={2} width={Math.max(10, width)} alignItems="center" overflow="hidden">
      <Text wrap="truncate-end">
        {sourceIds.map((source, index) => {
          const run = runs.find((item) => item.source === source);
          const marker = run?.error ? TUI_ICON.error : run ? TUI_ICON.done : spinner;
          const color = run?.error ? TUI_COLOR.bad : run ? TUI_COLOR.good : TUI_COLOR.accent;
          return (
            <Text key={source}>
              {index ? <Text dimColor>   </Text> : null}
              <Text color={color}>{marker}</Text>
              <Text color={sourceColor(source)}>{` ${sourceTag(source)}`}</Text>
              {run ? <Text dimColor>{run.error ? " offline" : ` ${run.resultCount}`}</Text> : null}
            </Text>
          );
        })}
      </Text>
    </Box>
  );
});

const ResultsPanel = memo(function ResultsPanel({
  results,
  selectedIndex,
  sort,
  loading,
  cached,
  rows,
  width,
  compact,
}: {
  results: readonly SearchResult[];
  selectedIndex: number;
  sort: ResultSort;
  loading: boolean;
  cached: boolean;
  rows: number;
  width: number;
  compact: boolean;
}) {
  const capacity = compact ? Math.max(2, Math.floor((rows - 11) / 2)) : Math.max(3, rows - 11);
  const start = visibleWindow(selectedIndex, results.length, capacity);
  const visible = results.slice(start, start + capacity);
  const titleWidth = Math.max(12, width - 39);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      minHeight={5}
      borderStyle="round"
      borderColor={TUI_COLOR.rule}
      paddingX={1}
      overflow="hidden"
    >
      <Box justifyContent="space-between">
        <Text bold color={TUI_COLOR.text}>{`Results ${results.length ? `(${results.length})` : ""}`}</Text>
        <Text dimColor>{`${cached ? "cache  " : ""}sort: ${sort}${loading ? "  searching" : ""}`}</Text>
      </Box>
      {!results.length ? (
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text color={loading ? TUI_COLOR.accent : TUI_COLOR.muted}>
            {loading ? "Searching trusted sources..." : "No matching results."}
          </Text>
        </Box>
      ) : compact ? (
        visible.map((result, offset) => {
          const here = start + offset === selectedIndex;
          return (
            <Box key={result.id} flexDirection="column">
              <Text wrap="truncate-end" bold={here} color={here ? TUI_COLOR.accentBright : TUI_COLOR.text}>
                <Text color={TUI_COLOR.accent}>{here ? `${TUI_ICON.pointer} ` : "  "}</Text>
                {truncate(result.title, Math.max(12, width - 5))}
              </Text>
              <Text dimColor>
                {`   ${result.quality ?? "?"}  ${formatSize(result.sizeBytes)}  `}
                <Text color={result.seeders > 0 ? TUI_COLOR.good : TUI_COLOR.bad}>{`${result.seeders} seeds`}</Text>
                <Text color={sourceColor(result.source)}>{`  ${sourceTag(result.source)}`}</Text>
              </Text>
            </Box>
          );
        })
      ) : (
        <>
          <Box>
            <Box width={3}><Text dimColor> </Text></Box>
            <Box width={titleWidth}><Text bold dimColor>Title</Text></Box>
            <Box width={8}><Text bold dimColor>Quality</Text></Box>
            <Box width={10}><Text bold dimColor>Size</Text></Box>
            <Box width={8} justifyContent="flex-end"><Text bold dimColor>Seeds</Text></Box>
            <Box width={8} justifyContent="flex-end"><Text bold dimColor>Source</Text></Box>
          </Box>
          {visible.map((result, offset) => {
            const here = start + offset === selectedIndex;
            return (
              <Box key={result.id}>
                <Box width={3}><Text bold color={TUI_COLOR.accent}>{here ? TUI_ICON.pointer : ""}</Text></Box>
                <Box width={titleWidth}><Text bold={here} color={here ? TUI_COLOR.accentBright : TUI_COLOR.text} wrap="truncate-end">{result.title}</Text></Box>
                <Box width={8}><Text dimColor>{result.quality ?? "-"}</Text></Box>
                <Box width={10}><Text dimColor>{formatSize(result.sizeBytes)}</Text></Box>
                <Box width={8} justifyContent="flex-end"><Text color={result.seeders > 0 ? TUI_COLOR.good : TUI_COLOR.bad}>{result.seeders}</Text></Box>
                <Box width={8} justifyContent="flex-end"><Text color={sourceColor(result.source)}>{sourceTag(result.source)}</Text></Box>
              </Box>
            );
          })}
        </>
      )}
    </Box>
  );
});

function DetailView({ result, width }: { result: SearchResult; width: number }) {
  const facts = [
    result.quality,
    result.codec,
    formatSize(result.sizeBytes),
    `${result.seeders} seeders`,
    `${result.leechers} leechers`,
  ].filter(Boolean);
  return (
    <Box flexDirection="column" flexGrow={1} paddingTop={1} overflow="hidden">
      <Box justifyContent="space-between">
        <Text bold color={TUI_COLOR.accentBright} wrap="truncate-end">{result.metadata?.title ?? result.title}</Text>
        <Text bold color={sourceColor(result.source)}>{sourceTag(result.source)}</Text>
      </Box>
      <Text color={TUI_COLOR.rule}>{"-".repeat(Math.max(1, width))}</Text>
      <Text dimColor>{facts.join(`  ${TUI_ICON.dot}  `)}</Text>
      <DetailRow label="Score" value={result.score.toFixed(1)} />
      <DetailRow label="Trusted" value={result.trusted ? "yes" : "no"} />
      {result.uploadedAt ? <DetailRow label="Uploaded" value={result.uploadedAt} /> : null}
      {result.language ? <DetailRow label="Language" value={result.language} /> : null}
      {result.metadata?.rating !== undefined ? <DetailRow label="Rating" value={result.metadata.rating.toFixed(1)} /> : null}
      {result.metadata?.genres?.length ? <DetailRow label="Genres" value={result.metadata.genres.join(", ")} /> : null}
      {result.metadata?.overview ? (
        <Box marginTop={1}><Text color={TUI_COLOR.text}>{result.metadata.overview}</Text></Box>
      ) : null}
      <Box marginTop={1}><Text dimColor>{result.magnetUri ? "Magnet available" : result.torrentUrl ? "Torrent URL available" : "Details page only"}</Text></Box>
    </Box>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Box width={11}><Text dimColor>{label}</Text></Box>
      <Text color={TUI_COLOR.text}>{value}</Text>
    </Box>
  );
}

const Footer = memo(function Footer({ compact, screen, busy, hasDownloads }: { compact: boolean; screen: Screen; busy: boolean; hasDownloads: boolean }) {
  const dlHint = hasDownloads ? "   w downloads   D download" : "";
  const hints = screen === "downloads"
    ? "esc back   p pause/resume   x cancel   t seed toggle   ? keys"
    : screen === "detail"
      ? `esc back   d open   y copy   e export${dlHint}   ? keys`
      : compact
        ? `up/down move   d open   y copy   / search   c category${dlHint}   ?`
        : `up/down move   enter details   d open   y copy   s sort   / search${dlHint}   ? keys`;
  return (
    <Box height={1}>
      <Text wrap="truncate-end" color={busy ? TUI_COLOR.warn : TUI_COLOR.muted}>
        {busy ? "Working..." : hints}
      </Text>
    </Box>
  );
});

function HelpView({ columns, rows, notice }: { columns: number; rows: number; notice: string | null }) {
  return (
    <Shell columns={columns} rows={rows} category="Keyboard" notice={notice}>
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={TUI_COLOR.accent} paddingX={2} paddingY={1} alignSelf="flex-start">
        <Text bold color={TUI_COLOR.accentBright}>Navigate</Text>
        <Text><Text color={TUI_COLOR.accent}>up/down, j/k</Text><Text dimColor>  Move through results or categories</Text></Text>
        <Text><Text color={TUI_COLOR.accent}>left/right, tab</Text><Text dimColor>  Switch sidebar and results</Text></Text>
        <Text><Text color={TUI_COLOR.accent}>enter</Text><Text dimColor>  Open result details</Text></Text>
        <Text><Text color={TUI_COLOR.accent}>esc</Text><Text dimColor>  Back</Text></Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold color={TUI_COLOR.accentBright}>Search and actions</Text>
          <Text><Text color={TUI_COLOR.accent}>/</Text><Text dimColor>  Edit search</Text></Text>
          <Text><Text color={TUI_COLOR.accent}>s</Text><Text dimColor>  Cycle rank, seeds, size, newest</Text></Text>
          <Text><Text color={TUI_COLOR.accent}>r</Text><Text dimColor>  Refresh current search</Text></Text>
          <Text><Text color={TUI_COLOR.accent}>d or o</Text><Text dimColor>  Open in system torrent client</Text></Text>
          <Text><Text color={TUI_COLOR.accent}>D (shift)</Text><Text dimColor>  Download with built-in client</Text></Text>
          <Text><Text color={TUI_COLOR.accent}>y or m</Text><Text dimColor>  Copy magnet</Text></Text>
          <Text><Text color={TUI_COLOR.accent}>e</Text><Text dimColor>  Export magnet</Text></Text>
          <Text><Text color={TUI_COLOR.accent}>w</Text><Text dimColor>  Toggle downloads view</Text></Text>
          <Text><Text color={TUI_COLOR.accent}>q</Text><Text dimColor>  Quit</Text></Text>
        </Box>
        <Box marginTop={1}><Text dimColor>Press any key to close</Text></Box>
      </Box>
    </Shell>
  );
}
