import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import envPaths from "env-paths";

/**
 * Built-in Tor support, modelled on Brave's "Private Window with Tor":
 * TorrentX finds a Tor client on the machine (PATH, Tor Browser installs, or
 * TORRENTX_TOR_BINARY), launches it as a managed daemon with its own SOCKS
 * port, waits for the bootstrap, and routes source traffic through it.
 *
 * Nothing is bundled or downloaded at runtime — Tor is a mature, audited
 * codebase and shipping platform binaries inside an npm package would be a
 * supply-chain liability. Every platform that can run TorrentX can install
 * Tor (or already has it via Tor Browser).
 */

const BOOTSTRAP_TIMEOUT_MS = 120_000;
/** How long bootstrap may go without advancing before the run counts as stuck. */
const STALL_TIMEOUT_MS = 45_000;
const STALLED_MESSAGE = "Tor bootstrap made no progress";

/**
 * What Tor logs when another process holds the data directory. With
 * `--Log notice stdout` these lines arrive on stdout, not stderr:
 *   "It looks like another Tor process is running with the same data directory."
 *   "Couldn't lock ..." / "No, it's still there.  Exiting."
 */
const DATA_DIR_LOCKED =
  /another Tor process is running with the same data directory|couldn't lock|data dir(?:ectory)? locked/i;

export interface TorHandle {
  socksPort: number;
  /** socks5h:// URL — DNS is resolved by Tor, never by the local resolver. */
  socksUrl: string;
  stop(): Promise<void>;
}

export interface StartTorOptions {
  /** Tor executable; defaults to findTorBinary(). */
  binary?: string;
  /** Replace the daemon arguments entirely (used by tests). */
  args?: string[];
  dataDirectory?: string;
  bootstrapTimeoutMs?: number;
  /** Give up on a run whose bootstrap stops advancing for this long (default 45s). */
  stallTimeoutMs?: number;
  onProgress?: (percent: number) => void;
}

function torDataRoot(): string {
  return join(envPaths("torrentx", { suffix: "" }).data, "tor-data");
}

/** Candidate locations of a usable Tor client, most specific first. */
export function torBinaryCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = [];
  const override = env["TORRENTX_TOR_BINARY"];
  if (override) candidates.push(override);

  const exeName = process.platform === "win32" ? "tor.exe" : "tor";
  const pathSeparator = process.platform === "win32" ? ";" : ":";
  for (const dir of (env["PATH"] ?? "").split(pathSeparator)) {
    if (dir.trim()) candidates.push(join(dir.trim(), exeName));
  }

  const home = os.homedir();
  if (process.platform === "win32") {
    for (const base of [
      env["ProgramFiles"] ?? "C:\\Program Files",
      env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      env["LOCALAPPDATA"] ?? join(home, "AppData", "Local"),
    ]) {
      candidates.push(join(base, "Tor Browser", "Browser", "TorBrowser", "Tor", exeName));
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Tor Browser.app/Contents/MacOS/Tor/tor");
    candidates.push(join(home, "Applications", "Tor Browser.app/Contents/MacOS/Tor/tor"));
    candidates.push("/opt/homebrew/bin/tor", "/usr/local/bin/tor", "/opt/local/bin/tor");
  } else {
    candidates.push(
      "/usr/bin/tor",
      "/usr/local/bin/tor",
      join(home, "tor-browser_en-US", "Browser", "TorBrowser", "Tor", "tor"),
      join(home, ".local", "bin", "tor"),
    );
  }
  return candidates;
}

export function findTorBinary(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return torBinaryCandidates(env).find((candidate) => existsSync(candidate));
}

export function torInstallHint(): string {
  if (process.platform === "win32") {
    return "Install Tor Browser (https://www.torproject.org/download/) or set TORRENTX_TOR_BINARY to tor.exe.";
  }
  if (process.platform === "darwin") {
    return "Install Tor Browser (https://www.torproject.org/download/) or `brew install tor`, or set TORRENTX_TOR_BINARY.";
  }
  return "Install Tor (`sudo apt install tor` / `sudo dnf install tor` / `pkg install tor` on Termux) or set TORRENTX_TOR_BINARY.";
}

export async function startTor(options: StartTorOptions = {}): Promise<TorHandle> {
  const binary = options.binary ?? findTorBinary();
  if (!binary) {
    throw new Error(`No Tor client found. ${torInstallHint()}`);
  }

  const baseDir = options.dataDirectory ?? torDataRoot();
  const args = options.args ?? torArgs(baseDir);

  pruneStaleTorData(baseDir);

  let handle: LaunchHandle;
  try {
    handle = await launchWithStallRecovery(binary, args, baseDir, options);
  } catch (error) {
    // Another TorrentX instance may hold the shared data-dir lock.
    const message = error instanceof Error ? error.message : String(error);
    if (DATA_DIR_LOCKED.test(message)) {
      const fallback = join(baseDir, `run-${process.pid}-${Date.now()}`);
      handle = await launch(
        binary,
        options.args ?? torArgs(fallback),
        options,
      );
      handle.cleanupDirs.push(fallback);
    } else {
      throw error;
    }
  }

  return handle;
}

