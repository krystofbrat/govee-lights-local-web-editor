import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.LIGHTS_DATA_DIR || path.join(ROOT, 'data');
export const DATA_FILE = path.join(DATA_DIR, 'lights.json');
export const LOG_FILE = path.join(DATA_DIR, 'server.log');
export const DEFAULT_PORT = 8420;

const DEFAULTS = {
  apiKey: '',
  port: DEFAULT_PORT,
  names: {},      // deviceId -> custom name
  hidden: [],     // deviceIds hidden from the UI and from "all"
  groups: [],     // { id, name, devices: [deviceId] }
  favorites: [],  // { id, name, action }
  alarms: [],     // see scheduler.js
  timers: [],     // { id, target, label, startAt, endsAt, fade }
  fired: {},      // alarmId -> last occurrence key that ran
  usage: { day: '', count: 0 },
  known: {},      // deviceId -> { sku, cloudName, caps, inCloud, ip, seenAt }: lights seen before, see Devices.remember
  myScenes: [],   // { id, kind, name, skus, usedAt }: scenes turned on from this app, see Devices.saveScene
  hiddenScenes: [], // 'kind|lowercase name' of Govee scenes deleted from this app's lists
  location: null, // { lat, lon } rounded to ~1 km, for alarms at sunrise or sunset
};

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    // Keep the broken file around instead of silently overwriting the user's alarms
    const backup = `${DATA_FILE}.broken-${Date.now()}`;
    fs.renameSync(DATA_FILE, backup);
    console.error(`Could not read ${DATA_FILE} (${e.message}); moved it to ${backup}`);
    return {};
  }
}

export function loadStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const data = { ...structuredClone(DEFAULTS), ...readFile() };
  let timer = null;
  const store = {
    data,
    save() {
      clearTimeout(timer);
      timer = setTimeout(() => store.flush(), 300);
    },
    flush() {
      clearTimeout(timer);
      const tmp = DATA_FILE + '.tmp';
      // Holds the API key, so keep it private to this user
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, DATA_FILE);
    },
  };
  return store;
}

/** Port lookup for the CLI, without loading the whole store. */
export function configuredPort() {
  if (process.env.LIGHTS_PORT) return +process.env.LIGHTS_PORT;
  return readFileQuiet().port || DEFAULT_PORT;
}

function readFileQuiet() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return {}; }
}
