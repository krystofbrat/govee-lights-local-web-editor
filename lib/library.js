import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store.js';

// Scene pictures and categories come from the scene library the Govee phone app uses. It isn't part of
// Govee's developer API, so all of this is optional: when it fails, scenes just show without pictures.
const LIBRARY_URL = 'https://app2.govee.com/appsku/v1/light-effect-libraries?sku=';
const FILE = path.join(DATA_DIR, 'scene-pictures.json');
const MAX_AGE = 7 * 24 * 3600_000;
const RETRY_AFTER = 3600_000;

const httpsUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>()\\]+$/.test(u) ? u : '');

export class SceneLibrary {
  constructor() {
    try { this.cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { this.cache = {}; }
    this.pending = new Map();
  }

  /** lowercase scene name → { pic, picDark, category, hint } for a light model; {} if unavailable */
  async get(sku) {
    const c = this.cache[sku];
    if (c && Date.now() < c.until) return c.scenes;
    if (!this.pending.has(sku)) this.pending.set(sku, this.load(sku).finally(() => this.pending.delete(sku)));
    return this.pending.get(sku);
  }

  /** Only what's already loaded, for code that can't wait */
  peek(sku, name) { return this.cache[sku]?.scenes[name.toLowerCase()] || null; }

  async load(sku) {
    const old = this.cache[sku];
    try {
      const res = await fetch(LIBRARY_URL + encodeURIComponent(sku), {
        headers: { AppVersion: '5.6.01', 'User-Agent': 'lights (local Govee controller)' },
        signal: AbortSignal.timeout(10_000),
      });
      const categories = (await res.json())?.data?.categories;
      if (!res.ok || !Array.isArray(categories)) throw new Error(`HTTP ${res.status}`);
      const scenes = {};
      for (const cat of categories) {
        for (const s of cat.scenes || []) {
          if (!s?.sceneName) continue;
          const [pic, , picDark] = s.iconUrls || [];
          const info = { pic: httpsUrl(pic), picDark: httpsUrl(picDark) || httpsUrl(pic), category: String(cat.categoryName || ''), hint: String(s.scenesHint || '') };
          scenes[s.sceneName.toLowerCase()] = info;
          // A scene with variants shows up in the developer API as "Leisure-A", "Leisure-B"…
          for (const e of s.lightEffects || []) if (e?.scenceName) scenes[`${s.sceneName}-${e.scenceName}`.toLowerCase()] = info;
        }
      }
      this.cache[sku] = { until: Date.now() + MAX_AGE, scenes };
      this.save();
      return scenes;
    } catch (e) {
      console.warn(`[scene pictures] ${sku}: ${e.message}`);
      // Keep using what we had, and don't ask again on every request
      this.cache[sku] = { until: Date.now() + RETRY_AFTER, scenes: old?.scenes || {} };
      return this.cache[sku].scenes;
    }
  }

  save() {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.cache));
    fs.renameSync(tmp, FILE);
  }
}
