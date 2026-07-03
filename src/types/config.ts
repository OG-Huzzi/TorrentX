export interface TorrentXConfig {
  cacheTtlMs: number;
  sourceTimeoutMs: number;
  maxConcurrency: number;
  metadataLimit: number;
  tmdbApiKey: string | undefined;
  omdbApiKey: string | undefined;
  userAgent: string;
  downloadDir?: string | undefined;
}
