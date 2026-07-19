import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SourceHealthTracker } from "../src/services/source-health.js";

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "torrentx-health-"));
  return path.join(dir, "source-health.json");
}

describe("SourceHealthTracker", () => {
  it("clamps adaptive timeout within bounds", () => {
    const tracker = new SourceHealthTracker(":memory:");

    // Very fast source -> clamped to the 3s minimum, not below.
    tracker.recordSuccess("fast", 200);
    expect(tracker.getTimeout("fast")).toBe(3_000);

    // Very slow source -> clamped to the 15s maximum, not above.
    tracker.recordSuccess("slow", 100_000);
    expect(tracker.getTimeout("slow")).toBe(15_000);

    // Unknown source falls back to the provided default.
    expect(tracker.getTimeout("unknown", 9_000)).toBe(9_000);
  });

  it("blends learned reliability with static reliability by confidence", () => {
    const tracker = new SourceHealthTracker(":memory:");

    // No data yet -> returns the static value untouched.
    expect(tracker.getEffectiveReliability("x", 0.9)).toBe(0.9);

    // A source that fails repeatedly should drag effective reliability down.
    for (let i = 0; i < 10; i++) tracker.recordFailure("flaky");
    const effective = tracker.getEffectiveReliability("flaky", 0.9);
    expect(effective).toBeLessThan(0.9);
  });

  it("rewards consistent successes with higher learned reliability", () => {
    const tracker = new SourceHealthTracker(":memory:");
    for (let i = 0; i < 10; i++) tracker.recordSuccess("solid", 500);
    const learned = tracker.getLearnedReliability("solid");
    expect(learned).toBeGreaterThan(0.7);
  });

  it("persists metrics across load/save round-trips", async () => {
    const file = await tempFile();
    const first = new SourceHealthTracker(file);
    first.recordSuccess("yts", 420);
    await first.save();

    const second = new SourceHealthTracker(file);
    await second.load();
    expect(second.getLearnedReliability("yts")).toBeGreaterThan(0);
    expect(second.getTimeout("yts")).toBeGreaterThanOrEqual(3_000);
  });

  it("does not write when nothing changed", async () => {
    const file = await tempFile();
    const tracker = new SourceHealthTracker(file);
    // save() is a no-op because no metrics were recorded (dirty flag is false).
    await tracker.save();
    const reloaded = new SourceHealthTracker(file);
    await reloaded.load(); // Should not throw on a missing file.
    expect(reloaded.getLearnedReliability("anything")).toBeUndefined();
  });
});
