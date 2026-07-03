import type { SearchFilters, SearchResult } from "../types/search.js";

export function applyFilters(results: SearchResult[], filters: SearchFilters): SearchResult[] {
  return results.filter((result) => {
    if (
      filters.quality &&
      result.quality?.toLowerCase() !== filters.quality.toLowerCase()
    ) {
      return false;
    }
    if (
      filters.source?.length &&
      !filters.source.some((source) => source.toLowerCase() === result.source.toLowerCase())
    ) {
      return false;
    }
    if (filters.minSizeBytes !== undefined && (result.sizeBytes ?? 0) < filters.minSizeBytes) {
      return false;
    }
    if (filters.maxSizeBytes !== undefined && (result.sizeBytes ?? Infinity) > filters.maxSizeBytes) {
      return false;
    }
    if (
      filters.language &&
      result.language &&
      result.language.toLowerCase() !== filters.language.toLowerCase()
    ) {
      return false;
    }
    if (filters.minSeeders !== undefined && result.seeders < filters.minSeeders) {
      return false;
    }
    if (
      filters.codec &&
      result.codec?.toLowerCase() !== filters.codec.toLowerCase()
    ) {
      return false;
    }
    if (filters.mediaType && result.mediaType && result.mediaType !== filters.mediaType) {
      return false;
    }
    return true;
  });
}
