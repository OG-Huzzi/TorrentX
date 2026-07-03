export type DownloadStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "seeding"
  | "error";

/** Persisted to disk in downloads.json */
export interface DownloadRecord {
  id: string;
  magnetUri: string;
  title: string;
  source: string;
  downloadPath: string;
  status: DownloadStatus;
  addedAt: string;
  completedAt?: string;
  totalBytes: number;
  downloadedBytes: number;
  errorMessage?: string;
}

/** Transient live telemetry from WebTorrent */
export interface DownloadProgress {
  downloadSpeed: number;
  uploadSpeed: number;
  /** 0–1 fraction */
  progress: number;
  downloaded: number;
  uploaded: number;
  total: number;
  /** Seconds remaining, -1 if unknown */
  eta: number;
  peers: number;
  ratio: number;
}

/** Merged view returned to the UI: stored record + optional live data */
export interface DownloadItem extends DownloadRecord {
  liveProgress: DownloadProgress | undefined;
}

export interface DownloadManagerEvents {
  progress: (item: DownloadItem) => void;
  done: (item: DownloadItem) => void;
  error: (item: DownloadItem) => void;
  added: (item: DownloadItem) => void;
  removed: (id: string) => void;
}
