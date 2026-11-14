import { DAY_MS, addDateDays, calendarDay, dateInTimezone, isCalendarDate, startOfCalendarDate, validTimezone } from './calendarDates';
const DEFAULT_ANCHOR = '2026-08-20';
const frequency = (days = 14) => Number.isInteger(days) && days > 0 ? days : 14;
const anchor = (value = DEFAULT_ANCHOR) => isCalendarDate(value) ? value : DEFAULT_ANCHOR;
function currentPeriod(days = 14, timezone?: string, anchorDate = DEFAULT_ANCHOR, at = Date.now()) {
  const span = frequency(days);
  const end = anchor(anchorDate);
  const firstDay = calendarDay(addDateDays(end, 1 - span));
  const today = calendarDay(dateInTimezone(timezone, at));
  return { span, end, index: Math.floor((today - firstDay) / (span * DAY_MS)), firstDay, today };
}
// Compatibility helper: a synthetic civil clock, never used as an actual deadline instant.
export function getLocalNowWithOffset(timezone?: string): number {
  const now = Date.now();
  const parts = new Intl.DateTimeFormat('en', { timeZone: validTimezone(timezone), hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (key: string) => Number(parts.find(item => item.type === key)?.value);
  return calendarDay(dateInTimezone(timezone, now)) + part('hour') * 3600000 + part('minute') * 60000 + part('second') * 1000 + now % 1000;
}
export function getCurrentPeriodId(days = 14, timezone?: string, anchorDate = DEFAULT_ANCHOR, at = Date.now()): string {
  const p = currentPeriod(days, timezone, anchorDate, at);
  return `period_${p.span}_${p.index}_a${p.end.replace(/-/g, '')}`;
}
export function getDaysRemainingInPeriod(days = 14, timezone?: string, anchorDate = DEFAULT_ANCHOR): number {
  const p = currentPeriod(days, timezone, anchorDate);
  return (p.firstDay + (p.index + 1) * p.span * DAY_MS - p.today) / DAY_MS;
}
export function getCurrentPeriodDates(days = 14, timezone?: string, anchorDate = DEFAULT_ANCHOR): { start: Date; end: Date } {
  return getPeriodDatesFromId(getCurrentPeriodId(days, timezone, anchorDate), days, anchorDate, timezone);
}
export function getPeriodDatesFromId(periodId: string, defaultFrequencyDays = 14, fallbackAnchorDate = DEFAULT_ANCHOR, timezone?: string): { start: Date; end: Date } {
  const parts = periodId.split('_');
  let span = frequency(defaultFrequencyDays);
  let index = 0;
  let end = anchor(fallbackAnchorDate);
  let explicit = false;
  if (parts.length >= 3) {
    span = frequency(Number(parts[1]));
    index = Number(parts[2]);
  } else if (parts.length === 2) index = Number(parts[1]);
  if (!Number.isInteger(index)) throw new Error('Periodo inválido');
  if (parts[3]?.startsWith('a')) {
    explicit = true;
    const key = parts[3].slice(1);
    const date = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
    if (!isCalendarDate(date)) throw new Error('Ancla de periodo inválida');
    end = date;
  }
  // Preserve both historical ID formats and their civil date labels.
  const first = !explicit && index > 500 ? '1970-01-05' : addDateDays(end, 1 - span);
  const startDate = addDateDays(first, index * span);
  return { start: startOfCalendarDate(startDate, timezone),
    end: new Date(startOfCalendarDate(addDateDays(startDate, span), timezone).getTime() - 1) };
}
export function formatPeriodLabel(periodId: string, defaultFrequencyDays = 14, fallbackAnchorDate = DEFAULT_ANCHOR, timezone?: string): string {
  if (!periodId) return 'Periodo actual';
  try {
    const { start, end } = getPeriodDatesFromId(periodId, defaultFrequencyDays, fallbackAnchorDate, timezone);
    const zone = validTimezone(timezone);
    const part = (date: Date, option: Intl.DateTimeFormatOptions) => date.toLocaleDateString('es-ES', { ...option, timeZone: zone }).replace('.', '');
    const startDay = part(start, { day: 'numeric' });
    const startMonth = part(start, { month: 'short' });
    const endDay = part(end, { day: 'numeric' });
    const endMonth = part(end, { month: 'short' });
    const year = part(end, { year: 'numeric' });
    return startMonth === endMonth ? `${startDay} – ${endDay} ${endMonth} ${year}` : `${startDay} ${startMonth} – ${endDay} ${endMonth} ${year}`;
  } catch { return periodId.replace(/_/g, ' '); }
}
