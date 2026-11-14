import { dateInTimezone, calendarDay, DAY_MS } from '../src/lib/calendarDates';
import { getCurrentPeriodId, getPeriodDatesFromId, formatPeriodLabel } from '../src/lib/periodUtils';
export type Event = { id: string; title: string; body: string; url: string; tag: string; recipient_id: string; household_id: string };
export function notificationPlan(home: { id: string; name?: string; timezone?: string; rotation_frequency_days?: number; rotation_anchor_date?: string }, userId: string, assignments: { assignee_id: string; period_id: string; status: string; is_vacant?: boolean }[], now: number): Event[] {
  const hour = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));
  if (hour < 9) return [];
  const period = getCurrentPeriodId(home.rotation_frequency_days, home.timezone, home.rotation_anchor_date, now);
  const dates = getPeriodDatesFromId(period, home.rotation_frequency_days, home.rotation_anchor_date, home.timezone);
  const today = dateInTimezone(home.timezone, now);
  const prefix = `${home.id}_${userId}_${period}`;
  const events: Event[] = [];
  if (today === dateInTimezone(home.timezone, dates.start.getTime())) {
    const id = `${prefix}_start`;
    events.push({ id, tag: id, recipient_id: userId, household_id: home.id, title: 'Nuevo ciclo de limpieza', body: `${home.name || 'Tu casa'} · ${formatPeriodLabel(period, home.rotation_frequency_days, home.rotation_anchor_date, home.timezone)}`, url: '/' });
  }
  const pending = assignments.filter(a => a.period_id === period && a.assignee_id === userId && !a.is_vacant && ['pending', 'rejected_feedback'].includes(a.status));
  const days = 1 + (calendarDay(dateInTimezone(home.timezone, dates.end.getTime())) - calendarDay(today)) / DAY_MS;
  if (pending.length && days >= 1 && days <= 5) {
    const id = `${prefix}_reminder_${today}`;
    events.push({ id, tag: id, recipient_id: userId, household_id: home.id, title: `${days} día(s) restantes`, body: `Tienes ${pending.length} zona(s) pendiente(s) este ciclo.`, url: '/' });
  }
  return events;
}
export function expiredReview(data: { status?: string; deletion_in_progress?: boolean; quorum_started_at?: unknown; completed_at?: unknown }, now: number): boolean {
  if (data.status !== 'in_review' || data.deletion_in_progress) return false;
  const millis = (value: any) => value?.toMillis?.() ?? (typeof value?.seconds === 'number' ? value.seconds * 1000 : NaN);
  const quorum = millis(data.quorum_started_at);
  const start = Number.isFinite(quorum) ? quorum : millis(data.completed_at);
  return Number.isFinite(start) && now - start >= 72 * 3600000;
}
export function allowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && (url.hostname === 'fcm.googleapis.com' || url.hostname.endsWith('.push.apple.com')
        || url.hostname === 'updates.push.services.mozilla.com');
  } catch { return false; }
}
