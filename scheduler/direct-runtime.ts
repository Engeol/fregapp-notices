import type { SchedulerConfig } from './runtime';
import { assertUnbilledProject } from './free-project';

export const DIRECT_PROJECT_ID = 'fregapp';
export const DIRECT_DATABASE_ID = '(default)';
export const DIRECT_SERVICE_ACCOUNT = 'fregapp-notices@fregapp.iam.gserviceaccount.com';

export type DirectRuntimeConfig = {
  scheduler: SchedulerConfig;
  serviceAccount: { project_id: string; client_email: string; private_key: string; [key: string]: unknown };
};

export function assertDirectProjectFree(
  projectId: string,
  databaseId: string,
  accessToken: () => Promise<string>,
  request?: typeof fetch,
): Promise<void> {
  return assertUnbilledProject(projectId, databaseId, accessToken, request);
}

/** Validate all deployment scope before parsing credentials or initializing Firebase. */
export function readDirectRuntimeConfig(env: NodeJS.ProcessEnv, args: string[]): DirectRuntimeConfig {
  if (!args.includes('--live') || env.FREGAPP_FREE_DELIVERY_APPROVED !== '1') throw new Error('NOT_ENABLED');
  if (env.FIRESTORE_EMULATOR_HOST) throw new Error('UNEXPECTED_EMULATOR');
  if (env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('INVALID_SERVICE_ACCOUNT');
  if (env.FIREBASE_PROJECT_ID !== DIRECT_PROJECT_ID) throw new Error('INVALID_PROJECT');
  if (env.FIRESTORE_DATABASE_ID !== DIRECT_DATABASE_ID) throw new Error('INVALID_DATABASE');
  if (!env.FREGAPP_HOUSEHOLD_ID) throw new Error('MISSING_HOUSEHOLD_SCOPE');
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) throw new Error('MISSING_VAPID');
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('INVALID_SERVICE_ACCOUNT');

  let parsed: unknown;
  try { parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); }
  catch { throw new Error('INVALID_SERVICE_ACCOUNT'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_SERVICE_ACCOUNT');
  const serviceAccount = parsed as Record<string, unknown>;
  if (serviceAccount.type !== 'service_account'
    || serviceAccount.project_id !== DIRECT_PROJECT_ID
    || serviceAccount.client_email !== DIRECT_SERVICE_ACCOUNT
    || typeof serviceAccount.private_key !== 'string' || !serviceAccount.private_key) throw new Error('INVALID_SERVICE_ACCOUNT');

  return {
    scheduler: {
      projectId: DIRECT_PROJECT_ID,
      databaseId: DIRECT_DATABASE_ID,
      householdId: env.FREGAPP_HOUSEHOLD_ID,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT,
    },
    serviceAccount: serviceAccount as DirectRuntimeConfig['serviceAccount'],
  };
}
