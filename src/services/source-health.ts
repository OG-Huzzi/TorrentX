import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Tracks per-source performance metrics across sessions to enable:
 * - Adaptive timeouts (slow sources get more time, fast ones get less)
 * - Reliability learning (sources that fail often get deprioritized)
 * - Historical success rates for smarter source selection
 */

export interface SourceMetrics {
  /** Rolling average response time in ms */
  avgResponseMs: number;
  /** Number of successful searches */
  successes: number;
  /** Number of failed searches */
  failures: number;
  /** Last time this source was queried (epoch ms) */
  lastSeen: number;
  /** Adaptive timeout derived from historical performance */
  adaptiveTimeoutMs: number;
  /** Learned reliability score 0..1 (blends with static reliability) */
  learnedReliability: number;
}

interface PersistedMetrics {
  [sourceId: string]: SourceMetrics;
}

/** Current on-disk schema version. Bump when the shape changes. */
const HEALTH_VERSION = 1;

interface HealthEnvelope {
  version: number;
  sources: PersistedMetrics;
}

const DEFAULT_TIMEOUT = 8_000;
const MIN_TIMEOUT = 3_000;
const MAX_TIMEOUT = 15_000;
const DECAY_FACTOR = 0.7; // Weight for historical average vs new observation
const TIMEOUT_BACKOFF = 1.5; // Timeout growth after a run that timed out
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // Discard metrics older than 7 days

export class SourceHealthTracker {
  private metrics = new Map<string, SourceMetrics>();
  private readonly filePath: string;
  private readonly defaultTimeoutMs: number;
  private dirty = false;
  /** Serialise writes so concurrent save() calls don't race on rename. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    filePath?: string,
    options: { defaultTimeoutMs?: number } = {},
  ) {
    this.filePath =
      filePath ??
      path.join(
        process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
        "torrentx",
        "source-health.json",
      );
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT;
  }

  /** Load persisted metrics from disk. Call once at startup. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      let data: PersistedMetrics | null = null;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as HealthEnvelope).version === HEALTH_VERSION &&
        typeof (parsed as HealthEnvelope).sources === "object" &&
        (parsed as HealthEnvelope).sources !== null
      ) {
        data = (parsed as HealthEnvelope).sources;
      } else if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { version?: unknown }).version === undefined
      ) {
        // Legacy pre-0.3.0 format: a bare map of metrics.
        data = parsed as PersistedMetrics;
      }
      if (data) {
        const now = Date.now();
        for (const [id, m] of Object.entries(data)) {
          // Discard stale metrics
          if (now - m.lastSeen > MAX_AGE_MS) continue;
          // Runs recorded this session (before load finished) are newer.
          if (this.metrics.has(id)) continue;
          this.metrics.set(id, m);
        }
        this.dirty = true; // Persist back in enveloped format on next save
      } else {
        await this.backupCorrupt();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await this.backupCorrupt();
      }
      // First run or corrupt file — start fresh
    }
  }

  /** Persist metrics to disk. Call on shutdown or periodically. */
  async save(): Promise<void> {
    if (!this.dirty) return;
    const snapshot: PersistedMetrics = Object.fromEntries(this.metrics);
    this.dirty = false;
    const work = this.writeQueue.then(async () => {
      try {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        const envelope: HealthEnvelope = {
          version: HEALTH_VERSION,
          sources: snapshot,
        };
        const tmp = `${this.filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
        await writeFile(tmp, JSON.stringify(envelope), "utf8");
        await rename(tmp, this.filePath);
      } catch {
        this.dirty = true; // Retry on the next save
        // Non-critical — don't crash on I/O errors
      }
    });
    this.writeQueue = work.catch(() => {});
    await work;
  }

  /** Record a successful source response. */
  recordSuccess(sourceId: string, responseMs: number): void {
    const existing = this.metrics.get(sourceId);
    const now = Date.now();

    if (existing) {
      existing.avgResponseMs = existing.avgResponseMs * DECAY_FACTOR + responseMs * (1 - DECAY_FACTOR);
      existing.successes++;
      existing.lastSeen = now;
      existing.adaptiveTimeoutMs = this.computeTimeout(existing.avgResponseMs);
      existing.learnedReliability = this.computeReliability(existing);
    } else {
      this.metrics.set(sourceId, {
        avgResponseMs: responseMs,
        successes: 1,
        failures: 0,
        lastSeen: now,
        adaptiveTimeoutMs: this.computeTimeout(responseMs),
        learnedReliability: 0.8,
      });
    }
    this.dirty = true;
  }

  /**
   * Record a source failure (timeout, network error, etc.).
   *
   * A timeout also widens the source's adaptive timeout: it is otherwise
   * only derived from successful runs, so a source that got slower would
   * keep timing out at its old, short budget and never recover.
   */
  recordFailure(sourceId: string, options: { timedOut?: boolean } = {}): void {
    const existing = this.metrics.get(sourceId);
    const now = Date.now();

    if (existing) {
      existing.failures++;
      existing.lastSeen = now;
      existing.learnedReliability = this.computeReliability(existing);
      if (options.timedOut) {
        existing.adaptiveTimeoutMs = Math.round(
          Math.min(MAX_TIMEOUT, existing.adaptiveTimeoutMs * TIMEOUT_BACKOFF),
        );
      }
    } else {
      this.metrics.set(sourceId, {
        avgResponseMs: this.defaultTimeoutMs,
        successes: 0,
        failures: 1,
        lastSeen: now,
        adaptiveTimeoutMs: this.defaultTimeoutMs,
        learnedReliability: 0.3,
      });
    }
    this.dirty = true;
  }

  /** Get the adaptive timeout for a source based on its historical performance. */
  getTimeout(sourceId: string, fallback = this.defaultTimeoutMs): number {
    const m = this.metrics.get(sourceId);
    return m?.adaptiveTimeoutMs ?? fallback;
  }

  /** Get the learned reliability for a source (0..1). */
  getLearnedReliability(sourceId: string): number | undefined {
    return this.metrics.get(sourceId)?.learnedReliability;
  }

  /** Get effective reliability blending static + learned. */
  getEffectiveReliability(sourceId: string, staticReliability: number): number {
    const learned = this.metrics.get(sourceId)?.learnedReliability;
    if (learned === undefined) return staticReliability;
    // Weight learned 60% once we have enough data points
    const m = this.metrics.get(sourceId)!;
    const confidence = Math.min(1, (m.successes + m.failures) / 10);
    return staticReliability * (1 - 0.6 * confidence) + learned * 0.6 * confidence;
  }

  private computeTimeout(avgResponseMs: number): number {
    // Set timeout to 2.5x the average response time, clamped
    return Math.round(Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, avgResponseMs * 2.5)));
  }

  private computeReliability(m: SourceMetrics): number {
    const total = m.successes + m.failures;
    if (total === 0) return 0.5;
    // Bayesian average with prior of 0.7 (most sources work most of the time)
    const priorWeight = 3;
    return (m.successes + 0.7 * priorWeight) / (total + priorWeight);
  }

  private backupCorrupt(): Promise<void> {
    return rename(
      this.filePath,
      `${this.filePath}.corrupt-${Date.now()}`,
    ).catch(() => {});
  }
}
