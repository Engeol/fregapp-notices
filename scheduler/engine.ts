import { createHash, randomUUID } from 'node:crypto';
import type { Firestore, DocumentReference, DocumentData, Transaction } from 'firebase-admin/firestore';
import { getCurrentPeriodId } from '../src/lib/periodUtils';
import { allowedPushEndpoint, expiredReview, notificationPlan, type Event } from './plan';

export type PushDevice = { endpoint: string; keys: { auth: string; p256dh: string } };
export type Transport = (device: PushDevice, event: Event) => Promise<void>;
export type AssertActive = (tx?: Transaction) => Promise<void>;
export const SCHEDULER_LEASE_LOST = 'SCHEDULER_LEASE_LOST';
type Options = { db: Firestore; send: Transport; publicKey: string; householdId?: string;
  clock?: () => number; beforeSend?: () => Promise<void>; afterSend?: () => Promise<void>; assertActive?: AssertActive };
const fingerprint = (data: DocumentData) => createHash('sha256')
  .update(JSON.stringify([data.user_id, data.household_id, data.endpoint, data.keys?.auth, data.keys?.p256dh, data.vapid_public_key])).digest('hex');

/** The only side effect outside Firestore is the injected transport. Tests never use a push provider. */
export async function runScheduledWork({ db, send, publicKey, householdId, clock = Date.now, beforeSend, afterSend, assertActive }: Options) {
  const guard = async (tx?: Transaction) => assertActive?.(tx);
  const read = async <T>(operation: () => Promise<T>): Promise<T> => {
    await guard(); const result = await operation(); await guard(); return result;
  };
  const counts = { closed: 0, sent: 0, removed: 0, cancelled: 0, retry: 0 };
  await guard();
  const now = clock();
  const reviewQuery = householdId ? db.collection('task_assignments').where('household_id', '==', householdId).where('status', '==', 'in_review')
    : db.collection('task_assignments').where('status', '==', 'in_review');
  const reviews = await read(() => reviewQuery.get());
  for (const candidate of reviews.docs) {
    await guard();
    if (!expiredReview(candidate.data(), now)) continue;
    const closed = await db.runTransaction(async tx => {
      await guard(tx);
      const latest = await tx.get(candidate.ref);
      await guard(tx);
      if (!latest.exists || !expiredReview(latest.data()!, clock())) return false;
      tx.update(candidate.ref, { status: 'completed' }); return true;
    });
    await guard();
    if (closed) counts.closed++;
  }
  await guard();
  const hour = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));
  if (hour < 9) return counts;
  const homes = householdId ? [await read(() => db.doc(`households/${householdId}`).get())]
    : (await read(() => db.collection('households').get())).docs;
  for (const home of homes) {
    await guard();
    if (!home.exists) continue;
    const config = home.data()!;
    const period = getCurrentPeriodId(config.rotation_frequency_days, config.timezone, config.rotation_anchor_date, now);
    const assignmentsQuery = db.collection('task_assignments').where('household_id', '==', home.id).where('period_id', '==', period);
    const [members, assignments, subscriptions] = await read(() => Promise.all([
      db.collection('user_profiles').where('household_id', '==', home.id).get(), assignmentsQuery.get(),
      db.collection('push_subscriptions').where('household_id', '==', home.id).get(),
    ]));
    for (const member of members.docs) {
      await guard();
      if (!member.data().push_enabled) continue;
      const events = notificationPlan({ ...config, id: home.id }, member.id, assignments.docs.map(d => d.data()) as any, now);
      for (const subscription of subscriptions.docs.filter(s => s.data().user_id === member.id)) {
        await guard();
        const data = subscription.data();
        if (!allowedPushEndpoint(data.endpoint) || !data.keys?.auth || !data.keys?.p256dh || data.vapid_public_key !== publicKey) continue;
        const deviceFingerprint = fingerprint(data);
        for (const event of events) {
          await guard();
          const id = createHash('sha256').update(`${event.id}:${subscription.id}`).digest('hex');
          const ref = db.collection('push_deliveries').doc(id);
          const owner = randomUUID();
          const leaseTime = clock();
          const acquired = await db.runTransaction(async tx => {
            await guard(tx);
            const [priorSnap, currentDevice, profile, currentHome, currentAssignments] = await Promise.all([
              tx.get(ref), tx.get(subscription.ref), tx.get(member.ref), tx.get(home.ref), tx.get(assignmentsQuery),
            ]);
            await guard(tx);
            const prior = priorSnap.data();
            const attempts = prior?.fingerprint === deviceFingerprint ? prior.attempts || 0 : 0;
            if (prior?.status === 'sent' || prior?.lease_until > leaseTime || attempts >= 3) return false;
            if (!currentDevice.exists || fingerprint(currentDevice.data()!) !== deviceFingerprint
              || currentDevice.data()!.user_id !== member.id || currentDevice.data()!.household_id !== home.id
              || profile.data()?.household_id !== home.id || !profile.data()?.push_enabled || !currentHome.exists) return false;
            if (!notificationPlan({ ...currentHome.data(), id: home.id }, member.id, currentAssignments.docs.map(d => d.data()) as any, clock()).some(p => p.id === event.id)) return false;
            tx.set(ref, { household_id: home.id, user_id: member.id, status: 'sending', fingerprint: deviceFingerprint,
              owner, lease_until: leaseTime + 120000, attempts: attempts + 1 });
            return true;
          });
          await guard();
          if (!acquired) continue;
          const finish = async (status: string) => db.runTransaction(async tx => {
            await guard(tx);
            const latest = (await tx.get(ref)).data();
            await guard(tx);
            if (latest?.owner === owner) tx.update(ref, { status, lease_until: 0,
              ...(status === 'sent' ? { sent_at: new Date(clock()).toISOString() } : {}) });
          });
          await guard();
          await beforeSend?.();
          await guard();
          // Recheck immediately before the external call, including revocation during lease acquisition.
          const [currentDevice, profile, currentHome, currentAssignments] = await read(() => Promise.all([
            subscription.ref.get(), member.ref.get(), home.ref.get(), assignmentsQuery.get(),
          ]));
          if (!currentDevice.exists || fingerprint(currentDevice.data()!) !== deviceFingerprint
            || profile.data()?.household_id !== home.id || !profile.data()?.push_enabled || !currentHome.exists
            || !notificationPlan({ ...currentHome.data(), id: home.id }, member.id, currentAssignments.docs.map(d => d.data()) as any, clock()).some(p => p.id === event.id)) {
            await finish('cancelled'); counts.cancelled++; continue;
          }
          try { await guard(); await send({ endpoint: data.endpoint, keys: data.keys }, event); await guard(); }
          catch (error) {
            if ((error as Error)?.message === SCHEDULER_LEASE_LOST) throw error;
            const code = (error as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) {
              const removed = await removeExpiredDevice(db, subscription.ref, deviceFingerprint, guard);
              if (removed) counts.removed++;
              await finish('expired'); break;
            }
            await finish('retry'); counts.retry++; continue;
          }
          // Failure/crash after the provider accepted leaves the lease until expiry.
          // A retry uses the same notification tag; delivery cannot be exactly-once across two services.
          await guard();
          await afterSend?.();
          await guard();
          await finish('sent'); counts.sent++;
        }
      }
    }
  }
  return counts;
}
async function removeExpiredDevice(db: Firestore, ref: DocumentReference, expected: string, guard: (tx?: Transaction) => Promise<void>) {
  return db.runTransaction(async tx => {
    await guard(tx);
    const current = await tx.get(ref);
    await guard(tx);
    if (!current.exists || fingerprint(current.data()!) !== expected) return false;
    tx.delete(ref); return true;
  });
}
