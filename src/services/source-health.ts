import { readFile, writeFile, mkdir } from "node:fs/promises";
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

const DEFAULT_TIMEOUT = 8_000;
const MIN_TIMEOUT = 3_000;
const MAX_TIMEOUT = 15_000;
const DECAY_FACTOR = 0.7; // Weight for historical average vs new observation
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // Discard metrics older than 7 days

export class SourceHealthTracker {
  private metrics = new Map<string, SourceMetrics>();
  private readonly filePath: string;
  private dirty = false;

  constructor(filePath?: string) {
    this.filePath =
      filePath ??
      path.join(
        process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
        "torrentx",
        "source-health.json",
      );
  }

  /** Load persisted metrics from disk. Call once at startup. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as PersistedMetrics;
      const now = Date.now();
      for (const [id, m] of Object.entries(data)) {
        // Discard stale metrics
        if (now - m.lastSeen > MAX_AGE_MS) continue;
        this.metrics.set(id, m);
      }
    } catch {
      // First run or corrupt file — start fresh
    }
  }

  /** Persist metrics to disk. Call on shutdown or periodically. */
  async save(): Promise<void> {
    if (!this.dirty) return;
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const data: PersistedMetrics = Object.fromEntries(this.metrics);
      await writeFile(this.filePath, JSON.stringify(data), "utf8");
      this.dirty = false;
    } catch {
      // Non-critical — don't crash on I/O errors
    }
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

  /** Record a source failure (timeout, network error, etc.). */
  recordFailure(sourceId: string): void {
    const existing = this.metrics.get(sourceId);
    const now = Date.now();

    if (existing) {
      existing.failures++;
      existing.lastSeen = now;
      existing.learnedReliability = this.computeReliability(existing);
    } else {
      this.metrics.set(sourceId, {
        avgResponseMs: DEFAULT_TIMEOUT,
        successes: 0,
        failures: 1,
        lastSeen: now,
        adaptiveTimeoutMs: DEFAULT_TIMEOUT,
        learnedReliability: 0.3,
      });
    }
    this.dirty = true;
  }

  /** Get the adaptive timeout for a source based on its historical performance. */
  getTimeout(sourceId: string, fallback = DEFAULT_TIMEOUT): number {
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
}
