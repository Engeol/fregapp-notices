/** Fail closed before Firestore work: billing disabled OR the exact database has AI shared-quota caps. */
export async function assertFreeProject(
  projectId: string,
  databaseId: string,
  accessToken: () => Promise<string>,
  request: typeof fetch = fetch,
): Promise<void> {
  await assertProjectBillingPolicy(projectId, databaseId, accessToken, request, false);
}

/** CLI delivery requires billing to remain disabled even when AI shared-quota caps exist. */
export async function assertUnbilledProject(
  projectId: string,
  databaseId: string,
  accessToken: () => Promise<string>,
  request: typeof fetch = fetch,
): Promise<void> {
  await assertProjectBillingPolicy(projectId, databaseId, accessToken, request, true);
}

async function assertProjectBillingPolicy(
  projectId: string,
  databaseId: string,
  accessToken: () => Promise<string>,
  request: typeof fetch,
  requireBillingDisabled: boolean,
): Promise<void> {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new Error('INVALID_PROJECT');
  if (databaseId !== '(default)' && !/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(databaseId)) throw new Error('INVALID_DATABASE');
  const token = await accessToken();
  if (!token) throw new Error('FREE_ACCESS_TOKEN_UNAVAILABLE');
  const metadata = async (url: string, failure: string): Promise<Record<string, unknown>> => {
    try {
      const response = await request(url, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000), redirect: 'error', cache: 'no-store',
      });
      if (!response.ok) throw new Error(failure);
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(failure);
      return data as Record<string, unknown>;
    } catch {
      // Do not expose provider responses, credentials or arbitrary network errors in logs.
      throw new Error(failure);
    }
  };
  const billingName = `projects/${projectId}/billingInfo`;
  const billing = await metadata(`https://cloudbilling.googleapis.com/v1/${billingName}`, 'FREE_BILLING_STATUS_UNVERIFIED');
  if (billing.name !== billingName || billing.projectId !== projectId
    || typeof billing.billingEnabled !== 'boolean') throw new Error('FREE_BILLING_STATUS_UNVERIFIED');

  const databaseName = `projects/${projectId}/databases/${databaseId}`;
  const database = await metadata(`https://firestore.googleapis.com/v1/${databaseName}`, 'FREE_DATABASE_STATUS_UNVERIFIED');
  if (database.name !== databaseName || database.type !== 'FIRESTORE_NATIVE') throw new Error('FREE_DATABASE_STATUS_UNVERIFIED');

  // freeTier is the ordinary allowance, not the AI shared quota. Never use it as a substitute.
  if (billing.billingEnabled === false || (!requireBillingDisabled && database.freeTierLimited === true)) return;
  throw new Error('PAID_BILLING_NOT_ALLOWED');
}
