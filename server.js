#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { format } from 'node:util';
import { loadStore, ROOT, DATA_DIR } from './lib/store.js';
import { CloudApi } from './lib/cloud.js';
import { Lan } from './lib/lan.js';
import { Devices, UserError, SCENE_KINDS } from './lib/devices.js';
import { Fades } from './lib/fades.js';
import { Scheduler } from './lib/scheduler.js';
import { SceneLibrary } from './lib/library.js';
import { Trial } from './lib/trial.js';

const store = loadStore();
const data = store.data;
if (process.env.GOVEE_API_KEY && !data.apiKey) data.apiKey = process.env.GOVEE_API_KEY.trim();
const PORT = +process.env.LIGHTS_PORT || data.port;
const PUBLIC = path.join(ROOT, 'public');
// Changes when the web app's files change, so open pages know to reload after an update
const APP_VERSION = ['public', 'lib/util.js'].flatMap((p) => {
  const full = path.join(ROOT, p);
  return fs.statSync(full).isDirectory() ? fs.readdirSync(full).map((f) => path.join(full, f)) : [full];
}).map((f) => fs.statSync(f).mtimeMs).reduce((a, b) => Math.max(a, b), 0).toString(36);

const today = () => new Date().toLocaleDateString('en-CA');
const cloud = new CloudApi({
  getKey: () => data.apiKey,
  onRequest: () => {
    if (data.usage.day !== today()) data.usage = { day: today(), count: 0 };
    data.usage.count++;
    store.save();
  },
  onTraffic: (r) => devPush(traffic, 'traffic', { via: 'cloud', ...r, payload: small(r.payload), response: small(r.response) }),
});
const lan = new Lan();
const devices = new Devices({ store, cloud, lan });
const fades = new Fades(devices);
const library = (devices.library = new SceneLibrary());
const trial = new Trial(devices);
const clients = new Set();
const scheduler = new Scheduler({ store, devices, fades, notify: (msg) => broadcast('toast', { msg }) });

// ---------- live updates (Server-Sent Events) ----------

function snapshot() {
  const list = devices.list().map((d) => devices.view(d)).sort((a, b) => a.name.localeCompare(b.name));
  return {
    devices: list,
    groups: data.groups,
    favorites: data.favorites,
    myScenes: data.myScenes,
    hiddenScenes: data.hiddenScenes,
    alarms: data.alarms,
    upcoming: scheduler.upcoming(),
    timers: data.timers,
    trial: trial.view(),
    settings: {
      hasKey: !!data.apiKey,
      keyHint: data.apiKey ? '••••' + data.apiKey.slice(-4) : '',
      cloudError: devices.cloudError,
      lanReady: lan.ready,
      lanError: lan.error,
      usage: data.usage.day === today() ? data.usage.count : 0,
      port: PORT,
      urls: urls(),
    },
    now: Date.now(),
    version: APP_VERSION,
  };
}

function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(msg);
}

devices.on('change', () => broadcast('state', snapshot()));
setInterval(() => { for (const res of [...clients, ...devClients]) res.write(': ping\n\n'); }, 25_000);

// ---------- developer page (/dev): what goes over the network, and the server's insides ----------

const DEV_KEEP = 300;
const devClients = new Set();
const traffic = [];
const logs = [];
let devSeq = 0;

function devPush(list, event, entry) {
  const item = { n: ++devSeq, t: Date.now(), ...entry };
  list.push(item);
  if (list.length > DEV_KEEP) list.shift();
  broadcastDev(event, item);
}

// Device lists with every capability can be large; keep the buffer small
function small(v) {
  const s = JSON.stringify(v);
  return s && s.length > 20_000 ? { truncated: `${(s.length / 1024).toFixed(0)} KB, not kept` } : v;
}

lan.on('traffic', (m) => devPush(traffic, 'traffic', { via: 'lan', ...m, data: small(m.data) }));

// Server output also goes to the developer page
for (const level of ['log', 'warn', 'error']) {
  const write = console[level].bind(console);
  console[level] = (...args) => { write(...args); devPush(logs, 'log', { level, text: format(...args) }); };
}

