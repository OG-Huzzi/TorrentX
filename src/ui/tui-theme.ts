export const TUI_COLOR = {
  accent: "#42d3b5",
  accentBright: "#84f1d9",
  text: "#f2f5f4",
  muted: "#7f8b88",
  rule: "#45514e",
  good: "#8bd49c",
  warn: "#f4c76b",
  bad: "#f07f86",
  blue: "#79b8ff",
  orange: "#f2a65a",
} as const;

export const TUI_ICON = {
  pointer: "\u276f",
  done: "\u2713",
  error: "\u2717",
  pending: "\u00b7",
  dot: "\u00b7",
  bar: "\u258c",
  enter: "\u21b5",
  arrows: "\u2191\u2193",
} as const;

const SOURCE_COLORS: Record<string, string> = {
  yts: TUI_COLOR.good,
  nyaa: TUI_COLOR.accentBright,
  eztv: TUI_COLOR.warn,
  fitgirl: "#d8a0ff",
  piratebay: TUI_COLOR.blue,
  solidtorrents: "#f78c6c",
  bitsearch: "#c792ea",
  bittorrented: TUI_COLOR.orange,
  limetorrents: "#c3e88d",
  subsplease: TUI_COLOR.accent,
  "1337x": "#ff6b6b",
  torrentgalaxy: "#4ecdc4",
};

export function sourceColor(source: string): string {
  return SOURCE_COLORS[source.toLowerCase()] ?? TUI_COLOR.muted;
}

export function sourceTag(source: string): string {
  const tags: Record<string, string> = {
    yts: "YTS",
    nyaa: "NYAA",
    eztv: "EZTV",
    fitgirl: "FG",
    piratebay: "TPB",
    solidtorrents: "SOLID",
    bitsearch: "BIT",
    bittorrented: "BTD",
    limetorrents: "LIME",
    subsplease: "SP",
    "1337x": "1337",
    torrentgalaxy: "TGX",
  };
  return tags[source.toLowerCase()] ?? source.slice(0, 6).toUpperCase();
}
