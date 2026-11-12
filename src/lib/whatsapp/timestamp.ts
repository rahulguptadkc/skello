const INDIA_TIME_ZONE = "Asia/Kolkata";

export function formatWhatsAppTimestamp(timestamp: number | string | null | undefined): string {
  const value = typeof timestamp === "number" ? timestamp : Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
