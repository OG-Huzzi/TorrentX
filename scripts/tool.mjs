/**
 * Tool runner for npm scripts.
 *
 * Executes `node <tool> [...args]` with a working ESBUILD_BINARY_PATH.
 * esbuild ships a native binary that must be executable; on filesystems
 * without exec bits (e.g. NTFS/FUSE mounts) spawning it fails with EACCES.
 * In that case we copy the binary into the OS temp dir (which does allow
 * execution) and point ESBUILD_BINARY_PATH at the copy. On normal
 * filesystems this is a cheap no-op.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [tool, ...args] = process.argv.slice(2);

if (!tool) {
  console.error("usage: node scripts/tool.mjs <tool-script> [...args]");
  process.exit(2);
}

function resolveEsbuildBinary() {
  const platform =
    process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const name = process.platform === "win32" ? "esbuild.exe" : "esbuild";
  return join(root, "node_modules", "@esbuild", `${platform}-${arch}`, "bin", name);
}

function canExecute(binary) {
  const probe = spawnSync(binary, ["--version"], { stdio: "ignore" });
  return probe.status === 0;
}

function ensureExecutableEsbuild(env) {
  const binary = resolveEsbuildBinary();
  if (!existsSync(binary) || canExecute(binary)) return;

  let version = "x";
  try {
    version = JSON.parse(
      readFileSync(join(root, "node_modules", "esbuild", "package.json"), "utf8"),
    ).version;
  } catch {}

  const name = process.platform === "win32" ? `esbuild-${version}.exe` : `esbuild-${version}`;
  const cacheDir = join(tmpdir(), "torrentx-bin");
  const cached = join(cacheDir, name);
  if (!existsSync(cached)) {
    mkdirSync(cacheDir, { recursive: true });
    copyFileSync(binary, cached);
    try {
      chmodSync(cached, 0o755);
    } catch {
      // Windows has no exec bit; the copy is executable by default.
    }
  }
  env.ESBUILD_BINARY_PATH = cached;
}

const env = { ...process.env };
ensureExecutableEsbuild(env);

const child = spawnSync(process.execPath, [tool, ...args], {
  stdio: "inherit",
  env,
});
process.exit(child.status ?? 1);
