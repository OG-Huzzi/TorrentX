/**
 * webtorrent (verified against 3.0.21, pinned exactly in package.json) has two
 * crash bugs that fire from its own timers/handlers and cannot be contained at
 * a call site:
 *
 * 1. Null-piece invariant violation: `pieces[i] === null` should imply
 *    `bitfield.get(i) === true`. _markVerified() (lib/torrent.js) releases a
 *    piece by setting it to null, but several call sites read a piece whenever
 *    the bitfield bit is unset and assume it must therefore be non-null. When
 *    the two fall out of sync the process dies with:
 *
 *      TypeError: Cannot read properties of null (reading 'length')
 *      TypeError: Cannot read properties of null (reading 'missing')
 *
 *    Each patch treats a null piece as verified, matching _markVerified().
 *
 * 2. Unhandled uTP 'error' events: peer connections attach error handlers with
 *    once() (lib/torrent.js _drain, lib/peer.js onConnect). After the first
 *    error the listener is gone; a second uTP ECONNRESET (emitted from
 *    Connection._onclose) then surfaces as an unhandled 'error' event and
 *    kills the whole process. The patches make the listeners persistent.
 *
 * This script is intentionally non-fatal: if a future webtorrent version
 * changes these files, the patch simply cannot be applied and installs keep
 * working. DownloadEngine verifies the patches at runtime (see
 * src/services/download-engine.ts) and fails with a clear error if they are
 * missing, so a failed patch is never silently ignored.
 *
 * Re-run after every `npm install` (wired up via `postinstall`).
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Locate webtorrent the way Node does, not relative to this script: in a
 * consumer install (`npx torrentx`, `npm i -g torrentx`) npm hoists it to the
 * top-level node_modules, beside torrentx rather than inside it.
 */
function resolveLibDir() {
  const entry = createRequire(import.meta.url).resolve("webtorrent");
  return pathToFileURL(`${join(dirname(entry), "lib")}/`);
}

const PATCHES = [
  {
    name: "downloaded getter",
    file: "torrent.js",
    broken: `      } else { // "in progress" data
        const piece = this.pieces[index]
        downloaded += (piece.length - piece.missing)
      }`,
    fixed: `      } else { // "in progress" data
        const piece = this.pieces[index]
        // A null piece means _markVerified() already released it; the bitfield
        // bit can lag behind, so treat it as a fully downloaded piece.
        downloaded += piece
          ? (piece.length - piece.missing)
          : ((index === len - 1) ? this.lastPieceLength : this.pieceLength)
      }`,
  },
  {
    name: "speedRanker piece picker",
    file: "torrent.js",
    broken: `        if (!tries || self.bitfield.get(index)) return true

        let missing = self.pieces[index].missing`,
    fixed: `        if (!tries || self.bitfield.get(index)) return true

        // A null piece is already verified, same as a set bitfield bit.
        const rankedPiece = self.pieces[index]
        if (!rankedPiece) return true

        let missing = rankedPiece.missing`,
  },
  {
    name: "_request piece reservation",
    file: "torrent.js",
    broken: `    const piece = self.pieces[index]
    let reservation = isWebSeed ? piece.reserveRemaining() : piece.reserve()`,
    fixed: `    const piece = self.pieces[index]
    // A null piece is already verified, same as the bitfield check above.
    if (!piece) return false
    let reservation = isWebSeed ? piece.reserveRemaining() : piece.reserve()`,
  },
  {
    name: "hotswap request cancel",
    file: "torrent.js",
    broken: `      this.pieces[index].cancel((req.offset / Piece.BLOCK_LENGTH) | 0)`,
    fixed: `      // Nothing to cancel if the piece was verified and released.
      this.pieces[index]?.cancel((req.offset / Piece.BLOCK_LENGTH) | 0)`,
  },
  {
    name: "_drain connection error handler",
    file: "torrent.js",
    broken: `    conn.once('error', err => {
      donePending()
      peer.destroy(err)
    })`,
    fixed: `    conn.on('error', err => {
      // Persistent: uTP can emit several errors per connection (e.g.
      // ECONNRESET from _onclose); once() would leave later ones unhandled
      // and crash the process. peer.destroy() is a no-op once destroyed.
      donePending()
      peer.destroy(err)
    })`,
  },
  {
    name: "peer onConnect error handler",
    file: "peer.js",
    broken: `    conn.once('error', err => {
      this.destroy(err)
    })`,
    fixed: `    conn.on('error', err => {
      // Persistent: see the _drain patch in torrent.js.
      if (!this.destroyed) this.destroy(err)
    })`,
  },
];

async function patchWebtorrent(libDir) {
  const files = new Map();

  for (const { name, file, broken, fixed } of PATCHES) {
    if (!files.has(file)) {
      files.set(file, await readFile(new URL(file, libDir), "utf8"));
    }
    const source = files.get(file);

    if (source.includes(fixed)) {
      console.log(`webtorrent: ${name} — already patched.`);
      continue;
    }
    if (source.includes(broken)) {
      files.set(file, source.replace(broken, fixed));
      console.log(`webtorrent: ${name} — patched.`);
      continue;
    }
    console.warn(
      `webtorrent: ${name} — expected code not found; the dependency ` +
        `probably changed version. Downloads will refuse to start until ` +
        `scripts/patch-webtorrent.mjs is updated for the new version.`,
    );
  }

  for (const [file, source] of files) {
    await writeFile(new URL(file, libDir), source, "utf8");
  }
}

// Intentionally exit 0 even when patches cannot be applied: a broken npm
// install is worse than an unpatched dependency, and DownloadEngine fails
// fast at runtime when the patches are missing.
try {
  await patchWebtorrent(resolveLibDir());
} catch (error) {
  console.warn(
    `webtorrent: could not apply patches (${error instanceof Error ? error.message : String(error)}). ` +
      "Downloads will refuse to start until `node scripts/patch-webtorrent.mjs` succeeds.",
  );
}
