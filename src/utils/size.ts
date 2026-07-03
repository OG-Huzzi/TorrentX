const UNITS: Record<string, number> = {
  b: 1,
  kb: 1_000,
  kib: 1_024,
  mb: 1_000_000,
  mib: 1_048_576,
  gb: 1_000_000_000,
  gib: 1_073_741_824,
  tb: 1_000_000_000_000,
  tib: 1_099_511_627_776,
};

export function parseSize(input?: string | number): number | undefined {
  if (typeof input === "number") {
    return Number.isFinite(input) && input >= 0 ? input : undefined;
  }

  if (!input) return undefined;
  const match = input.trim().match(/^([\d.]+)\s*([kmgt]?i?b)$/i);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const multiplier = UNITS[match[2]!.toLowerCase()];
  return Number.isFinite(amount) && multiplier ? Math.round(amount * multiplier) : undefined;
}

export function formatSize(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index += 1;
  }
  const precision = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[index]}`;
}
