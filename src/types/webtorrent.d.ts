declare module "webtorrent" {
  import { EventEmitter } from "node:events";

  interface WebTorrentOptions {
    maxConns?: number;
    dht?: boolean | Record<string, unknown>;
    tracker?: boolean | Record<string, unknown>;
    lsd?: boolean;
    utPex?: boolean;
    natUpnp?: boolean;
    natPmp?: boolean;
    utp?: boolean;
    seedOutgoingConnections?: boolean;
    downloadLimit?: number;
    uploadLimit?: number;
    [key: string]: unknown;
  }

  interface TorrentOptions {
    path?: string;
    announce?: string[];
    destroyStoreOnDestroy?: boolean;
    maxWebConns?: number;
    storeCacheSlots?: number;
    strategy?: "sequential" | "rarest";
    [key: string]: unknown;
  }

  interface Torrent extends EventEmitter {
    infoHash: string;
    magnetURI: string;
    name: string;
    length: number;
    progress: number;
    downloadSpeed: number;
    uploadSpeed: number;
    uploaded: number;
    downloaded: number;
    numPeers: number;
    ratio: number;
    done: boolean;
    paused: boolean;
    ready: boolean;
    destroyed: boolean;
    files: TorrentFile[];
    torrentFile?: Buffer;
    pause(): void;
    resume(): void;
    destroy(opts?: { destroyStore?: boolean }, cb?: () => void): void;
    deselect(start: number, end: number, priority?: number): void;
    select(start: number, end: number, priority?: number): void;
  }

  interface TorrentFile {
    name: string;
    path: string;
    length: number;
  }

  type OnTorrentCallback = (torrent: Torrent) => void;

  class WebTorrent extends EventEmitter {
    torrents: Torrent[];
    constructor(opts?: WebTorrentOptions);
    add(magnetOrUrl: string | Buffer, opts?: TorrentOptions, onTorrent?: OnTorrentCallback): Torrent;
    add(magnetOrUrl: string | Buffer, onTorrent?: OnTorrentCallback): Torrent;
    remove(torrent: Torrent | string, opts?: { destroyStore?: boolean }, cb?: () => void): void;
    destroy(cb?: () => void): void;
  }

  export default WebTorrent;
  export { Torrent, TorrentFile, TorrentOptions, OnTorrentCallback, WebTorrentOptions };
}
