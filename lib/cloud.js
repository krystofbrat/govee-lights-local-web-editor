// Govee Developer Platform API v2 — https://developer.govee.com
import { randomUUID } from 'node:crypto';

const BASE = process.env.GOVEE_API_BASE || 'https://openapi.api.govee.com/router/api/v1';

export class CloudApi {
  constructor({ getKey, onRequest }) {
    this.getKey = getKey;
    this.onRequest = onRequest;
  }

  async request(method, path, payload, key = this.getKey()) {
    if (!key) throw new Error('No Govee API key set (Settings → API key)');
    let res;
    try {
      res = await fetch(BASE + path, {
        method,
        headers: { 'Govee-API-Key': key, 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify({ requestId: randomUUID(), payload }) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // No status on purpose: callers treat that as "offline", not as a bad key or request
      throw new Error("Can't reach Govee's cloud — is this Mac online?");
    }
    this.onRequest?.();
    let body = null;
    try { body = await res.json(); } catch {}
    if (!res.ok || (body?.code && body.code !== 200)) {
      const msg = body?.message || body?.msg || res.statusText || `HTTP ${res.status}`;
      const err = new Error(
        res.status === 401 ? 'Govee rejected the API key — check it in Settings'
          : res.status === 429 ? 'Govee rate limit reached, try again in a minute'
            : `Govee cloud: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  async devices(key) {
    return (await this.request('GET', '/user/devices', null, key)).data || [];
  }

  async state(sku, device) {
    return (await this.request('POST', '/device/state', { sku, device })).payload?.capabilities || [];
  }

  control(sku, device, capability) {
    return this.request('POST', '/device/control', { sku, device, capability });
  }

  async scenes(sku, device) {
    return (await this.request('POST', '/device/scenes', { sku, device })).payload?.capabilities || [];
  }

  async diyScenes(sku, device) {
    return (await this.request('POST', '/device/diy-scenes', { sku, device })).payload?.capabilities || [];
  }
}
