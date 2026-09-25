/** Human-readable size, as shown on the connection overview (KB / MB / GB). */
export function formatBytes(bytes: number): string {
  if (bytes > 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes > 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}
