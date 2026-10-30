import { connect as tlsConnect, type TLSSocket } from "node:tls";
import type { Socket } from "node:net";
import { SocksClient } from "socks";

export interface ParsedProxyUrl {
  hostname: string;
  port: number;
  userId?: string;
  password?: string;
}

export function parseSocksProxyUrl(url: string): ParsedProxyUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid proxy URL: ${url}`);
  }
  const port = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === "http:"
      ? 80
      : 1080;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid proxy port in ${url}`);
  }
  return {
    hostname: parsed.hostname,
    port,
    ...(parsed.username ? { userId: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
  };
}

interface ConnectOptions {
  hostname: string;
  port?: number;
  servername?: string | null;
  protocol?: string;
}

type ConnectCallback = (err: Error | null, socket?: Socket | TLSSocket) => void;

/**
 * Undici connector that dials through a SOCKS5 proxy.
 *
 * DNS is always resolved remotely (socks5h semantics): the destination
 * hostname is handed to the proxy, so a hijacking local resolver never sees
 * the request. This also makes Tor and `ssh -D` tunnels work as a full
 * censorship bypass for source scraping.
 */
export function buildSocks5Connector(proxyUrl: string, timeoutMs: number) {
  const proxy = parseSocksProxyUrl(proxyUrl);

  return (options: ConnectOptions, callback: ConnectCallback): void => {
    const destinationPort =
      Number(options.port) ||
      (options.protocol === "https:" ? 443 : 80);

    SocksClient.createConnection({
      proxy: {
        host: proxy.hostname,
        port: proxy.port,
        type: 5,
        ...(proxy.userId ? { userId: proxy.userId } : {}),
        ...(proxy.password ? { password: proxy.password } : {}),
      },
      command: "connect",
      // The destination host is passed unresolved: the proxy does the DNS.
      destination: { host: options.hostname, port: destinationPort },
      timeout: timeoutMs,
    }).then(
      ({ socket }) => {
        if (options.protocol === "https:") {
          const secure = tlsConnect({
            socket,
            servername: options.servername ?? options.hostname,
          });
          const fail = (err: Error) => {
            socket.destroy();
            callback(err);
          };
          secure.once("secureConnect", () => {
            secure.removeListener("error", fail);
            callback(null, secure);
          });
          secure.once("error", fail);
        } else {
          callback(null, socket);
        }
      },
      (err: Error) => callback(err),
    );
  };
}