/**
 * Tor keeps its chosen entry guards in <DataDirectory>/state and insists on
 * them. After the network path changes (a VPN switched on, a new ISP route)
 * those guards can be unreachable or crawling, and bootstrap stalls (at 0%,
 * or part-way while loading relay descriptors through them). When bootstrap
 * stops advancing, set the state file aside — Tor rebuilds it and picks
 * fresh guards — and try once more. The cached directory data is kept, so
 * the retry is fast.
 */
async function launchWithStallRecovery(
  binary: string,
  args: string[],
  dataDirectory: string,
  options: StartTorOptions,
): Promise<LaunchHandle> {
  try {
    return await launch(binary, args, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith(STALLED_MESSAGE)) throw error;
    const state = join(dataDirectory, "state");
    if (existsSync(state)) {
      try {
        renameSync(state, `${state}.stale-${Date.now()}`);
      } catch {
        // Unmovable state file: the retry will most likely stall again.
      }
    }
    options.onProgress?.(0);
    return launch(binary, args, options);
  }
}

function torArgs(dataDirectory: string): string[] {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  return [
    "--SocksPort",
    "auto",
    "--DataDirectory",
    dataDirectory,
    "--AvoidDiskWrites",
    "1",
    "--Log",
    "notice stdout",
    "--CookieAuthentication",
    "0",
  ];
}

interface LaunchHandle extends TorHandle {
  cleanupDirs: string[];
}

function launch(
  binary: string,
  args: string[],
  options: StartTorOptions,
): Promise<LaunchHandle> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(binary, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }

    const cleanupDirs: string[] = [];
    let socksPort: number | undefined;
    let bootstrapped = false;
    // Tail of both streams: Tor's own log goes to stdout (--Log notice
    // stdout), early startup failures may go to stderr.
    let outputTail = "";
    const keepTail = (chunk: Buffer) => {
      outputTail = `${outputTail}${chunk.toString()}`.slice(-800);
    };
    // Lines can be split across chunks; only complete lines are parsed.
    let partialLine = "";
    let settled = false;

    const timeout = setTimeout(() => {
      finish(
        new Error(
          `Tor bootstrap timed out after ${options.bootstrapTimeoutMs ?? BOOTSTRAP_TIMEOUT_MS}ms. ` +
            "The network may be blocking Tor — see the README for bridge options.",
        ),
      );
    }, options.bootstrapTimeoutMs ?? BOOTSTRAP_TIMEOUT_MS);
    timeout.unref?.();
    // Restarted whenever the bootstrap percentage advances.
    let lastPercent = -1;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        finish(
          new Error(
            `${STALLED_MESSAGE} for ${options.stallTimeoutMs ?? STALL_TIMEOUT_MS}ms ` +
              `(stuck at ${Math.max(0, lastPercent)}%).`,
          ),
        );
      }, options.stallTimeoutMs ?? STALL_TIMEOUT_MS);
      stallTimer.unref?.();
    };
    armStallTimer();

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(stallTimer);
      if (error) {
        const cleanup = () => {
          for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
          reject(error);
        };
        // Reject only once the daemon is gone: Tor rewrites its state file
        // and releases the data-dir lock on exit, and callers retry against
        // that same directory.
        if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
          void stopProcess(child).then(cleanup);
        } else {
          cleanup();
        }
        return;
      }
      resolve({
        socksPort: socksPort!,
        socksUrl: `socks5h://127.0.0.1:${socksPort}`,
        cleanupDirs,
        async stop() {
          await stopProcess(child);
          for (const dir of cleanupDirs) {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      });
    };

    const considerReady = () => {
      if (socksPort !== undefined && bootstrapped) finish();
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      keepTail(chunk);
      const lines = `${partialLine}${chunk.toString()}`.split(/\r?\n/);
      partialLine = lines.pop() ?? "";
      for (const line of lines) {
        const portMatch = line.match(/Opened Socks listener connection \(ready\) on .+:(\d+)/);
        if (portMatch) {
          socksPort = Number(portMatch[1]);
        }
        const bootstrapMatch = line.match(/Bootstrapped (\d+)%/);
        if (bootstrapMatch) {
          if (Number(bootstrapMatch[1]) > lastPercent) {
            lastPercent = Number(bootstrapMatch[1]);
            armStallTimer();
          }
          options.onProgress?.(Number(bootstrapMatch[1]));
          if (Number(bootstrapMatch[1]) >= 100) bootstrapped = true;
        }
        considerReady();
      }
    });

    child.stderr?.on("data", keepTail);

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(
        error.code === "ENOENT"
          ? new Error(`Tor binary not executable: ${binary}. ${torInstallHint()}`)
          : error,
      );
    });

    child.on("exit", (code) => {
      if (settled) return;
      finish(
        new Error(
          `Tor exited with code ${code} before bootstrap.${outputTail ? ` ${outputTail.trim()}` : ""}`,
        ),
      );
    });
  });
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve();
    }, 5_000);
    killTimer.unref?.();
    child.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(killTimer);
      resolve();
    }
  });
}

/**
 * Remove per-run data directories left behind by crashed runs, and state
 * files set aside by stall recovery (older than a day — anything younger
 * may belong to a concurrent TorrentX instance).
 */
export function pruneStaleTorData(root = torDataRoot()): void {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  try {
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith("run-") && !entry.startsWith("state.stale-")) continue;
      const path = join(root, entry);
      try {
        if (statSync(path).mtimeMs < dayAgo) {
          rmSync(path, { recursive: true, force: true });
        }
      } catch {}
    }
  } catch {}
}