function internals() {
  const q = (x) => (x ? { pending: [...x.jobs.keys()], running: x.running, last: x.last } : null);
  const mem = process.memoryUsage();
  return {
    devices: devices.list().map((d) => ({
      id: d.id, name: devices.nameOf(d), sku: d.sku, inCloud: d.inCloud,
      lan: d.lan && { ip: d.lan.ip, lastSeen: d.lan.lastSeen, active: devices.lanActive(d) },
      state: d.state, stateAt: d.stateAt, poweredAt: d.poweredAt || 0,
      scenes: d.scenes && Object.fromEntries(SCENE_KINDS.map((k) => [k, d.scenes[k].length])), scenesAt: d.scenesAt,
      caps: d.caps.length, queue: q(devices.queues.get(d.id)),
    })),
    fades: [...fades.jobs].map((j) => ({ label: j.label, ids: [...j.ids], startAt: j.startAt, durationMs: j.durationMs, end: j.end })),
    lan: { ready: lan.ready, error: lan.error },
    cloud: { hasKey: !!data.apiKey, error: devices.cloudError, offline: !!devices.cloudOffline, usage: data.usage.day === today() ? data.usage.count : 0 },
    process: {
      pid: process.pid, node: process.version, platform: `${process.platform} ${process.arch}`, startedAt: Date.now() - process.uptime() * 1000,
      rss: mem.rss, heap: mem.heapUsed, dataDir: DATA_DIR, version: APP_VERSION, appPages: clients.size, devPages: devClients.size,
    },
    now: Date.now(),
  };
}

devices.on('change', () => { if (devClients.size) broadcastDev('internals', internals()); });
// Fades and queues move without a "change", so keep the page current while it's open
setInterval(() => { if (devClients.size) broadcastDev('internals', internals()); }, 2000);

function broadcastDev(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of devClients) res.write(msg);
}

// ---------- API ----------

const routes = [];
const route = (method, pattern, fn) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, pattern, re, keys, fn });
};

route('GET', '/api/state', () => snapshot());

route('GET', '/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
  return undefined;
});

route('POST', '/api/control', async (req, res, body) => {
  const ids = devices.resolve(body.target ?? 'all');
  const action = devices.normalizeAction(body.action || {});
  if (!Object.keys(action).length) throw new UserError('Nothing to do');
  // A scene someone picks goes into "My scenes"; one that's part of a favorite doesn't
  const raw = body.action || {};
  const saveScene = !!action.scene && !raw.favorite && !(raw.preset != null && devices.findFavorite(raw.preset));
  // Changing lights that are trying something on means it's a keeper
  if (trial.covers(ids)) trial.keep();
  const results = await devices.apply(ids, action, { saveScene });
  return { results };
});

route('POST', '/api/try', async (req, res, body) => {
  const target = String(body.target ?? 'all');
  const action = devices.normalizeAction(body.action || {});
  if (!action.scene && !action.color && !action.kelvin) throw new UserError('Only scenes and colors can be tried');
  const results = await trial.start(target, devices.resolve(target), action, String(body.label || '').slice(0, 40));
  return { results };
});
route('POST', '/api/try/keep', () => { trial.keep(); return { ok: true }; });
route('POST', '/api/try/undo', async () => { await trial.undo(); return { ok: true }; });

route('DELETE', '/api/my-scenes/:id', (req, res, body, p) => removeById('myScenes', p.id));

// Govee has no API for deleting scenes, so "delete" hides one from this app's lists
route('POST', '/api/scenes/hidden', (req, res, body) => {
  if (!SCENE_KINDS.includes(body.kind) || !body.name) throw new UserError('Which scene?');
  const key = `${body.kind}|${String(body.name).toLowerCase()}`;
  data.hiddenScenes = data.hiddenScenes.filter((k) => k !== key);
  if (body.hidden !== false) data.hiddenScenes.push(key);
  store.save();
  devices.changed();
  return { ok: true };
});

route('POST', '/api/refresh', async (req, res, body) => {
  await devices.refresh({ full: !!body.full });
  return snapshot();
});

route('GET', '/api/scenes', async (req, res, body, params, url) => {
  const ids = devices.resolve(url.searchParams.get('target') || 'all');
  const force = url.searchParams.get('force') === '1';
  // Union of scenes across the target's lights, by name, with Govee's pictures where it has them
  const out = { lightScene: [], diyScene: [], snapshot: [], categories: [] };
  const seen = new Set();
  for (const id of ids) {
    const d = devices.get(id);
    const [s, pics] = await Promise.all([devices.scenesOf(d, force), library.get(d.sku)]);
    for (const kind of ['lightScene', 'diyScene', 'snapshot']) {
      for (const o of s[kind]) {
        const k = kind + '|' + o.name.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        const info = kind === 'lightScene' ? pics[o.name.toLowerCase()] : null;
        out[kind].push({ ...o, sku: d.sku, ...info });
        if (info?.category && !out.categories.includes(info.category)) out.categories.push(info.category);
      }
    }
  }
  return out;
});

