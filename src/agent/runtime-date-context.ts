export interface RuntimeDateContextOptions {
  now?: Date;
  /**
   * Test seam and explicit override. Production leaves this unset so the
   * current device IANA time zone is resolved for every call.
   */
  timeZone?: string | null;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const WEEKDAYS: ReadonlyArray<readonly [string, string]> = [
  ["星期日", "Sunday"],
  ["星期一", "Monday"],
  ["星期二", "Tuesday"],
  ["星期三", "Wednesday"],
  ["星期四", "Thursday"],
  ["星期五", "Friday"],
  ["星期六", "Saturday"],
];

const DATE_CONTEXT_HEADER = "## Runtime date context (authoritative for relative dates)";
const UNAVAILABLE_CONTEXT =
  `${DATE_CONTEXT_HEADER}\n` +
  "- Runtime date context unavailable. The device date or IANA time zone could not be resolved.\n" +
  "- Do not infer today, yesterday, tomorrow, this week, or last week. Ask for an explicit date when the task needs one.";

/**
 * Resolve the device's current IANA time zone through the standard Intl API.
 * An empty string means the runtime cannot provide a trustworthy zone.
 */
export function resolveRuntimeTimeZone(): string {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" ? zone.trim() : "";
  } catch {
    return "";
  }
}

function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function formatDate(parts: CalendarDate): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addCalendarDays(parts: CalendarDate, days: number): CalendarDate {
  // UTC is used only as calendar arithmetic. The local date was already
  // extracted in the target IANA zone, so DST cannot turn a day into 23/25h.
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function weekdayIndex(parts: CalendarDate): number {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function localParts(now: Date, timeZone: string): {
  date: CalendarDate;
  hour: string;
  minute: string;
  offset: string;
} | null {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = new Map(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const year = Number(values.get("year"));
  const month = Number(values.get("month"));
  const day = Number(values.get("day"));
  const hour = values.get("hour");
  const minute = values.get("minute");
  // longOffset is available in current Chromium/Electron WebViews, but the
  // calendar/time fields above remain usable if an older runtime omits it.
  let offset = "";
  try {
    offset =
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "longOffset",
      })
        .formatToParts(now)
        .find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    // The IANA time zone remains authoritative; the display offset is optional.
  }
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    !hour ||
    !minute
  ) {
    return null;
  }
  return { date: { year, month, day }, hour, minute, offset };
}

/**
 * Build a compact per-request time overlay. Calendar arithmetic is performed
 * from local Y/M/D parts rather than UTC epoch arithmetic, then presented as a
 * Monday-Sunday week.
 */
export function buildRuntimeDateContext(options: RuntimeDateContextOptions = {}): string {
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return UNAVAILABLE_CONTEXT;

  const timeZone = (options.timeZone ?? resolveRuntimeTimeZone()).trim();
  if (!timeZone || !validTimeZone(timeZone)) return UNAVAILABLE_CONTEXT;

  let parts: ReturnType<typeof localParts>;
  try {
    parts = localParts(now, timeZone);
  } catch {
    return UNAVAILABLE_CONTEXT;
  }
  if (!parts) return UNAVAILABLE_CONTEXT;

  const weekday = weekdayIndex(parts.date);
  const mondayOffset = (weekday + 6) % 7;
  const weekStart = addCalendarDays(parts.date, -mondayOffset);
  const weekEnd = addCalendarDays(weekStart, 6);
  const previousWeekStart = addCalendarDays(weekStart, -7);
  const previousWeekEnd = addCalendarDays(weekStart, -1);
  const yesterday = addCalendarDays(parts.date, -1);
  const tomorrow = addCalendarDays(parts.date, 1);
  const zoneDisplay = parts.offset ? `${timeZone}, ${parts.offset}` : timeZone;
  const [zhWeekday, enWeekday] = WEEKDAYS[weekday];

  return [
    DATE_CONTEXT_HEADER,
    `- Current local date and time: ${formatDate(parts.date)} ${parts.hour}:${parts.minute} (${zoneDisplay})`,
    `- Today: ${formatDate(parts.date)}, ${zhWeekday} (${enWeekday})`,
    `- Yesterday: ${formatDate(yesterday)}`,
    `- Tomorrow: ${formatDate(tomorrow)}`,
    `- This week (Monday-Sunday): ${formatDate(weekStart)} to ${formatDate(weekEnd)}`,
    `- Previous week (Monday-Sunday): ${formatDate(previousWeekStart)} to ${formatDate(previousWeekEnd)}`,
    "- Use this block to interpret relative dates. An explicit date supplied by the user takes priority for that request. Do not substitute UTC dates for local dates.",
  ].join("\n");
}
