import { Agent, buildConnector, ProxyAgent, setGlobalDispatcher, type Dispatcher } from "undici";
import type { TorrentXConfig } from "../types/config.js";
import { createDohLookup } from "./dns-lookup.js";
import { buildSocks5Connector } from "./proxy.js";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    /** Present on 429 responses that carried a Retry-After header (capped). */
    readonly retryAfterMs?: number,
    /** The site answered with a bot-check page (e.g. Cloudflare "Just a moment..."). */
    readonly botCheck = false,
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
 *
 * Note: the dispatcher is a process-wide singleton, first-writer-wins. All
 * HttpClient instances should be constructed with the same TorrentXConfig
 * (the app creates one shared config and one HttpClient per source set).
 */
let pooledDispatcher: Dispatcher | undefined;
/**
 * Direct (non-proxy) dispatcher used as an automatic retry path when the
 * primary dispatcher goes through a proxy and the request fails — many sites
 * block Tor exit nodes while serving ordinary connections fine.
 */
let fallbackDispatcher: Dispatcher | undefined;

/**
 * Bound the TCP/TLS connect timeout to a fraction of the overall source
 * timeout: a slow handshake should not consume the entire request budget,
 * but overly aggressive floors would kill slow mobile networks.
 */
function connectTimeoutMs(sourceTimeoutMs: number): number {
  return Math.min(10_000, Math.max(2_000, Math.round(sourceTimeoutMs / 2)));
}

function buildDirectAgent(config: TorrentXConfig): Agent {
  const connectOptions: Record<string, unknown> = {
    timeout: connectTimeoutMs(config.sourceTimeoutMs),
  };
  if (config.dnsResolver === "doh") {
    connectOptions["lookup"] = createDohLookup(config.dohUrl);
  }
  return new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connections: 64,
    pipelining: 1,
    // cast: undici's BuildOptions union demands `port`, but the connector
    // receives the port per-origin at connect time.
    connect: buildConnector(connectOptions as never),
  });
}

function ensurePooledDispatcher(config: TorrentXConfig): void {
  if (pooledDispatcher) return;

  if (config.socks5Proxy) {
    // SOCKS5 (Tor, `ssh -D`, shadowsocks…): the proxy resolves DNS remotely,
    // which also bypasses ISP DNS hijacking.
    pooledDispatcher = new Agent({
      connect: buildSocks5Connector(
        config.socks5Proxy,
        // The SOCKS handshake includes the proxy's own connection to the
        // destination (a whole Tor circuit), so honour the timeout floor.
        connectTimeoutMs(Math.max(config.sourceTimeoutMs, config.timeoutFloorMs ?? 0)),
      ) as never,
    });
  } else if (config.httpProxy) {
    // Standard HTTP CONNECT proxy (also Tor's HTTPTunnelPort). The proxy
    // resolves the target hostname, so local DNS hijacking is bypassed too.
    pooledDispatcher = new ProxyAgent({ uri: config.httpProxy });
  } else {
    pooledDispatcher = buildDirectAgent(config);
  }

  if (
    (config.socks5Proxy || config.httpProxy) &&
    config.proxyFallback !== false
  ) {
    fallbackDispatcher = buildDirectAgent(config);
  }
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
   * Non-retryable errors (abort, most 4xx) are thrown immediately — except
   * 429 (rate limited), which is retried once honouring the Retry-After
   * header (capped at 2s) to ride out short-lived source rate limits.
   *
   * When a proxy is active and the request still fails, one final attempt is
   * made over a direct connection (sites frequently block Tor exit nodes
   * while serving ordinary connections). Disable with
   * TORRENTX_PROXY_FALLBACK=0 for strict privacy (the default with --tor).
   */
  private async requestWithRetry(
    url: string,
    accept: string,
    signal?: AbortSignal,
    maxRetries = 2,
  ): Promise<Response> {
    try {
      return await this.retryLoop(url, accept, signal, undefined, maxRetries);
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      if (!cancelled && fallbackDispatcher) {
        return this.retryLoop(url, accept, signal, fallbackDispatcher, 0);
      }
      throw error;
    }
  }

  private async retryLoop(
    url: string,
    accept: string,
    signal: AbortSignal | undefined,
    dispatcher: Dispatcher | undefined,
    maxRetries: number,
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        return await this.request(url, accept, signal, dispatcher);
      } catch (err) {
        lastError = err;
        // Don't retry aborts or client errors (4xx)
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
          if (err.status !== 429 || attempt >= maxRetries) throw err;
          await sleep(err.retryAfterMs ?? 1_000, signal);
          continue;
        }
        if (attempt < maxRetries) {
          // Exponential backoff with jitter: ~150-260ms, ~375-650ms
          const delay = 150 * Math.pow(2.5, attempt) * (1 + Math.random() * 0.5);
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
    dispatcher?: Dispatcher,
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
      ...(dispatcher ? { dispatcher } : {}),
    });

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = parseRetryAfterSeconds(response.headers.get("retry-after"));
        throw new HttpError(
          `HTTP 429${retryAfter !== undefined ? ` (retry after ${retryAfter}s)` : ""}`,
          response.status,
          url,
          retryAfter !== undefined ? Math.min(retryAfter * 1_000, 2_000) : undefined,
        );
      }
      // Cloudflare marks interactive challenges with cf-mitigated: a site
      // that only serves those to scripted clients is not "down".
      const botCheck = response.headers.get("cf-mitigated") === "challenge";
      throw new HttpError(
        `HTTP ${response.status}${botCheck ? " (bot check)" : ""}`,
        response.status,
        url,
        undefined,
        botCheck,
      );
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
    const dispatchers = [pooledDispatcher, fallbackDispatcher];
    pooledDispatcher = undefined;
    fallbackDispatcher = undefined;
    for (const dispatcher of dispatchers) {
      if (dispatcher) await dispatcher.close().catch(() => undefined);
    }
  }
}

function parseRetryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  const parsed = Number(header);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.ceil(parsed);
  return undefined;
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
