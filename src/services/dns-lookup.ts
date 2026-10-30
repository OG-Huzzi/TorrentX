import { lookup as systemLookup } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";

export interface LookupAddress {
  address: string;
  family: number;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | LookupAddress[],
  family?: number,
) => void;

interface LookupOptions {
  all?: boolean;
  family?: number;
  hints?: number;
  verbatim?: boolean;
}

const DEFAULT_PROVIDERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
];
const POSITIVE_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 60_000;
const RESOLVE_TIMEOUT_MS = 8_000;

interface CacheEntry {
  addresses: LookupAddress[];
  expiresAt: number;
}

function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(": ");
}

/**
 * DNS-over-HTTPS lookup with caching, usable as node's `dns.lookup`.
 *
 * Several ISPs hijack DNS for blocked domains and answer with a sinkhole
 * address (often serving a bogus TLS certificate there). Resolving through
 * HTTPS defeats that interception.
 *
 * In DoH mode the system resolver is never consulted for hostnames — a
 * silent fallback to it would hand back the very sinkhole answers DoH exists
 * to bypass. Providers are tried in order (Cloudflare, then Google) before a
 * lookup fails outright; IP literals pass straight through.
 */
export function createDohLookup(customUrl?: string) {
  const providers = customUrl ? [customUrl] : DEFAULT_PROVIDERS;
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<LookupAddress[]>>();
  // A private dispatcher: the pooled scrape dispatcher may itself use this
  // lookup function, so DoH queries must not route through it.
  const dohAgent = new Agent({ connect: { timeout: RESOLVE_TIMEOUT_MS } });

  async function queryProvider(
    provider: string,
    hostname: string,
    type: 1 | 28,
  ): Promise<{ addresses: LookupAddress[]; ttlMs?: number }> {
    const url = `${provider}${provider.includes("?") ? "&" : "?"}name=${encodeURIComponent(hostname)}&type=${type}`;
    const response = await undiciFetch(url, {
      headers: { accept: "application/dns-json" },
      dispatcher: dohAgent,
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`DoH ${response.status}`);
    const payload = (await response.json()) as {
      Status?: number;
      Answer?: Array<{ type?: number; data?: string; TTL?: number }>;
    };
    if (payload.Status !== 0) return { addresses: [] };

    const addresses: LookupAddress[] = [];
    let ttlMs: number | undefined;
    for (const answer of payload.Answer ?? []) {
      if (answer.type === type && answer.data) {
        const address = answer.data.includes("%")
          ? answer.data.split("%")[0]!
          : answer.data;
        addresses.push({ address, family: type === 1 ? 4 : 6 });
        if (answer.TTL) {
          ttlMs = Math.min(ttlMs ?? POSITIVE_TTL_MS, Math.max(30_000, answer.TTL * 1000));
        }
      }
    }
    return { addresses, ...(ttlMs !== undefined ? { ttlMs } : {}) };
  }

  async function resolve(hostname: string): Promise<LookupAddress[]> {
    const cached = cache.get(hostname);
    if (cached && cached.expiresAt > Date.now()) return cached.addresses;

    const pending = inflight.get(hostname);
    if (pending) return pending;

    const work = (async () => {
      let lastError: unknown;
      let sawEmptyAnswer = false;
      for (const provider of providers) {
        try {
          const [a, aaaa] = await Promise.all([
            queryProvider(provider, hostname, 1),
            queryProvider(provider, hostname, 28),
          ]);
          const found = [...a.addresses, ...aaaa.addresses];
          if (found.length > 0) {
            cache.set(hostname, {
              addresses: found,
              expiresAt: Date.now() + (a.ttlMs ?? aaaa.ttlMs ?? POSITIVE_TTL_MS),
            });
            return found;
          }
          sawEmptyAnswer = true;
        } catch (error) {
          lastError = error;
        }
      }
      if (sawEmptyAnswer) {
        // Every reachable provider answered with no records.
        cache.set(hostname, { addresses: [], expiresAt: Date.now() + NEGATIVE_TTL_MS });
        throw Object.assign(new Error(`DoH: no address for ${hostname}`), {
          code: "ENOTFOUND",
        });
      }
      throw Object.assign(
        new Error(
          `DNS-over-HTTPS failed for ${hostname}: ${describeError(lastError)}`,
        ),
        { code: "EAI_AGAIN" },
      );
    })();

    inflight.set(hostname, work);
    work.finally(() => inflight.delete(hostname)).catch(() => {});
    return work;
  }

  function lookup(
    hostname: string,
    options: LookupOptions | number | undefined,
    callback?: LookupCallback,
  ): void {
    // Match node's dns.lookup overloads: lookup(host, cb) / lookup(host, opts, cb)
    let opts: LookupOptions = {};
    let cb: LookupCallback;
    if (typeof options === "function") {
      cb = options as LookupCallback;
    } else {
      opts = typeof options === "number" ? { family: options } : (options ?? {});
      cb = callback!;
    }

    const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
    if (isIpLiteral) {
      // Literals are un-hijackable; node's lookup is safe here.
      systemLookup(hostname, { all: true }, (err, addresses) => {
        if (err) return cb(err);
        const list = Array.isArray(addresses)
          ? addresses
          : [{ address: hostname, family: hostname.includes(":") ? 6 : 4 }];
        finish(list);
      });
      return;
    }

    resolve(hostname).then(finish, (err) => cb(err as NodeJS.ErrnoException));

    function finish(addresses: LookupAddress[]) {
      const filtered =
        opts.family === 4
          ? addresses.filter((entry) => entry.family === 4)
          : opts.family === 6
            ? addresses.filter((entry) => entry.family === 6)
            : addresses;
      if (filtered.length === 0) {
        return cb(
          Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }),
        );
      }
      if (opts.all) return cb(null, filtered);
      cb(null, filtered[0]!.address, filtered[0]!.family);
    }
  }

  return lookup;
}
