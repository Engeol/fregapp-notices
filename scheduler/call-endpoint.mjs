import { createHash, createHmac, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const path = '/api/internal/push/tick';


const failureMessage = 'Push tick failed after bounded attempts or invalid configuration.';

function validConfiguration(urlValue, secret) {
  if (!urlValue || !secret || Buffer.byteLength(secret, 'utf8') < 32) return false;
  try {
    const url = new URL(urlValue);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && url.pathname === path && url.href === urlValue;
  } catch { return false; }
}

export async function callPushTick({ env = process.env, fetchRequest = globalThis.fetch, clock = Date.now, log = console } = {}) {
  const urlValue = env.FREGAPP_HTTP_PUSH_URL;
  const secret = env.FREGAPP_HTTP_PUSH_HMAC_SECRET;
  const fail = () => { log.error(failureMessage); return false; };
  if (!validConfiguration(urlValue, secret)) return fail();
  const body = '{}';
  let lastTimestamp = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    lastTimestamp = Math.max(clock(), lastTimestamp + 1);
    const timestamp = String(lastTimestamp);
    const nonce = randomUUID();
    const bodyHash = createHash('sha256').update(body).digest('hex');
    const canonical = `v1\nPOST\n${urlValue}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
    const signature = createHmac('sha256', secret).update(canonical).digest('hex');
    try {
      const response = await fetchRequest(urlValue, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-fregapp-timestamp': timestamp,
          'x-fregapp-nonce': nonce,
          'x-fregapp-signature': signature,
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(240_000),
      });
      if (response.status === 200) {
        log.log('Push tick completed (HTTP 200).');
        return true;
      }
    } catch { /* A retry uses a fresh signed request. */ }
  }
  return fail();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  callPushTick().then(ok => { if (!ok) process.exitCode = 1; }).catch(() => {
    console.error(failureMessage); process.exitCode = 1;
  });
}
