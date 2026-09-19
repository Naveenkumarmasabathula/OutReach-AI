/**
 * Minute-of-day arithmetic done via `Intl.DateTimeFormat`'s `timeZone`
 * option rather than a timezone library — sufficient for this prototype's
 * IANA-string timezones without adding a dependency. Known limitation: on a
 * DST-transition day, "minutes until the next start time" can be off by up
 * to an hour for a timezone that observes DST (none of the seeded hospitals
 * do — they all use "UTC" — so this doesn't affect anything in this repo
 * today, but a real deployment with e.g. "America/New_York" should be aware
 * of it).
 */
function getHourMinuteInTimezone(date: Date, timezone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour, minute };
}

function toMinutesOfDay(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function isWithinCallingHours(date: Date, timezone: string, startHHmm: string, endHHmm: string): boolean {
  const { hour, minute } = getHourMinuteInTimezone(date, timezone);
  const currentMinute = hour * 60 + minute;
  return currentMinute >= toMinutesOfDay(startHHmm) && currentMinute < toMinutesOfDay(endHHmm);
}

/** Returns `date` unchanged if already within the window, otherwise the next moment the window opens. */
export function nextValidCallingTime(date: Date, timezone: string, startHHmm: string, endHHmm: string): Date {
  const { hour, minute } = getHourMinuteInTimezone(date, timezone);
  const currentMinute = hour * 60 + minute;
  const startMinute = toMinutesOfDay(startHHmm);
  const endMinute = toMinutesOfDay(endHHmm);

  if (currentMinute >= startMinute && currentMinute < endMinute) return date;

  const minutesUntilStart =
    currentMinute < startMinute ? startMinute - currentMinute : 24 * 60 - currentMinute + startMinute;
  return new Date(date.getTime() + minutesUntilStart * 60 * 1000);
}
