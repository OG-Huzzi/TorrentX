import { Agent, setGlobalDispatcher } from "undici";
import type { TorrentXConfig } from "../types/config.js";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Node's native `fetch` is powered by undici, and connection reuse is controlled
 * by undici's *dispatcher* — the classic `node:http`/`node:https` Agent objects
 * are silently ignored by fetch. We install a single tuned global dispatcher with
 * aggressive keep-alive so parallel scraping reuses TCP/TLS connections instead of
 * paying a fresh handshake per request (the #1 latency source in meta-search).
 */
let pooledDispatcher: Agent | undefined;

function ensurePooledDispatcher(config: TorrentXConfig): void {
  if (pooledDispatcher) return;
  pooledDispatcher = new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connections: 64,
    pipelining: 1,
    connect: { timeout: Math.max(config.sourceTimeoutMs, 10_000) },
  });
  setGlobalDispatcher(pooledDispatcher);
}

/**
 * Connection-pooled HTTP client with keep-alive, retry with exponential
 * backoff, and per-origin connection limits for maximum throughput.
 */
export class HttpClient {
  constructor(private readonly config: TorrentXConfig) {
    ensurePooledDispatcher(config);
  }

  async text(url: string, signal?: AbortSignal): Promise<string> {
    const response = await this.requestWithRetry(
      url,
      "text/html,application/xml,application/rss+xml,application/json;q=0.9,*/*;q=0.8",
      signal,
    );
    return response.text();
  }

  async json<T>(url: string, signal?: AbortSignal): Promise<T> {
    const response = await this.requestWithRetry(
      url,
      "application/json,text/plain;q=0.9,*/*;q=0.8",
      signal,
    );
    return response.json() as Promise<T>;
  }

  /**
   * Retry transient failures (network errors, 5xx) with exponential backoff.
   * Non-retryable errors (4xx, abort) are thrown immediately.
   */
  private async requestWithRetry(
    url: string,
    accept: string,
    signal?: AbortSignal,
    maxRetries = 2,
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        return await this.request(url, accept, signal);
      } catch (err) {
        lastError = err;
        // Don't retry aborts or client errors (4xx)
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        if (err instanceof HttpError && err.status >= 400 && err.status < 500) throw err;
        if (attempt < maxRetries) {
          // Exponential backoff: 150ms, 400ms
          const delay = 150 * Math.pow(2.5, attempt);
          await sleep(delay, signal);
        }
      }
    }
    throw lastError;
  }

  private async request(
    url: string,
    accept: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const response = await fetch(this.requestUrl(url), {
      headers: {
        accept,
        "user-agent": this.config.userAgent,
        "accept-language": "en-US,en;q=0.9",
        "accept-encoding": "gzip, deflate, br",
        "cache-control": "no-cache",
      },
      redirect: "follow",
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      throw new HttpError(`HTTP ${response.status}`, response.status, url);
    }
    return response;
  }

  private requestUrl(url: string): string {
    const proxy = this.config.sourceProxyUrl?.trim();
    if (!proxy) return url;

    if (proxy.includes("{url}")) {
      return proxy.replaceAll("{url}", encodeURIComponent(url));
    }

    const proxyUrl = new URL(proxy);
    proxyUrl.searchParams.set("url", url);
    return proxyUrl.toString();
  }

  /** Close pooled sockets on shutdown. Safe to call once at process exit. */
  async destroy(): Promise<void> {
    if (!pooledDispatcher) return;
    const dispatcher = pooledDispatcher;
    pooledDispatcher = undefined;
    await dispatcher.close().catch(() => undefined);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
