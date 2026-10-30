# TorrentX

**A sleek, zero-setup torrent meta-search and download client that lives right in your terminal.**

Finding a torrent these days sucks. One site is a minefield of fake download buttons. Another hides the magnet link under a popup that spawns three more browser tabs. And after all that, half the results are dead with zero seeders.

**TorrentX** is a torrent finder and downloader with zero setup and nothing to configure. One search checks a curated list of reputable sources in parallel, ranks them by health, quality, and trust, and downloads them straight to your computer.

---

## Get started

1. Install Node 22 or newer (from [nodejs.org](https://nodejs.org)), it's all TorrentX needs.
2. Open your terminal.
3. Start it:
   ```bash
   npx torrentx
   ```

That is the only thing you'll type. TorrentX opens straight to a search bar: type what you're looking for, or paste a magnet link or bare infohash to begin. Pressing `?` brings up the keybindings guide anytime.

---

## Finding something

Type what you're looking for and press Enter. Results stream in concurrently from all trusted sources, tagged with size, quality, and seeders so you can see what will download fast:
*   **Top 100 built in:** TorrentX opens on the current category's Top 100 of the week. Press `t` to switch to the last 24 hours, or Enter on an empty search bar to browse the top again — per category, no typing needed.
*   **Smart Intent:** Searching `anime`, `kdrama`, or language names automatically adjusts source priority and filters.
*   **Mobile Mode:** Automatically detects Termux and narrow screens, shifting to a compact two-line layout.
*   **FMHY fallbacks:** Includes a local crawler for **FreeMediaHeckYeah (FMHY)**. If torrent seed counts are zero, you can search FMHY to find curated streaming and direct download pages, pressing `d` to open them directly in your default browser.

Navigate the list using your arrow keys or `j`/`k`. Press `Enter` to see detailed metadata, or `d` to open the link in your system's default handler.

---

## Your downloads

Active downloads run in the background while you keep searching. Press `D` (Shift+D) on any search result to start downloading immediately using our built-in WebTorrent client.

Press `w` to toggle the downloads panel:
*   **Live Metrics:** Shows progress bars, download/upload speeds, and ETAs.
*   **Lifecycle Control:** Press `p` to pause/resume, `x` to cancel, and `t` to toggle seeding.
*   **Persistence:** Download state is persisted to disk. If you quit mid-transfer, TorrentX picks up exactly where it left off next time you launch.
*   **Auto-Seeding:** Completed downloads seed automatically so the next person can find them.

### Download speed

TorrentX does not apply a download rate cap. It uses DHT, local peer discovery, peer exchange, tracker discovery, rarest-piece selection, and a 350-peer connection budget to find healthy peers quickly. Actual speed is still limited by the torrent's available seeders, their upload capacity, your router, and your ISP.

You can tune the connection budget before launch when needed:

```powershell
$env:TORRENTX_MAX_CONNS = "400" # 55-1200, default 350
npx torrentx
```

`TORRENTX_MAX_WEB_CONNS` (1-96), `TORRENTX_STORE_CACHE_SLOTS` (8-512), and `TORRENTX_DOWNLOAD_STRATEGY` (`rarest`, the default, or `sequential`) are also supported. Set `TORRENTX_TRACKERS` to a comma- or newline-separated tracker list to replace the built-in list. `TORRENTX_MAX_PARALLEL_DOWNLOADS` (1-16, default 3) caps how many downloads run at once — the rest wait in the queue and start automatically. `TORRENTX_STALL_TIMEOUT_MS` (default 15 minutes) controls how long a download may make no progress before it is marked as an error.

### Metadata enrichment (optional)

TorrentX can enrich search results with posters, ratings, and overviews from **TMDB** and **OMDB**. Without keys this is simply skipped — searches work exactly the same. To enable it, set one or both:

```powershell
$env:TMDB_API_KEY = "your-tmdb-key"
$env:OMDB_API_KEY = "your-omdb-key"
```

TMDB is tried first; if it fails or finds no good title match, OMDB is used as a fallback (free keys: [themoviedb.org](https://www.themoviedb.org/settings/api), [omdbapi.com](https://www.omdbapi.com/apikey.aspx)).

### Configuration file

Every environment variable above has a config-file equivalent. TorrentX looks for (first match wins):

* `torrentx.json` or `.torrentxrc` in the directory you launch from
* `~/.config/torrentx/config.json`

```json
{
  "sourceTimeoutMs": 8000,
  "maxConcurrency": 8,
  "downloadDir": "D:\\Downloads",
  "tmdbApiKey": "your-tmdb-key",
  "dns": "doh",
  "tor": true
}
```

Precedence: built-in defaults < config file < environment variables. Unknown keys and malformed values are ignored rather than crashing.

`torrentx doctor` prints what TorrentX sees on your machine (Node version, patched webtorrent, writable folders, Tor availability, effective network settings) — include its output when reporting a problem.

### Source plugins

The `plugins` array adds your own search sources. Plugins are ordinary code, so they are only loaded from your user config (`~/.config/torrentx/config.json`); a `plugins` entry in a `torrentx.json` in the current directory is ignored with a warning. Relative paths are resolved against the config file's folder:

```json
{ "plugins": ["./my-tracker-source.js"] }
```

Each module must export a `SourceAdapter` (as `default`, `source`, or a `createSource()` factory) with `id`, `name`, `reliability`, `mediaTypes`, and a `search()` method — see `src/types/search.ts` for the interface.

---

## What it searches

A short, hand-picked list of indices:
*   **Games:** Sourced from **FitGirl Repacks**, with a long, trusted track record for executable content.
*   **Anime:** Sourced from **Nyaa** and **SubsPlease**.
*   **Movies and TV:** Sourced from **YTS** (movies) and **EZTV** (TV).
*   **General:** **The Pirate Bay**, **TorrentGalaxy**, **LimeTorrents**, and **Bitsearch** (which now also serves the former SolidTorrents index).
*   **Fallback Pages:** Sourced from **FreeMediaHeckYeah (FMHY)** to get working streaming or DDL links when torrents are dead.

Run `torrentx sources` for the exact list.

If a source is down, the search carries on without it, and TorrentX tells you in the footer which index is offline.

---

## Command Line Interface (CLI)

You can also run direct searches or manage downloads directly from the command line:

```bash
# Non-interactive search
torrentx search "ubuntu"
torrentx movie "dune" --quality 1080p --min-seeds 50

# Browse the top 100 without searching (today = last 24h, week = last 7 days)
torrentx top
torrentx top today --type movie
torrentx top week --type anime --json

# Actions on recent results
torrentx open 2
torrentx export 2 magnet.txt

# Download status
torrentx downloads
torrentx dl --json

# Route any command through the built-in Tor connection
torrentx search "dune" --tor

# Check that TorrentX can run on this machine
torrentx doctor
```



---

---

## Troubleshooting

### 1. Source timeouts or blocked statuses
TorrentX races its mirror domains and shows the real reason a source failed: `timeout`, `blocked`, `limited`, `changed`, or `unreachable`. A timeout across every mirror usually means the network is blocking that site's traffic; it is not a parser failure inside TorrentX.

In many regions, ISPs block torrent search sites at the network level. TorrentX can route around all of the common blocking techniques:

#### DNS hijacking (most common) — enable DNS-over-HTTPS

Some ISPs poison DNS answers so that blocked domains all resolve to one sinkhole address. A quick tell: `nslookup thepiratebay.org` returns the same odd IP as other blocked sites. TorrentX can resolve domains over HTTPS instead, which the ISP cannot tamper with:

```bash
# Linux / macOS
TORRENTX_DNS=doh npx torrentx

# PowerShell
$env:TORRENTX_DNS = "doh"
npx torrentx
```

Or set `"dns": "doh"` in the config file (see [Configuration file](#configuration-file)). `"doh:https://dns.google/resolve"` selects a custom DNS-over-HTTPS provider. This only affects how site names are resolved — queries go to the DNS provider, not to any search proxy.

#### Built-in Tor (like Brave's Private Window with Tor)

TorrentX can launch and manage a Tor connection itself — no separate setup:

```bash
npx torrentx --tor                # interactive, over Tor
npx torrentx search "dune" --tor  # one-off search, over Tor
```

TorrentX finds a Tor client on your machine (from `PATH`, from a **Tor Browser** install, or from `TORRENTX_TOR_BINARY`), starts it with its own SOCKS port, waits for the bootstrap, and routes all source and metadata requests through it. DNS is resolved inside Tor. Downloads stay direct peer-to-peer.

Add `"tor": true` to your `torrentx.json` to **always start with Tor** (no flag needed); `TORRENTX_TOR=0` skips it for a single run.

If you don't have Tor yet: install [Tor Browser](https://www.torproject.org/download/) (any OS), or `apt/dnf/brew install tor`, or `pkg install tor` on Termux — run `torrentx doctor` to confirm TorrentX can find it. Note that some sites block Tor exit nodes (Cloudflare is aggressive about this), so regular mode may return more results on uncensored networks; `--tor` is for when your network or the sites themselves block access.

#### IP blocks, TLS interference, and censorship — use a proxy

If the network blocks the sites themselves (connection resets during handshake, permanent timeouts), route source requests through any proxy you control or trust. DNS is resolved by the proxy, so DNS hijacking is bypassed as well:

```bash
# Tor (install tor, then):
TORRENTX_SOCKS5_PROXY=socks5h://127.0.0.1:9050 npx torrentx

# An SSH tunnel is enough on any machine with ssh access to a VPS:
ssh -D 1080 user@your-vps        # then, in another terminal:
TORRENTX_SOCKS5_PROXY=socks5h://127.0.0.1:1080 npx torrentx

# A standard HTTP CONNECT proxy (including Tor's HTTPTunnelPort):
TORRENTX_HTTP_PROXY=http://127.0.0.1:8118 npx torrentx
```

The standard `ALL_PROXY` / `HTTPS_PROXY` environment variables are honoured too, so existing VPN and tunnel setups work without changes. `socks5h://` (and TorrentX's SOCKS5 support in general) resolves site names at the proxy — the local ISP resolver never sees them. Only search/metadata traffic goes through the proxy; torrent downloads stay direct peer-to-peer.

As a last resort, `TORRENTX_SOURCE_PROXY` routes requests through a web-based fetch proxy (there is no built-in proxy, so searches are never sent to a third party by default):

```powershell
$env:TORRENTX_SOURCE_PROXY = "https://proxy.example/fetch?target={url}"
npx torrentx
```

<details>
<summary>Alternatively, change your system DNS (Windows PowerShell as Admin)</summary>

```powershell
# 1. Find your active adapter name (usually "Wi-Fi" or "Ethernet")
Get-NetAdapter | Where-Object Status -eq Up

# 2. Set Cloudflare DNS (replace "Wi-Fi" with your adapter name if different)
Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ServerAddresses ("1.1.1.1","1.0.0.1")

# 3. Flush the DNS resolver cache
ipconfig /flushdns
```

Restore with `Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ResetServerAddresses`.
</details>

### 2. Disk Space Errors ("ENOSPC" or truncated file sizes)
If your primary C: drive is low on space, TorrentX downloads will fail or get stuck at `0 B/s`. You can direct TorrentX to save downloads to a different drive (like `D:\Downloads`) by setting an environment variable in your terminal before launching:

#### PowerShell:
```powershell
$env:TORRENTX_DOWNLOAD_DIR = "D:\Downloads"
npx torrentx
```

#### Bash/macOS/Linux:
```bash
export TORRENTX_DOWNLOAD_DIR="/path/to/downloads"
npx torrentx
```

---

## Contributing

To run or work on TorrentX locally:
1. Clone the repository and open the folder.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development version:
   ```bash
   npm run dev
   ```
4. Or build and run the bundled version:
   ```bash
   npm run build
   npx .
   ```

---

## Privacy

Your files stay on your disk, and nothing routes through a central server. What your network provider can observe depends on the traffic:

| Traffic | What is visible |
|---|---|
| **Searches & metadata** (Tor mode) | Only that Tor is in use. Queries, the sites you search, and results stay inside the Tor network. |
| **DNS lookups** (`dns: "doh"`) | Nothing — names are resolved over HTTPS, so a hijacking ISP resolver never sees them. |
| **Torrent downloads** | Visible as peer-to-peer traffic. Tracker announces and DHT queries carry the infohash, which identifies the content. Downloads are intentionally **not** routed through Tor (BitTorrent over Tor degrades the whole network); use a device-wide VPN if your ISP must not see what you download. |

Tor mode is strict by default: every source request stays inside Tor, and sites that block Tor exit nodes simply fail. If you would rather have those sites work, set `TORRENTX_PROXY_FALLBACK=1` (or `"proxyFallback": true`) and failed requests are retried over a **direct** connection — for those sites only, your provider then sees that a connection happened (destination and name, not the response contents). `torrentx doctor` prints which mode you are in (`tor(strict)` vs `tor(direct-fallback)`). Your own SOCKS/HTTP proxies keep the direct retry on by default; set `TORRENTX_PROXY_FALLBACK=0` to turn it off.

TorrentX also skips its startup DNS warm-up whenever Tor, a proxy, or DoH is configured, so source domains are never sent to your system resolver in those modes.

Also note that providers can always tell *that* Tor is in use, even if not what for; configure Tor bridges if that matters in your threat model.

Once a download finishes it keeps seeding by default, sharing it back so the next person can find it just as easily. The network only works because people pass things along, and even a few minutes makes a real difference. If you'd rather not, opt out anytime: open the Seeding tab, press p to pause or stop any item, and press it again to pick it back up. Always your call.

---

## License

MIT
