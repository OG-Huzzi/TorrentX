import type { MediaType, Region, SearchResult } from "../types/search.js";
import { stableHash } from "../utils/hash.js";
import { detectCodec, detectMediaType, detectQuality } from "../utils/text.js";

export function createResult(input: {
  title: string;
  source: string;
  sourceReliability: number;
  sourceId?: string | undefined;
  detailsUrl?: string | undefined;
  magnetUri?: string | undefined;
  torrentUrl?: string | undefined;
  sizeBytes?: number | undefined;
  seeders?: number | undefined;
  leechers?: number | undefined;
  uploadedAt?: string | undefined;
  quality?: string | undefined;
  codec?: string | undefined;
  language?: string | undefined;
  mediaType?: MediaType | undefined;
  region?: Region | undefined;
  trusted?: boolean | undefined;
}): SearchResult {
  const identity = input.magnetUri ?? input.torrentUrl ?? input.detailsUrl ?? input.title;
  return {
    id: stableHash(`${input.source}:${identity}`),
    title: input.title.trim(),
    source: input.source,
    sourceReliability: input.sourceReliability,
    seeders: input.seeders ?? 0,
    leechers: input.leechers ?? 0,
    trusted: input.trusted ?? true,
    score: 0,
    ...optional("quality", input.quality ?? detectQuality(input.title)),
    ...optional("codec", input.codec ?? detectCodec(input.title)),
    ...optional("mediaType", input.mediaType ?? detectMediaType(input.title)),
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    ...(input.detailsUrl ? { detailsUrl: input.detailsUrl } : {}),
    ...(input.magnetUri ? { magnetUri: input.magnetUri } : {}),
    ...(input.torrentUrl ? { torrentUrl: input.torrentUrl } : {}),
    ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
    ...(input.uploadedAt ? { uploadedAt: input.uploadedAt } : {}),
    ...(input.language ? { language: input.language } : {}),
    ...(input.region ? { region: input.region } : {}),
  };
}

export interface MirrorRaceOptions {
  staggerMs?: number;
}

/**
 * Start mirror requests a short time apart and use the first completed one.
 * This prevents a single blackholed domain from consuming the full source
 * timeout before the remaining mirrors are ever tried.
 */
export async function raceMirrors<T>(
  domains: readonly string[],
  request: (domain: string, signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  options: MirrorRaceOptions = {},
): Promise<T> {
  if (domains.length === 0) {
    throw new Error("At least one source mirror is required");
  }

  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  if (signal?.aborted) relayAbort();
  else signal?.addEventListener("abort", relayAbort, { once: true });

  const staggerMs = options.staggerMs ?? 250;
  try {
    return await Promise.any(
      domains.map((domain, index) =>
        waitFor(index * staggerMs, controller.signal).then(() =>
          request(domain, controller.signal),
        ),
      ),
    );
  } catch (error) {
    if (signal?.aborted) throw createAbortError();

    const errors = error instanceof AggregateError ? error.errors : [error];
    throw (
      errors.find((candidate) => !isAbortError(candidate)) ??
      errors.at(-1) ??
      new Error("No source mirror responded")
    );
  } finally {
    controller.abort();
    signal?.removeEventListener("abort", relayAbort);
  }
}

function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(createAbortError());
  if (milliseconds <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]: V });
}
