import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { startTor, findTorBinary, torBinaryCandidates } = await import(
  "../src/services/tor-service.js"
);

let workDir: string;
let fakeTor: string;
let exitingTor: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "torrentx-tor-test-"));

  // A stand-in Tor daemon: prints the real log lines, then idles until killed.
  fakeTor = join(workDir, "fake-tor.mjs");
  await writeFile(
    fakeTor,
    `
    setTimeout(() => {
      console.log("Sep 30 12:00:00.000 [notice] Opened Socks listener connection (ready) on 127.0.0.1:39001");
      console.log("Sep 30 12:00:01.000 [notice] Bootstrapped 50% (loading_descriptors): Loading relay descriptors");
      console.log("Sep 30 12:00:02.000 [notice] Bootstrapped 100% (done): Done");
    }, 20);
    setInterval(() => {}, 1000);
    process.on("SIGTERM", () => process.exit(0));
    `,
    "utf8",
  );

  // A daemon that dies immediately, like a broken torrc or locked data dir.
  exitingTor = join(workDir, "exiting-tor.mjs");
  await writeFile(
    exitingTor,
    `console.error("Sep 30 12:00:00.000 [err] tor is already running (data dir locked)"); process.exit(1);`,
    "utf8",
  );
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("startTor", () => {
  it("bootstraps a daemon and reports the SOCKS port", async () => {
    const progress: number[] = [];
    const handle = await startTor({
      binary: process.execPath,
      args: [fakeTor],
      dataDirectory: join(workDir, "data-a"),
      bootstrapTimeoutMs: 10_000,
      onProgress: (percent) => progress.push(percent),
    });

    try {
      expect(handle.socksPort).toBe(39001);
      expect(handle.socksUrl).toBe("socks5h://127.0.0.1:39001");
      expect(progress).toContain(50);
      expect(progress).toContain(100);
    } finally {
      await handle.stop();
    }
  });

  it("surfaces daemon startup errors with the stderr tail", async () => {
    await expect(
      startTor({
        binary: process.execPath,
        args: [exitingTor],
        dataDirectory: join(workDir, "data-b"),
        bootstrapTimeoutMs: 5_000,
      }),
    ).rejects.toThrow(/already running/);
  });

  it("retries in a fresh data directory when Tor reports the real lock message on stdout", async () => {
    const marker = join(workDir, "lock-seen");
    const lockedOnce = join(workDir, "locked-once-tor.mjs");
    await writeFile(
      lockedOnce,
      `
      import { existsSync, writeFileSync } from "node:fs";
      if (!existsSync(${JSON.stringify(marker)})) {
        writeFileSync(${JSON.stringify(marker)}, "");
        console.log("Sep 30 12:00:00.000 [warn] It looks like another Tor process is running with the same data directory.  Waiting 5 seconds to see if it goes away.");
        console.log("Sep 30 12:00:05.000 [err] No, it's still there.  Exiting.");
        process.exit(1);
      }
      console.log("Sep 30 12:00:00.000 [notice] Opened Socks listener connection (ready) on 127.0.0.1:39002");
      console.log("Sep 30 12:00:02.000 [notice] Bootstrapped 100% (done): Done");
      setInterval(() => {}, 1000);
      process.on("SIGTERM", () => process.exit(0));
      `,
      "utf8",
    );

    const handle = await startTor({
      binary: process.execPath,
      args: [lockedOnce],
      dataDirectory: join(workDir, "data-locked"),
      bootstrapTimeoutMs: 10_000,
    });
    try {
      expect(handle.socksPort).toBe(39002);
    } finally {
      await handle.stop();
    }
  });

  it("sets a stale state file aside and retries when bootstrap stalls part-way", async () => {
    const dataDirectory = join(workDir, "data-slow-guards");
    await mkdir(dataDirectory, { recursive: true });
    const state = join(dataDirectory, "state");
    await writeFile(state, "Guard in=default rsa_id=SLOW\n", "utf8");
    const stalls = join(workDir, "stalls-tor.mjs");
    await writeFile(
      stalls,
      `
      import { existsSync } from "node:fs";
      console.log("Sep 30 12:00:00.000 [notice] Opened Socks listener connection (ready) on 127.0.0.1:39005");
      console.log("Sep 30 12:00:00.000 [notice] Bootstrapped 45% (requesting_descriptors): Asking for relay descriptors");
      console.log("Sep 30 12:00:01.000 [notice] Bootstrapped 66% (loading_descriptors): Loading relay descriptors");
      if (!existsSync(${JSON.stringify(state)})) {
        console.log("Sep 30 12:00:02.000 [notice] Bootstrapped 100% (done): Done");
      }
      setInterval(() => {}, 1000);
      process.on("SIGTERM", () => process.exit(0));
      `,
      "utf8",
    );

    const handle = await startTor({
      binary: process.execPath,
      args: [stalls],
      dataDirectory,
      bootstrapTimeoutMs: 10_000,
      stallTimeoutMs: 300,
    });
    try {
      expect(handle.socksPort).toBe(39005);
    } finally {
      await handle.stop();
    }
  });

  it("sets a stale state file aside and retries when bootstrap never leaves 0%", async () => {
    const dataDirectory = join(workDir, "data-stale-guards");
    await mkdir(dataDirectory, { recursive: true });
    const state = join(dataDirectory, "state");
    await writeFile(state, "Guard in=default rsa_id=STALE\n", "utf8");
    const stuckWithState = join(workDir, "stuck-tor.mjs");
    await writeFile(
      stuckWithState,
      `
      import { existsSync } from "node:fs";
      console.log("Sep 30 12:00:00.000 [notice] Opened Socks listener connection (ready) on 127.0.0.1:39004");
      console.log("Sep 30 12:00:00.000 [notice] Bootstrapped 0% (starting): Starting");
      if (!existsSync(${JSON.stringify(state)})) {
        console.log("Sep 30 12:00:01.000 [notice] Bootstrapped 100% (done): Done");
      }
      setInterval(() => {}, 1000);
      process.on("SIGTERM", () => process.exit(0));
      `,
      "utf8",
    );

    const handle = await startTor({
      binary: process.execPath,
      args: [stuckWithState],
      dataDirectory,
      bootstrapTimeoutMs: 10_000,
      stallTimeoutMs: 300,
    });
    try {
      expect(handle.socksPort).toBe(39004);
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(dataDirectory);
      expect(entries).not.toContain("state");
      expect(entries.some((name) => name.startsWith("state.stale-"))).toBe(true);
    } finally {
      await handle.stop();
    }
  });

  it("parses log lines split across output chunks", async () => {
    const splitting = join(workDir, "split-tor.mjs");
    await writeFile(
      splitting,
      `
      const write = (text, delay) => setTimeout(() => process.stdout.write(text), delay);
      write("Sep 30 12:00:00.000 [notice] Opened Socks listener connection (ready) on 127.0.0.1:39003\\n", 10);
      write("Sep 30 12:00:02.000 [notice] Bootstrapped 10", 40);
      write("0% (done): Done\\n", 80);
      setInterval(() => {}, 1000);
      process.on("SIGTERM", () => process.exit(0));
      `,
      "utf8",
    );

    const progress: number[] = [];
    const handle = await startTor({
      binary: process.execPath,
      args: [splitting],
      dataDirectory: join(workDir, "data-split"),
      bootstrapTimeoutMs: 5_000,
      onProgress: (percent) => progress.push(percent),
    });
    try {
      expect(progress).toEqual([100]);
    } finally {
      await handle.stop();
    }
  });

  it("times out when bootstrap never completes", async () => {
    const silent = join(workDir, "silent-tor.mjs");
    await writeFile(silent, `setInterval(() => {}, 1000);`, "utf8");

    await expect(
      startTor({
        binary: process.execPath,
        args: [silent],
        dataDirectory: join(workDir, "data-c"),
        bootstrapTimeoutMs: 300,
      }),
    ).rejects.toThrow(/timed out/);
  });

  it("explains how to install Tor when no client exists", async () => {
    await expect(
      startTor({
        binary: join(workDir, "does-not-exist"),
        args: [fakeTor],
      }),
    ).rejects.toThrow(/not executable|No Tor client found/);
  });
});

describe("findTorBinary", () => {
  it("prefers TORRENTX_TOR_BINARY", async () => {
    const custom = join(workDir, "my-tor");
    await writeFile(custom, "", "utf8");

    const found = findTorBinary({ TORRENTX_TOR_BINARY: custom, PATH: "/nonexistent" });
    expect(found).toBe(custom);
  });

  it("searches PATH for a tor executable", async () => {
    const pathDir = join(workDir, "path-with-tor");
    await mkdir(pathDir, { recursive: true });
    const torFile = join(pathDir, process.platform === "win32" ? "tor.exe" : "tor");
    await writeFile(torFile, "", "utf8");

    expect(findTorBinary({ PATH: pathDir })).toBe(torFile);
    expect(torBinaryCandidates({ PATH: pathDir })).toContain(torFile);
  });
});
