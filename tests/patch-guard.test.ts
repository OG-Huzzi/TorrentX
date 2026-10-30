import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// These tests exercise verifyWebtorrentPatches' file-level caching, so each
// case re-imports a fresh copy of the module via vi.resetModules().
vi.mock("webtorrent", () => ({ default: class {} }));

const PATCHED_TORRENT = `
  const piece = this.pieces[index]
  downloaded += piece
    ? (piece.length - piece.missing)
    : ((index === len - 1) ? this.lastPieceLength : this.pieceLength)
  const rankedPiece = self.pieces[index]
  if (!rankedPiece) return true
  if (!piece) return false
  let reservation = isWebSeed ? piece.reserveRemaining() : piece.reserve()
  this.pieces[index]?.cancel((req.offset / Piece.BLOCK_LENGTH) | 0)
  conn.on('error', err => {
    // Persistent: uTP can emit several errors per connection (e.g.
    // ECONNRESET from _onclose); once() would leave later ones unhandled
    // and crash the process. peer.destroy() is a no-op once destroyed.
    donePending()
    peer.destroy(err)
  })
`;

const PATCHED_PEER = `
  conn.on('error', err => {
    // Persistent: see the _drain patch in torrent.js.
    if (!this.destroyed) this.destroy(err)
  })
`;

const UNPATCHED_TORRENT = `
  const piece = this.pieces[index]
  downloaded += (piece.length - piece.missing)
  let missing = self.pieces[index].missing
  let reservation = isWebSeed ? piece.reserveRemaining() : piece.reserve()
  this.pieces[index].cancel((req.offset / Piece.BLOCK_LENGTH) | 0)
  conn.once('error', err => {
    donePending()
    peer.destroy(err)
  })
`;

const UNPATCHED_PEER = `
  conn.once('error', err => {
    this.destroy(err)
  })
`;

async function makeLibDir(
  torrent: string,
  peer: string,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "torrentx-guard-"));
  await writeFile(join(dir, "torrent.js"), torrent, "utf8");
  await writeFile(join(dir, "peer.js"), peer, "utf8");
  return dir;
}

describe("verifyWebtorrentPatches", () => {
  it("passes when all patch markers are present", async () => {
    vi.resetModules();
    const dir = await makeLibDir(PATCHED_TORRENT, PATCHED_PEER);
    try {
      const { verifyWebtorrentPatches } = await import(
        "../src/services/download-engine.js"
      );
      expect(() => verifyWebtorrentPatches(dir)).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws a descriptive error when the null-piece patches are missing", async () => {
    vi.resetModules();
    const dir = await makeLibDir(UNPATCHED_TORRENT, PATCHED_PEER);
    try {
      const { verifyWebtorrentPatches } = await import(
        "../src/services/download-engine.js"
      );
      expect(() => verifyWebtorrentPatches(dir)).toThrow(
        /patches are missing/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws when the connection error patches are missing", async () => {
    vi.resetModules();
    const dir = await makeLibDir(PATCHED_TORRENT, UNPATCHED_PEER);
    try {
      const { verifyWebtorrentPatches } = await import(
        "../src/services/download-engine.js"
      );
      expect(() => verifyWebtorrentPatches(dir)).toThrow(
        /peer\.js/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
