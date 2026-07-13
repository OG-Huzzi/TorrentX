# TorrentX

**A sleek, zero-setup torrent meta-search and download client that lives right in your terminal.**

Finding a torrent these days sucks. One site is a minefield of fake download buttons. Another hides the magnet link under a popup that spawns three more browser tabs. And after all that, half the results are dead with zero seeders.

**TorrentX** is a torrent finder and downloader with zero setup and nothing to configure. One search checks a curated list of reputable sources in parallel, ranks them by health, quality, and trust, and downloads them straight to your computer.

---

## Get started

1. Install Node (from [nodejs.org](https://nodejs.org)), it's all TorrentX needs.
2. Open your terminal.
3. Start it:
   ```bash
   npx torrentx
   ```

That is the only thing you'll type. TorrentX opens straight to a search bar: type what you're looking for, or paste a magnet link or bare infohash to begin. Pressing `?` brings up the keybindings guide anytime.

---

## Finding something

Type what you're looking for and press Enter. Results stream in concurrently from all trusted sources, tagged with size, quality, and seeders so you can see what will download fast:
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

TorrentX does not apply a download rate cap. It uses DHT, local peer discovery, peer exchange, tracker discovery, rarest-piece selection, and a 250-peer connection budget to find healthy peers quickly. Actual speed is still limited by the torrent's available seeders, their upload capacity, your router, and your ISP.

You can tune the connection budget before launch when needed:

```powershell
$env:TORRENTX_MAX_CONNS = "400" # 55-800, default 250
npx torrentx
```

`TORRENTX_MAX_WEB_CONNS` (1-64), `TORRENTX_STORE_CACHE_SLOTS` (8-256), and `TORRENTX_DOWNLOAD_STRATEGY` (`rarest`, the default, or `sequential`) are also supported. Set `TORRENTX_TRACKERS` to a comma- or newline-separated tracker list to replace the built-in list.

---

## What it searches

A short, hand-picked list of trusted indices:
*   **Games:** Sourced from **FitGirl Repacks** alone, ensuring a long, trusted track record for executable content.
*   **Anime:** Sourced from **Nyaa**, the premier anime index.
*   **Movies, TV, and General:** Sourced from **YTS**, **EZTV**, and **The Pirate Bay**.
*   **Fallback Pages:** Sourced from **FreeMediaHeckYeah (FMHY)** to get working streaming or DDL links when torrents are dead.

If a source is down, the search carries on without it, and TorrentX tells you in the footer which index is offline.

---

## Command Line Interface (CLI)

You can also run direct searches or manage downloads directly from the command line:

```bash
# Non-interactive search
torrentx search "ubuntu"
torrentx movie "dune" --quality 1080p --min-seeds 50

# Actions on recent results
torrentx open 2
torrentx export 2 magnet.txt

# Download status
torrentx downloads
torrentx dl --json
```



---

---

## Troubleshooting

### 1. Source timeouts or blocked statuses
TorrentX races its mirror domains and shows the real reason a source failed: `timeout`, `blocked`, `limited`, `changed`, or `unreachable`. A timeout across every mirror usually means the network is blocking or blackholing that site's traffic; it is not a parser failure inside TorrentX.

In many regions, ISPs block public torrent search endpoints at the network level. For simple DNS blocks, changing DNS settings to Cloudflare (1.1.1.1) can help:

#### How to set Cloudflare DNS (Windows PowerShell as Admin):
```powershell
# 1. Find your active adapter name (usually "Wi-Fi" or "Ethernet")
Get-NetAdapter | Where-Object Status -eq Up

# 2. Set Cloudflare DNS (replace "Wi-Fi" with your adapter name if different)
Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ServerAddresses ("1.1.1.1","1.0.0.1")

# 3. Flush the DNS resolver cache
ipconfig /flushdns
```

If your network still blocks a source, TorrentX can route source requests through a compatible proxy that you run or explicitly trust. There is no built-in proxy, so searches are never sent to a third party by default. Set `TORRENTX_SOURCE_PROXY` to a URL template containing `{url}`:

```powershell
$env:TORRENTX_SOURCE_PROXY = "https://proxy.example/fetch?target={url}"
npx torrentx
```

#### How to restore/unset DNS back to default:
```powershell
Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ResetServerAddresses
ipconfig /flushdns
```

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

Your files stay on your disk, and nothing routes through a central server; TorrentX only talks to the torrent network directly. Once a download finishes it keeps seeding by default, sharing it back so the next person can find it just as easily. The network only works because people pass things along, and even a few minutes makes a real difference. If you'd rather not, opt out anytime: open the Seeding tab, press p to pause or stop any item, and press it again to pick it back up. Always your call.

---

## License

MIT
