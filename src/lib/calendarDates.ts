export const DEFAULT_TIMEZONE = 'Europe/Madrid';
export const DAY_MS = 86_400_000;
export function validTimezone(timezone?: string): string {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone || DEFAULT_TIMEZONE }).format(); return timezone || DEFAULT_TIMEZONE; }
  catch { return DEFAULT_TIMEZONE; }
}
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function calendarDay(value: string): number {
  if (!isCalendarDate(value)) throw new Error(`Fecha inválida: ${value}`);
  return Date.parse(`${value}T00:00:00Z`);
}
export function addDateDays(value: string, days: number): string {
  return new Date(calendarDay(value) + days * DAY_MS).toISOString().slice(0, 10);
}
export function dateInTimezone(timezone?: string, now: Date | number = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: validTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => parts.find(item => item.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
/** Convert a civil midnight into an instant, using the offset at that date (including DST). */
export function startOfCalendarDate(value: string, timezone?: string): Date {
  const target = calendarDay(value);
  let instant = target;
  const formatter = new Intl.DateTimeFormat('en', { timeZone: validTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 4; i++) {
    const parts = formatter.formatToParts(instant);
    const part = (name: string) => Number(parts.find(item => item.type === name)?.value);
    const civil = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
    const next = instant + target - civil;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}
export function addCalendarDays(instant: Date, days: number, timezone?: string): Date {
  return startOfCalendarDate(addDateDays(dateInTimezone(timezone, instant), days), timezone);
}
