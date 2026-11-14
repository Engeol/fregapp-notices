import { createHash, randomUUID } from 'node:crypto';
import { applicationDefault, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import * as webpush from 'web-push';
import { runScheduledWork, SCHEDULER_LEASE_LOST, type Transport } from './engine';
import { assertFreeProject } from './free-project';

export type SchedulerConfig = {
  projectId: string; databaseId: string; householdId: string;
  publicKey: string; privateKey: string; subject: string;
};
export type SchedulerRuntime = { tick(timestamp: number, nonceHash: string): Promise<unknown> };
export type ProtectedRuntimeDependencies = {
  db: Firestore;
  accessToken: () => Promise<string>;
  assertFree: (projectId: string, databaseId: string, accessToken: () => Promise<string>) => Promise<void>;
  send: Transport;
  clock?: () => number;
  runWork?: typeof runScheduledWork;
};
type RuntimeDependencies = {
  env?: NodeJS.ProcessEnv;
  clock?: () => number;
  assertFree?: (projectId: string, databaseId: string, accessToken: () => Promise<string>) => Promise<void>;
  createFirestore?: (projectId: string, databaseId: string) => Firestore;
  accessToken?: () => Promise<string>;
  send?: Transport;
  runWork?: typeof runScheduledWork;
  configurePush?: (subject: string, publicKey: string, privateKey: string) => void;
};

function assertCloudRunIdentity(config: SchedulerConfig, env: NodeJS.ProcessEnv) {
  if (!env.K_SERVICE || !env.K_REVISION || env.FIRESTORE_EMULATOR_HOST || env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('CLOUD_RUN_ADC_REQUIRED');
  }
  for (const key of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'GCP_PROJECT']) {
    if (env[key] && env[key] !== config.projectId) throw new Error('PROJECT_ID_MISMATCH');
  }
}

function defaultCloudRun(config: SchedulerConfig): { db: () => Firestore; accessToken: () => Promise<string> } {
  const appName = 'fregapp-http-push';
  const existing = getApps().find(app => app.name === appName);
  const app = existing || initializeApp({ projectId: config.projectId, credential: applicationDefault() }, appName);
  if (app.options.projectId !== config.projectId) throw new Error('PROJECT_ID_MISMATCH');
  const credential = app.options.credential;
  if (!credential) throw new Error('CLOUD_RUN_ADC_REQUIRED');
  return {
    db: () => getFirestore(app, config.databaseId),
    accessToken: async () => (await credential.getAccessToken()).access_token,
  };
}

export async function createSchedulerRuntime(config: SchedulerConfig, dependencies: RuntimeDependencies = {}): Promise<SchedulerRuntime> {
  const env = dependencies.env ?? process.env;
  assertCloudRunIdentity(config, env);
  const defaults = dependencies.createFirestore ? undefined : defaultCloudRun(config);
  const accessToken = dependencies.accessToken ?? defaults!.accessToken;
  const freeCheck = dependencies.assertFree ?? assertFreeProject;
  await freeCheck(config.projectId, config.databaseId, accessToken);
  const db = dependencies.createFirestore
    ? dependencies.createFirestore(config.projectId, config.databaseId)
    : defaults!.db();
  const send = dependencies.send ?? (async (device, event) => {
    await webpush.sendNotification(device, JSON.stringify(event), { TTL: 86400, timeout: 10000 });
  });
  (dependencies.configurePush ?? webpush.setVapidDetails)(config.subject, config.publicKey, config.privateKey);
  return createProtectedSchedulerRuntime(config, {
    db, accessToken, assertFree: freeCheck, send,
    clock: dependencies.clock, runWork: dependencies.runWork,
  });
}

/** Shared protected tick used by Cloud Run and direct CLI execution. */
export async function createProtectedSchedulerRuntime(
  config: SchedulerConfig,
  dependencies: ProtectedRuntimeDependencies,
): Promise<SchedulerRuntime> {
  const { db, accessToken, assertFree: freeCheck, send } = dependencies;
  const runWork = dependencies.runWork ?? runScheduledWork;
  const clock = dependencies.clock ?? Date.now;
  const stateRef = db.doc(`push_scheduler_state/${config.householdId}`);

  return {
    async tick(timestamp, nonceHash) {
      // Re-check billing/shared quota on every schedule invocation before reading application documents.
      await freeCheck(config.projectId, config.databaseId, accessToken);
      const owner = randomUUID();
      let acquiredAt = 0;
      const acquired = await db.runTransaction(async tx => {
        const snapshot = await tx.get(stateRef);
        const state = snapshot.data();
        const now = clock();
        if ((state?.last_timestamp !== undefined && timestamp <= state.last_timestamp)
          || state?.last_nonce_hash === nonceHash || (state?.lease_until ?? 0) > now) return false;
        tx.set(stateRef, {
          last_timestamp: timestamp,
          last_nonce_hash: nonceHash,
          lease_until: now + 5 * 60_000,
          owner,
          status: 'running',
        });
        acquiredAt = now;
        return true;
      });
      if (!acquired) throw new Error('SCHEDULER_CONFLICT');
      const deadline = acquiredAt + 120_000;
      const assertActive = async (transaction?: import('firebase-admin/firestore').Transaction) => {
        const inspect = async (tx: import('firebase-admin/firestore').Transaction) => {
          const snapshot = await tx.get(stateRef);
          const state = snapshot.data();
          const now = clock();
          if (now >= deadline || state?.owner !== owner || state?.status !== 'running' || !(state?.lease_until > now)) {
            throw new Error(SCHEDULER_LEASE_LOST);
          }
        };
        if (transaction) await inspect(transaction);
        else await db.runTransaction(inspect);
      };
      const finish = async (status: 'completed' | 'failed') => db.runTransaction(async tx => {
        const latest = (await tx.get(stateRef)).data();
        if (latest?.owner === owner) tx.update(stateRef, { status, lease_until: 0, finished_at: clock() });
      });
      try {
        const guardedSend: Transport = async (device, event) => { await assertActive(); await send(device, event); };
        const result = await runWork({ db, householdId: config.householdId, publicKey: config.publicKey,
          send: guardedSend, clock, assertActive });
        await finish('completed');
        return result;
      } catch (error) {
        await finish('failed');
        throw error;
      }
    },
  };
}

export function hashSchedulerNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}
