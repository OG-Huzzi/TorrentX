# Security

Do not report source downtime as a security issue.

Report vulnerabilities privately through the repository's security advisory flow. Include reproduction steps, affected versions, and platform details.

TorrentX never executes downloaded content. Magnet and torrent URLs are passed only to explicit clipboard, export, or operating-system open actions.

## Known advisories

`npm audit` reports high-severity advisories against the `ip` package
([GHSA-2p57-rm9w-gvfp](https://github.com/advisories/GHSA-2p57-rm9w-gvfp)).
It arrives transitively through `webtorrent → torrent-discovery →
bittorrent-tracker`, and **every published version of `ip` is affected** — the
package is unmaintained and the fix has to come from upstream
(`bittorrent-tracker` replacing it). TorrentX only uses it for tracker peer
address handling; the advisory concerns misclassification of public/private
IP ranges.

**Do not run `npm audit fix --force`**: it "fixes" the advisory by downgrading
`webtorrent` to 0.7.3 (an incompatible decade-old release) and will break the
app.