route('POST', '/api/timers', (req, res, body) => scheduler.addTimer(body));
route('DELETE', '/api/timers/:id', (req, res, body, p) => { scheduler.removeTimer(p.id); return { ok: true }; });

route('POST', '/api/alarms', (req, res, body) => { const a = scheduler.upsert(body); devices.changed(); return a; });
route('POST', '/api/alarms/preview', (req, res, body) => { scheduler.preview(body); return { ok: true }; });
route('DELETE', '/api/alarms/:id', (req, res, body, p) => { scheduler.remove(p.id); devices.changed(); return { ok: true }; });

route('POST', '/api/groups', (req, res, body) => {
  const name = String(body.name || '').trim().slice(0, 40);
  if (!name) throw new UserError('Group needs a name');
  const group = { id: body.id || randomUUID().slice(0, 8), name, devices: (body.devices || []).map(String) };
  upsertById(data.groups, group);
  return group;
});
route('DELETE', '/api/groups/:id', (req, res, body, p) => removeById('groups', p.id));

route('POST', '/api/favorites', (req, res, body) => {
  const name = String(body.name || '').trim().slice(0, 40);
  if (!name) throw new UserError('Favorite needs a name');
  // Renaming a favorite saved from "what's on now" keeps its looks
  const prev = data.favorites.find((f) => f.id === body.id);
  if (prev?.lights && !body.action) { upsertById(data.favorites, { ...prev, name }); return { ...prev, name }; }
  const action = devices.normalizeAction(body.action || {});
  if (!Object.keys(action).length) throw new UserError('Favorite has nothing in it');
  const fav = { id: body.id || randomUUID().slice(0, 8), name, action };
  upsertById(data.favorites, fav);
  return fav;
});
// Saves how each light looks right now, including looks set in the Govee app
route('POST', '/api/favorites/capture', async (req, res, body) => {
  const prev = body.id ? data.favorites.find((f) => f.id === body.id) : null;
  const name = String(body.name || prev?.name || '').trim().slice(0, 40);
  if (!name) throw new UserError('Favorite needs a name');
  const ids = prev ? Object.keys(prev.lights || {}) : devices.resolve(body.target ?? 'all');
  const lights = await devices.capture(ids);
  if (!Object.keys(lights).length) throw new UserError('No lights to save', 404);
  // A summary look, for the favorite's color dot and for the terminal
  const on = Object.values(lights).filter((l) => l.power !== false);
  const fav = { id: prev?.id || randomUUID().slice(0, 8), name, action: on[0] || { power: false }, lights };
  upsertById(data.favorites, fav);
  return fav;
});
route('DELETE', '/api/favorites/:id', (req, res, body, p) => removeById('favorites', p.id));

route('POST', '/api/devices/:id', (req, res, body, p) => {
  const id = decodeURIComponent(p.id);
  if (!devices.get(id)) throw new UserError('Unknown device', 404);
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 40);
    if (name) data.names[id] = name;
    else delete data.names[id];
  }
  if (body.hidden !== undefined) {
    data.hidden = data.hidden.filter((x) => x !== id);
    if (body.hidden) data.hidden.push(id);
  }
  store.save();
  devices.changed();
  return { ok: true };
});

route('DELETE', '/api/devices/:id', (req, res, body, p) => {
  const id = decodeURIComponent(p.id);
  if (!devices.get(id)) throw new UserError('Unknown device', 404);
  devices.forget(id);
  return { ok: true };
});

route('POST', '/api/settings', async (req, res, body) => {
  if (body.apiKey !== undefined) {
    const key = String(body.apiKey).trim();
    if (key) {
      await cloud.devices(key); // validates the key before saving it
      data.apiKey = key;
      store.save();
      devices.lastRefresh = 0;
      await devices.refresh({ full: true });
      return { ok: true, lights: devices.list().filter((d) => d.inCloud).length };
    }
    data.apiKey = '';
    store.save();
    devices.changed();
  }
  return { ok: true };
});

