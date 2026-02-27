/**
 * Shared date/time helpers.
 */

/**
 * Format an ISO date string in the specified IANA timezone.
 * Returns null when formatting is not possible.
 */
export function formatDateInTimezone(isoString, timezone) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    const opts = {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    };
    if (timezone) opts.timeZone = timezone;
    return new Intl.DateTimeFormat("en-US", opts).format(d);
  } catch {
    return null;
  }
}

/**
 * Parse Canvas due date variants into a Date object.
 */
export function parseCanvasDueDate(dueDateRaw) {
  if (!dueDateRaw) return null;

  if (/^\d{4}-\d{2}-\d{2}T/.test(dueDateRaw)) {
    const d = new Date(dueDateRaw);
    return isNaN(d.getTime()) ? null : d;
  }

  const m = dueDateRaw.match(
    /([A-Za-z]{3})\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})(am|pm)/i,
  );
  if (!m) return null;

  const monthStr = m[1].toLowerCase();
  const day = parseInt(m[2], 10);
  let hour = parseInt(m[3], 10);
  const minute = parseInt(m[4], 10);
  const ampm = m[5].toLowerCase();

  if (ampm === "pm" && hour !== 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  const months = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const month = months[monthStr];
  if (month === undefined) return null;

  return new Date(new Date().getFullYear(), month, day, hour, minute, 0, 0);
}
