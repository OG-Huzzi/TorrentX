export const PUBLIC_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://tracker.moeking.me:6969/announce",
  "udp://p4p.arenabg.com:1337/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://opentracker.i2p.rocks:6969/announce",
  "udp://47.ip-51-68-199.eu:6969/announce",
  "udp://tracker.internetwarriors.net:1337/announce",
  "udp://tracker.leechers-paradise.org:6969/announce",
  "udp://tracker.coppersurfer.tk:6969/announce",
  "udp://tracker.pirateparty.gr:6969/announce",
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.webtorrent.dev",
];

export function parseTrackerList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/[\r\n,]+/)
    .map((tracker) => tracker.trim())
    .filter(Boolean);
}

export function uniqueTrackers(trackers: Iterable<string>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const tracker of trackers) {
    const normalized = tracker.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

export function configuredTrackers(): string[] {
  const override = parseTrackerList(process.env.TORRENTX_TRACKERS);
  return uniqueTrackers(override.length > 0 ? override : PUBLIC_TRACKERS);
}
