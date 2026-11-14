// Execution is opt-in; importing the planner never connects to production.
import { randomUUID } from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as webpush from 'web-push';
import { runScheduledWork } from './engine';
import { createProtectedSchedulerRuntime, hashSchedulerNonce } from './runtime';
import { assertDirectProjectFree, readDirectRuntimeConfig } from './direct-runtime';

async function main() {
  const env = process.env;
  const local = env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8095';
  if (local) {
    const app = initializeApp({ projectId: 'demo-fregapp-preview' });
    const db = getFirestore(app, '(default)');
    try {
      const result = await runScheduledWork({ db, householdId: env.FREGAPP_HOUSEHOLD_ID,
        publicKey: 'test-public-key', send: async () => {} });
      console.log(JSON.stringify({ mode: 'emulator-no-push', ...result }));
    } finally { await db.terminate(); }
    return;
  }

  if (env.FIRESTORE_EMULATOR_HOST) throw new Error('UNEXPECTED_EMULATOR');
  const { scheduler, serviceAccount } = readDirectRuntimeConfig(env, process.argv.slice(2));
  const app = initializeApp({ projectId: scheduler.projectId, credential: cert({
    projectId: serviceAccount.project_id, clientEmail: serviceAccount.client_email, privateKey: serviceAccount.private_key,
  }) }, 'fregapp-direct-push');
  const credential = app.options.credential;
  if (!credential) throw new Error('INVALID_SERVICE_ACCOUNT');
  const accessToken = async () => (await credential.getAccessToken()).access_token;
  const assertFree = (projectId: string, databaseId: string, token: () => Promise<string>) =>
    assertDirectProjectFree(projectId, databaseId, token);

  await assertFree(scheduler.projectId, scheduler.databaseId, accessToken);
  const db = getFirestore(app, scheduler.databaseId);
  try {
    webpush.setVapidDetails(scheduler.subject, scheduler.publicKey, scheduler.privateKey);
    const runtime = await createProtectedSchedulerRuntime(scheduler, {
      db, accessToken, assertFree,
      send: async (device, event) => {
        await webpush.sendNotification(device, JSON.stringify(event), { TTL: 86400, timeout: 10000 });
      },
    });
    await runtime.tick(Date.now(), hashSchedulerNonce(randomUUID()));
    console.log(JSON.stringify({ mode: 'live', status: 'completed' }));
  } finally { await db.terminate(); }
}

void main().catch(error => {
  const safeCodes = ['NOT_ENABLED', 'UNEXPECTED_EMULATOR', 'MISSING_DATABASE_CONFIG', 'MISSING_HOUSEHOLD_SCOPE',
    'MISSING_VAPID', 'INVALID_PROJECT', 'INVALID_DATABASE', 'INVALID_SERVICE_ACCOUNT',
    'FREE_ACCESS_TOKEN_UNAVAILABLE', 'FREE_DATABASE_STATUS_UNVERIFIED', 'FREE_BILLING_STATUS_UNVERIFIED',
    'PAID_BILLING_NOT_ALLOWED', 'SCHEDULER_CONFLICT', 'SCHEDULER_LEASE_LOST'];
  const reason = safeCodes.includes(error?.message) ? error.message : 'CONFIG_OR_RUNTIME_ERROR';
  console.error(`Scheduler stopped: ${reason}`); process.exitCode = 1;
});
