/** GitHub-style compact counts: 950, 1.2k, 12.3k, 1.5m. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${trim(n / 1000)}k`;
  return `${trim(n / 1_000_000)}m`;
}

function trim(n: number): string {
  return (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10).toString();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** "in 12 minutes", "in 45 seconds". */
export function formatUntil(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
  if (seconds < 60) return `in ${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
