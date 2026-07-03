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
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xml,application/rss+xml,application/json;q=0.9,*/*;q=0.8",
        "user-agent": this.config.userAgent,
      },
      redirect: "follow",
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      throw new HttpError(`HTTP ${response.status}`, response.status, url);
    }
    return response.text();
  }

  async json<T>(url: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": this.config.userAgent,
      },
      redirect: "follow",
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      throw new HttpError(`HTTP ${response.status}`, response.status, url);
    }
    return response.json() as Promise<T>;
  }
}
