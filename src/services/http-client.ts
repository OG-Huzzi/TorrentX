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

export class HttpClient {
  constructor(private readonly config: TorrentXConfig) {}

  async text(url: string, signal?: AbortSignal): Promise<string> {
    const response = await this.request(
      url,
      "text/html,application/xml,application/rss+xml,application/json;q=0.9,*/*;q=0.8",
      signal,
    );
    return response.text();
  }

  async json<T>(url: string, signal?: AbortSignal): Promise<T> {
    const response = await this.request(
      url,
      "application/json,text/plain;q=0.9,*/*;q=0.8",
      signal,
    );
    return response.json() as Promise<T>;
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
}
