import type { TorrentXConfig } from "../types/config.js";
import type { SourceAdapter } from "../types/search.js";
import { HttpClient } from "../services/http-client.js";
import { Leet1337xAdapter } from "./1337x.js";
import { BitsearchAdapter } from "./bitsearch.js";
import { BitTorrentedAdapter } from "./bittorrented.js";
import { EztvAdapter } from "./eztv.js";
import { FitGirlAdapter } from "./fitgirl.js";
import { FmhyAdapter } from "./fmhy.js";
import { GloTorrentsAdapter } from "./glotorrents.js";
import { KickAssAdapter } from "./kickass.js";
import { LimeTorrentsAdapter } from "./limetorrents.js";
import { NyaaAdapter } from "./nyaa.js";
import { PirateBayAdapter } from "./piratebay.js";
import { SolidTorrentsAdapter } from "./solidtorrents.js";
import { SubsPleaseAdapter } from "./subsplease.js";
import { TorrentDownloadsAdapter } from "./torrentdownloads.js";
import { TorrentGalaxyAdapter } from "./torrentgalaxy.js";
import { YtsAdapter } from "./yts.js";

export function createDefaultSources(config: TorrentXConfig): SourceAdapter[] {
  const http = new HttpClient(config);
  return [
    new YtsAdapter(http),
    new NyaaAdapter(http),
    new SubsPleaseAdapter(http),
    new EztvAdapter(http),
    new FitGirlAdapter(http),
    new PirateBayAdapter(http),
    new BitTorrentedAdapter(http),
    new Leet1337xAdapter(http),
    new TorrentGalaxyAdapter(http),
    new SolidTorrentsAdapter(http),
    new BitsearchAdapter(http),
    new LimeTorrentsAdapter(http),
    // NOTE: TorrentDownloads, KickAss and GloTorrents are intentionally left out
    // of the default set. Their endpoints/HTML selectors are unverified guesses
    // and could not be validated against live sites, so enabling them risks
    // adding latency and low-quality/no results. The adapters are still exported
    // below so they can be verified and re-enabled once confirmed working.
    new FmhyAdapter(http),
  ];
}

export {
  BitsearchAdapter,
  BitTorrentedAdapter,
  EztvAdapter,
  FitGirlAdapter,
  FmhyAdapter,
  GloTorrentsAdapter,
  KickAssAdapter,
  Leet1337xAdapter,
  LimeTorrentsAdapter,
  NyaaAdapter,
  PirateBayAdapter,
  SolidTorrentsAdapter,
  SubsPleaseAdapter,
  TorrentDownloadsAdapter,
  TorrentGalaxyAdapter,
  YtsAdapter,
};