route('GET', '/api/dev', () => ({ ...internals(), routes: routes.map((r) => ({ method: r.method, path: r.pattern })), traffic, logs }));

route('GET', '/api/dev/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(`event: internals\ndata: ${JSON.stringify(internals())}\n\n`);
  devClients.add(res);
  req.on('close', () => devClients.delete(res));
  return undefined;
});

// Everything the server holds about one light, including Govee's raw capability list
route('GET', '/api/dev/devices/:id', (req, res, body, p) => {
  const d = devices.get(decodeURIComponent(p.id));
  if (!d) throw new UserError('Unknown device', 404);
  return { ...d, view: devices.view(d) };
});

route('POST', '/api/shutdown', (req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) throw new UserError('Only from this computer', 403);
  setTimeout(shutdown, 50);
  return { ok: true };
});

function upsertById(list, item) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
  store.save();
  devices.changed();
}

function removeById(key, id) {
  data[key] = data[key].filter((x) => x.id !== id);
  store.save();
  devices.changed();
  return { ok: true };
}

// ---------- HTTP plumbing ----------

const isLoopback = (addr = '') => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

// Only answer to names this machine could legitimately be reached by (blocks DNS-rebinding tricks)
function hostAllowed(host = '') {
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  const me = os.hostname().toLowerCase().replace(/\.local$/, '');
  return name === 'localhost' || name.endsWith('.local') || name === me || /^[\d.]+$/.test(name) || name.includes(':');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 200_000) { reject(new UserError('Body too large', 413)); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { reject(new UserError('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const send = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

async function handleApi(req, res, url) {
  if (req.method !== 'GET') {
    // A JSON content type can't be sent cross-site without a CORS preflight, which we never approve
    if (!String(req.headers['content-type'] || '').includes('application/json')) throw new UserError('Expected JSON', 415);
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) throw new UserError('Cross-site request blocked', 403);
  }
  // The developer page shows light IDs, addresses and traffic, so only this computer gets it
  if (/^\/api\/dev(\/|$)/.test(url.pathname) && !isLoopback(req.socket.remoteAddress)) {
    throw new UserError('The developer page only works on the computer running the server', 403);
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
    const body = req.method === 'GET' ? {} : await readBody(req);
    const out = await r.fn(req, res, body, params, url);
    if (out !== undefined) send(res, 200, out);
    return;
  }
  throw new UserError('Not found', 404);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const PAGES = { '/': 'index.html', '/dev': 'dev.html' };

function serveStatic(pathname, res) {
  let file;
  if (pathname === '/shared/util.js') file = path.join(ROOT, 'lib', 'util.js');
  else {
    file = path.normalize(path.join(PUBLIC, PAGES[pathname] || decodeURIComponent(pathname)));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
  }
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!hostAllowed(req.headers.host)) return send(res, 403, { error: 'Unknown host' });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      await ready;
      await handleApi(req, res, url);
    }
    else serveStatic(url.pathname, res);
  } catch (e) {
    if (!(e instanceof UserError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
  }
});

function urls() {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}`);
  return [`http://localhost:${PORT}`, ...ips];
}

function shutdown() {
  store.flush();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// A stray network error shouldn't take the alarms down with it
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use — is the lights server already running?` : e.message);
  process.exit(1);
});

// Find lights before answering API calls, so `lights off` right after startup still works
let markReady;
const ready = new Promise((r) => (markReady = r));

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`[${new Date().toLocaleString()}] Lights server running:`);
  for (const u of urls()) console.log('  ' + u);
  keepMacAwake();
  await devices.start();
  if (lan.error) console.warn('[lan]', lan.error);
  if (devices.cloudError) console.warn('[cloud]', devices.cloudError);
  console.log(`Found ${devices.list().length} light(s)`);
  scheduler.start();
  markReady();
});

// While plugged in, stop the Mac from going to sleep on its own, or alarms can't fire.
// (-s only applies on AC power; on battery the Mac sleeps normally. -w ends it with this process.)
function keepMacAwake() {
  if (process.platform !== 'darwin' || process.env.LIGHTS_ALLOW_SLEEP) return;
  try {
    spawn('/usr/bin/caffeinate', ['-s', '-w', String(process.pid)], { stdio: 'ignore' }).on('error', () => {});
  } catch {}
}
