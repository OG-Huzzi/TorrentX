/**
 * Single source of truth for every source domain/mirror TorrentX may contact.
 *
 * Adapters import their mirror list from here and dns-warmup.ts derives its
 * DNS pre-resolution list from the same arrays — so adding or removing a
 * mirror in one place keeps both in sync (they used to drift apart).
 */

// ---- multi-mirror sources (raced by raceMirrors) ----

// accel.li is the API's announced new base URL; yts.gg still serves it too.
// (yts.lt and yts.am only redirect to yts.gg; yts.mx and yts.do are dead.)
export const YTS_DOMAINS = ["movies-api.accel.li", "yts.gg"];

export const EZTV_DOMAINS = [
  "eztvx.to",
  "eztv.re",
  "eztv1.xyz",
  "eztv.wf",
  "eztv.tf",
  "eztv.yt",
];

export const TORRENTGALAXY_DOMAINS = [
  "torrentgalaxy.one",
  "torrentgalaxy.to",
  "torrentgalaxy.mx",
  "tgx.rs",
];


export const LIMETORRENTS_DOMAINS = [
  "www.limetorrents.lol",
  "www.limetorrents.pro",
  "limetorrents.cc",
];

// SolidTorrents now redirects here, and bitsearch.to redirects to .eu.
export const BITSEARCH_DOMAINS = ["bitsearch.eu", "bitsearch.to"];

// ---- single-endpoint sources (hostnames) ----

export const PIRATEBAY_HOST = "apibay.org";
export const NYAA_HOST = "nyaa.si";
export const SUBSPLEASE_HOST = "subsplease.org";
export const FITGIRL_HOST = "fitgirl-repacks.site";
export const FMHY_API_HOST = "api.fmhy.net";

/**
 * Every host worth pre-resolving at startup, ordered so the fastest JSON-API
 * sources come first (warmupDnsFast warms this prefix).
 */
export const ALL_SOURCE_HOSTS: string[] = [
  // JSON API sources (fastest, warm first)
  ...YTS_DOMAINS,
  NYAA_HOST,
  SUBSPLEASE_HOST,
  ...EZTV_DOMAINS.slice(0, 2),
  PIRATEBAY_HOST,
  ...BITSEARCH_DOMAINS,
  FITGIRL_HOST,
  FMHY_API_HOST,
  // HTML scraping mirrors
  ...EZTV_DOMAINS.slice(2),
  ...TORRENTGALAXY_DOMAINS,
  ...LIMETORRENTS_DOMAINS,
];
