/**
 * Formats a Date object to a localized string with a timezone offset suffix (e.g. "2026/6/1 14:20:03 UTC+8").
 *
 * @param date - The Date object to format.
 * @param options - Optional Intl.DateTimeFormatOptions to customize the format.
 * @returns The formatted date string with the timezone offset suffix.
 */
export function formatDateTime(
  date: Date,
  options?: Intl.DateTimeFormatOptions
): string {
  const dateString = date.toLocaleString([], options);
  const offset = -date.getTimezoneOffset();
  const absOffset = Math.abs(offset);
  const hours = Math.floor(absOffset / 60);
  const minutes = absOffset % 60;
  const sign = offset >= 0 ? "+" : "-";

  const tzSuffix = offset === 0
    ? "UTC"
    : `UTC${sign}${hours}${minutes ? `:${minutes.toString().padStart(2, '0')}` : ""}`;

  return `${dateString} ${tzSuffix}`;
}
