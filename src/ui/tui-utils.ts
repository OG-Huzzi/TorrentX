import type { SearchResult } from "../types/search.js";

export type ResultSort = "rank" | "seeds" | "size" | "newest";

const SORTS: readonly ResultSort[] = ["rank", "seeds", "size", "newest"];

export function nextResultSort(sort: ResultSort): ResultSort {
  return SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length]!;
}

export function sortResults(results: readonly SearchResult[], sort: ResultSort): SearchResult[] {
  return [...results].sort((a, b) => {
    if (sort === "seeds") return b.seeders - a.seeders || b.score - a.score;
    if (sort === "size") return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || b.score - a.score;
    if (sort === "newest") {
      return dateValue(b.uploadedAt) - dateValue(a.uploadedAt) || b.score - a.score;
    }
    return b.score - a.score || b.seeders - a.seeders;
  });
}

export function visibleWindow(selected: number, total: number, capacity: number): number {
  if (total <= capacity) return 0;
  const half = Math.floor(capacity / 2);
  return Math.max(0, Math.min(selected - half, total - capacity));
}

export function wrapIndex(index: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (index + delta + total) % total;
}

function dateValue(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
