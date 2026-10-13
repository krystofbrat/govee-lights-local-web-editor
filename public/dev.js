// Developer page: shows how the server works while it runs. Reads /api/events (what every page gets)
// and /api/dev/events (LAN and cloud traffic, server output and internals, only sent to this page).
import { kelvinToHex, rgbToHex, intToHex } from '/shared/util.js';

// ---------- small helpers ----------

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const saved = {
  get(k, d) { try { const v = localStorage.getItem('lights-dev:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lights-dev:' + k, JSON.stringify(v)); } catch {} },
};

const ICONS = {
  map: '<path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><path d="M8 2v16M16 6v16"/>',
  bulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
  arrows: '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
  play: '<path d="M6 4l14 8-14 8V4z"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const pad = (n, w = 2) => String(n).padStart(w, '0');
function clock(t) {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
}
let skew = 0; // server clock minus ours
const serverNow = () => Date.now() + skew;
const ago = (t) => (t ? `${dur(serverNow() - t)} ago` : 'never');
const mb = (bytes) => (bytes / 1048576).toFixed(0);
const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const rgb = (c) => (c && typeof c === 'object' ? rgbToHex(+c.r || 0, +c.g || 0, +c.b || 0) : '');
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > 60 ? s.slice(0, 57) + '…' : s; };

/** Pretty JSON with colors. Tokenizes the raw text first, so every piece is escaped exactly once. */
function jsonHtml(v) {
  const s = JSON.stringify(v, null, 2) ?? 'undefined';
  return s.replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (m, str, colon, lit) => {
    if (str) return `<span class="${colon ? 'k' : 's'}">${esc(str)}</span>${colon || ''}`;
    return `<span class="${lit ? 'l' : 'n'}">${m}</span>`;
  });
}
const json = (v) => `<pre class="code json">${jsonHtml(v)}</pre>`;

// ---------- state ----------

let S = null;       // what every page gets: lights, groups, alarms… (/api/events)
let D = null;       // the server's insides (/api/dev/events)
let routes = [];
let traffic = [];   // LAN and cloud messages, oldest first
let logs = [];      // server output
const events = [];  // what /api/events pushed
let eventSeq = 0;
const live = { app: false, dev: false };
let appVersion = null;
const KEEP = 500;

const ui = {
  tab: saved.get('tab', 'overview'),
  show: saved.get('show', { lan: true, cloud: true, polls: false }),
  pausedAt: 0,        // traffic is frozen at this entry while paused
  open: null,         // the traffic row or event being looked at
  raw: new Map(),     // device id → its raw JSON, while shown
  api: { method: 'GET', path: '/api/state', body: '', result: null, busy: false },
};

const TABS = [
  ['overview', 'Overview', 'map'], ['lights', 'Lights', 'bulb'], ['traffic', 'Traffic', 'arrows'],
  ['events', 'Events', 'bolt'], ['console', 'Console', 'terminal'], ['api', 'API', 'code'],
];

const devById = (id) => S?.devices.find((d) => d.id === id);
const nameByIp = (ip) => S?.devices.find((d) => d.ip === ip)?.name || '';
const trim = (list) => { if (list.length > KEEP) list.splice(0, list.length - KEEP); };

// ---------- live connections ----------

function connect() {
  const app = new EventSource('/api/events');
  app.addEventListener('state', (e) => {
    const next = JSON.parse(e.data);
    // The app was updated: load the new version of this page too
    if (appVersion && next.version !== appVersion) return location.reload();
    appVersion = next.version;
    addEvent('state', e.data.length, S ? diff(S, next) : ['Everything, sent when a page connects'], next);
    S = next;
    live.app = true;
    schedule();
  });
  app.addEventListener('toast', (e) => {
    const msg = JSON.parse(e.data);
    addEvent('toast', e.data.length, [msg.msg], msg);
    schedule();
  });
  app.onerror = () => { live.app = false; schedule(); };

  const dev = new EventSource('/api/dev/events');
  // On every (re)connect, take the server's recent history; a restarted server starts a new one
  dev.onopen = async () => {
    traffic = [];
    logs = [];
    try {
      const r = await (await fetch('/api/dev')).json();
      routes = r.routes;
      const merge = (old, fresh) => [...old, ...fresh.filter((x) => x.n > (old.at(-1)?.n ?? 0))];
      traffic = merge(r.traffic, traffic);
      logs = merge(r.logs, logs);
      schedule(true);
    } catch {}
  };
  dev.addEventListener('internals', (e) => {
    D = JSON.parse(e.data);
    skew = D.now - Date.now();
    live.dev = true;
    schedule();
  });
  dev.addEventListener('traffic', (e) => { traffic.push(JSON.parse(e.data)); trim(traffic); schedule(); });
  dev.addEventListener('log', (e) => { logs.push(JSON.parse(e.data)); trim(logs); schedule(); });
  dev.onerror = () => { live.dev = false; schedule(); };
}

function addEvent(type, bytes, changes, data) {
  events.push({ n: ++eventSeq, t: Date.now(), type, bytes, changes, data });
  if (events.length > 100) events.shift();
}

/** What changed between two snapshots, in words */
function diff(a, b) {
  const out = [];
  const before = new Map(a.devices.map((d) => [d.id, d]));
  const show = (v) => (v == null ? '–' : String(v));
  for (const d of b.devices) {
    const p = before.get(d.id);
    if (!p) { out.push(`${d.name}: new light`); continue; }
    for (const k of ['online', 'power', 'brightness', 'color', 'kelvin', 'scene']) {
      if (p.state[k] !== d.state[k]) out.push(`${d.name}: ${k} ${show(p.state[k])} → ${show(d.state[k])}`);
    }
    if (p.via !== d.via) out.push(`${d.name}: route ${p.via} → ${d.via}`);
    if (p.fading !== d.fading) out.push(`${d.name}: ${d.fading ? `${d.fading} started` : `${p.fading} ended`}`);
    if (p.name !== d.name || p.hidden !== d.hidden) out.push(`${d.name}: renamed or shown/hidden`);
  }
  for (const d of a.devices) if (!b.devices.some((x) => x.id === d.id)) out.push(`${d.name}: forgotten`);
  for (const k of ['groups', 'favorites', 'myScenes', 'hiddenScenes', 'alarms', 'timers', 'trial']) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`${k} changed`);
  }
  for (const k of Object.keys(b.settings)) {
    if (JSON.stringify(a.settings[k]) !== JSON.stringify(b.settings[k])) out.push(`settings.${k}: ${short(a.settings[k] ?? '–')} → ${short(b.settings[k] ?? '–')}`);
  }
  return out.length ? out : ['Nothing you can see changed (a light confirmed its state)'];
}

// ---------- rendering ----------

let frame = 0;
let force = false;
/** Re-renders once per frame at most. The API tab keeps its inputs, so it only redraws when asked. */
function schedule(all = false) {
  force ||= all;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    // Don't wipe out text someone is selecting to copy; try again in a moment
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed && $('#view').contains(sel.anchorNode)) { setTimeout(schedule, 800); return; }
    renderTop();
    if (ui.tab !== 'api' || force) renderView();
    force = false;
  });
}

function renderTop() {
  $('#tabs').innerHTML = TABS.map(([id, label, ic]) =>
    `<button class="tab" data-action="tab" data-tab="${id}" ${ui.tab === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></button>`).join('');
  const ok = live.app && live.dev;
  $('#top-actions').innerHTML = `<span class="pill live ${ok ? 'ok' : ''}" role="status"><span class="live-dot" aria-hidden="true"></span><span class="pill-label">${ok ? 'Live' : 'Reconnecting…'}</span></span>
    <a class="pill" href="/">${icon('back')}<span class="pill-label">App</span></a>`;
}

function renderView() {
  const view = $('#view');
  if (!S || !D) { view.innerHTML = '<p class="muted">Connecting to the lights server…</p>'; return; }
  view.innerHTML = VIEWS[ui.tab]();
}

const lead = (html) => `<p class="lead">${html}</p>`;
const section = (title, body, extra = '') => `<section class="section"><div class="section-head"><h2>${title}</h2>${extra}</div>${body}</section>`;

// ---------- How it works ----------

const TIMINGS = [
  ['Look for lights on Wi-Fi (multicast scan)', 'every 60 s', 'lib/devices.js'],
  ['Ask each Local Wi-Fi light for its state', 'every 10 s, and 0.6 s after a command', 'lib/devices.js'],
  ['Give up on Local Wi-Fi and use the cloud', 'no answer for 3 min', 'lib/devices.js'],
  ['Ask Govee for cloud-only lights’ state', 'every 5 min (saves the daily quota)', 'lib/devices.js'],
  ['Time between cloud requests for one light', '450 ms at least', 'lib/devices.js'],
  ['Keep a light’s scene list', '6 h', 'lib/devices.js'],
  ['Fades and sunrises take a step', 'every 2 s on Local Wi-Fi, 20 s on the cloud', 'lib/fades.js'],
  ['Check whether an alarm is due', 'every 5 s (up to 5 min late if the Mac was asleep)', 'lib/scheduler.js'],
  ['Trying a scene or color', '10 s, then it goes back', 'lib/trial.js'],
  ['Tell open pages something changed', 'within 120 ms', 'lib/devices.js'],
];

const FILES = [
  ['server.js', 'HTTP API, live updates and the alarm scheduler'],
  ['bin/lights.js', 'the lights command; talks to the server over HTTP like the web app does'],
  ['lib/devices.js', 'merges LAN and cloud lights and sends each command the fastest way'],
  ['lib/lan.js', 'Govee’s LAN protocol: JSON over UDP (scan on 4001, answers on 4002, commands on 4003)'],
  ['lib/cloud.js', 'Govee Developer API v2 client'],
  ['lib/fades.js', 'sunrise and fade-out engine'],
  ['lib/scheduler.js', 'alarms and sleep timers'],
  ['lib/trial.js', 'try a look for a few seconds, then undo or keep'],
  ['lib/library.js', 'scene pictures and categories (optional)'],
  ['lib/store.js', 'reads and writes data/lights.json'],
  ['lib/util.js', 'colors, times and parsing, shared with the browser at /shared/util.js'],
  ['public/', 'the web app and this page: plain HTML, CSS and JavaScript, no build step'],
];

function stat(label, value, sub, status = '') {
  return `<div class="stat"><span class="stat-label">${status ? `<span class="led ${status}" aria-hidden="true"></span>` : ''}${label}</span>
    <b class="stat-value">${value}</b><span class="stat-sub">${sub}</span></div>`;
}

function viewOverview() {
  const p = D.process;
  const now = serverNow();
  const minute = traffic.filter((x) => now - x.t < 60_000);
  const count = (fn) => minute.filter(fn).length;
  const lanOut = count((x) => x.via === 'lan' && x.dir === 'out');
  const lanIn = count((x) => x.via === 'lan' && x.dir === 'in');
  const cloudReqs = count((x) => x.via === 'cloud');
  const all = D.devices.length;
  const onLan = D.devices.filter((d) => d.lan?.active).length;
  const inCloud = D.devices.filter((d) => d.inCloud).length;
  const lit = S.devices.filter((d) => d.state.online !== false && d.state.power).length;
  const next = S.upcoming[0];
  const nextAlarm = next ? `Next alarm starts in ${dur(next.start - now)}` : 'No alarms coming up';
  const cloud = D.cloud;

  return `
    ${lead('Everything on this page comes live from the running server. The server sits between your devices and the lights: it speaks to them over your Wi-Fi when it can, and through Govee’s cloud when it has to.')}

    ${section('Right now', `<div class="stats">
      ${stat('Server', `Up ${dur(now - p.startedAt)}`, `Node ${esc(p.node)} · pid ${p.pid} · ${mb(p.rss)} MB`, 'ok')}
      ${stat('Local Wi-Fi', D.lan.ready ? `${onLan} of ${plural(all, 'light')} answering` : 'Off', esc(D.lan.error || 'UDP ports 4001, 4002 and 4003'), D.lan.ready ? (onLan ? 'ok' : 'warn') : 'bad')}
      ${stat('Govee cloud', !cloud.hasKey ? 'No API key' : cloud.error ? (cloud.offline ? 'Offline' : 'Error') : `${plural(inCloud, 'light')} in your account`,
        esc(cloud.error || `${cloud.usage.toLocaleString()} of 10,000 requests today`), !cloud.hasKey ? 'warn' : cloud.error ? 'bad' : 'ok')}
      ${stat('Live connections', plural(p.appPages + p.devPages, 'stream'), `${p.appPages} on /api/events, ${p.devPages} on /api/dev/events (this page uses one of each)`)}
      ${stat('Running', `${plural(D.fades.length, 'fade')} · ${plural(S.timers.length, 'timer')}`, nextAlarm)}
    </div>`)}

    <div class="how">
      ${section('How a command reaches a light', `<div class="flow" aria-label="Diagram">
        <div class="node"><b>Web app or <code>lights</code> command</b><span>Sends JSON to <code>POST /api/control</code></span></div>
        <div class="flow-arrow" aria-hidden="true"></div>
        <div class="node"><b>server.js on port ${location.port || 80}</b><span>Checks the request, then finds the lights and validates the action</span></div>
        <div class="flow-arrow" aria-hidden="true"></div>
        <div class="node"><b>lib/devices.js</b><span>Picks the fastest way for each light</span></div>
        <div class="split">
          <div class="node lan"><b>Local Wi-Fi</b><span>UDP JSON straight to the light, port 4003</span><em>${lanOut} sent · ${lanIn} received in the last minute</em></div>
          <div class="node cloud"><b>Govee cloud</b><span>HTTPS to openapi.api.govee.com, one request per light every 450 ms at most</span><em>${plural(cloudReqs, 'request')} in the last minute</em></div>
        </div>
        <div class="flow-arrow" aria-hidden="true"></div>
        <div class="node"><b>Your lights</b><span>${plural(all, 'light')} known, ${lit} on</span></div>
      </div>`)}

      ${section('Step by step', `<ol class="explain">
        <li><b>You tap or type.</b> The web app and the <code>lights</code> command both send <code>POST /api/control</code> with a <i>target</i> (<code>all</code>, <code>group:ID</code>, <code>device:ID</code> or a name) and an <i>action</i>. Try it in the <a href="#" data-action="tab" data-tab="api">API</a> tab.</li>
        <li><b>The server checks it.</b> It only accepts JSON from its own pages, so other websites can’t control your lights. Then <code>resolve()</code> turns the target into light IDs and <code>normalizeAction()</code> checks the action (“warm” becomes 2700 K, brightness stays within 1–100).</li>
        <li><b>Each light gets the fastest route.</b> If it answered on Local Wi-Fi in the last 3 minutes, the command goes straight to it over UDP and lands instantly. Otherwise it goes through Govee’s cloud. Scenes, music and segments only exist in the cloud API, so they always go there.</li>
        <li><b>Cloud requests wait their turn.</b> Govee allows about 2 changes a second per light, so each light has a queue. When the same kind of change is still waiting (dragging a slider), only the newest one is sent.</li>
        <li><b>Every page hears about it.</b> The server pushes the new state to every open page over <code>/api/events</code>. Watch it in the <a href="#" data-action="tab" data-tab="events">Events</a> tab.</li>
        <li><b>The lights confirm.</b> Local Wi-Fi lights are asked for their state shortly after each command and every 10 seconds. You can see these status checks in <a href="#" data-action="tab" data-tab="traffic">Traffic</a>.</li>
      </ol>`)}
    </div>

    ${section('Timings', `<div class="list table">${TIMINGS.map(([what, when, file]) =>
      `<div class="list-row"><span class="grow">${what}</span><b>${when}</b><code class="faint">${file}</code></div>`).join('')}</div>`)}

    ${section('Files', `<div class="list table">${FILES.map(([file, what]) =>
      `<div class="list-row"><code class="file">${file}</code><span class="grow muted">${what}</span></div>`).join('')}</div>
      <p class="hint" style="margin-top:10px">Edit a file, run <code>lights restart</code>, and open pages (this one too) reload by themselves. Server data: <code>${esc(p.dataDir)}</code></p>`)}`;
}

// ---------- Lights ----------

function look(s) {
  if (s.online === false) return 'Offline';
  if (s.power == null) return 'Unknown';
  if (!s.power) return 'Off';
  return ['On', s.brightness != null && `${s.brightness}%`, s.scene || (s.kelvin ? `${s.kelvin} K` : s.color)].filter(Boolean).join(' · ');
}
const swatch = (s) => (s.online === false || !s.power ? 'var(--card-3)' : s.kelvin ? kelvinToHex(s.kelvin) : /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : 'var(--accent)');

function canDo(c) {
  return [
    c.power && 'on/off', c.brightness && `brightness ${c.brightness.min}–${c.brightness.max}`, c.color && 'color',
    c.kelvin && `white ${c.kelvin.min}–${c.kelvin.max} K`, c.scenes && 'scenes', c.diy && 'DIY scenes', c.snapshots && 'snapshots',
    c.music && `music (${plural(c.music.modes.length, 'mode')})`, c.segments?.count && `${c.segments.count} segments`,
    ...c.toggles.map((t) => t.name), ...c.modes.map((m) => m.name),
  ].filter(Boolean).join(', ');
}

function route(d, v) {
  const lan = d.lan;
  if (lan?.active) {
    return `Local Wi-Fi: UDP to <code>${esc(lan.ip)}:4003</code>, last answer ${ago(lan.lastSeen)}.${d.inCloud && D.cloud.hasKey ? ' Scenes, music and segments still use the cloud.' : ''}`;
  }
  const cloudOk = d.inCloud && D.cloud.hasKey;
  if (lan) return `No Local Wi-Fi answer from <code>${esc(lan.ip)}</code> ${lan.lastSeen ? `for ${dur(serverNow() - lan.lastSeen)}` : 'since the server started'}, so ${cloudOk ? 'commands go through the cloud' : 'it can’t be reached right now'}.`;
  if (cloudOk) return 'Cloud only: it never answered on Local Wi-Fi. Switch on LAN Control for it in the Govee app to make it instant.';
  return v?.via === 'unreachable' ? 'Not reachable: no Local Wi-Fi answer, and it isn’t in the cloud with the current API key.' : '–';
}

function viewLights() {
  const list = [...D.devices].sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return lead('No lights found yet. Check the API key or LAN Control, then <code>POST /api/refresh</code>.');
  return `${lead('What the server knows about each light, and why it talks to it the way it does.')}
    <div class="cards">${list.map((d) => {
      const v = devById(d.id);
      const s = v?.state || d.state;
      const q = d.queue;
      const raw = ui.raw.get(d.id);
      return `<article class="card-dev">
        <div class="card-dev-head"><span class="swatch" style="--c:${swatch(s)}" aria-hidden="true"></span>
          <div class="grow"><b>${esc(d.name)}</b><div class="hint">${esc(d.sku || 'unknown model')}${v?.hidden ? ' · hidden' : ''}</div></div>
          <span class="badge-via ${v?.via === 'unreachable' ? 'off' : v?.via.startsWith('lan') ? 'lan' : ''}">${esc(v?.via || '?')}</span></div>
        <dl class="kv">
          <dt>ID</dt><dd><code>${esc(d.id)}</code></dd>
          <dt>Route</dt><dd>${route(d, v)}</dd>
          <dt>Looks</dt><dd>${esc(look(s))}${v?.fading ? ` · <b>${esc(v.fading)}</b>` : ''}</dd>
          <dt>Last state</dt><dd>${d.stateAt ? ago(d.stateAt) : 'not yet'}${d.lan?.active ? ' (Local Wi-Fi)' : d.inCloud ? ' (cloud)' : ''}</dd>
          <dt>Can do</dt><dd>${esc(v ? canDo(v.caps) : '–')}${d.caps ? ` <span class="faint">· ${d.caps} Govee capabilities</span>` : ''}</dd>
          ${d.scenes ? `<dt>Scenes</dt><dd>${d.scenes.lightScene} scenes, ${d.scenes.diyScene} DIY, ${d.scenes.snapshot} snapshots, fetched ${ago(d.scenesAt)}</dd>` : ''}
          <dt>Cloud queue</dt><dd>${q?.pending.length ? `Waiting: ${esc(q.pending.join(', '))}` : q?.running ? 'Sending…' : q ? `Idle, last request ${ago(q.last)}` : 'Nothing sent yet'}</dd>
        </dl>
        <div class="row-actions">
          <button class="btn small" data-action="raw" data-id="${esc(d.id)}" aria-expanded="${!!raw}">${icon('code')}${raw ? 'Hide raw' : 'Raw JSON'}</button>
          <button class="btn small ghost" data-action="try-api" data-id="${esc(d.id)}">${icon('send')}Send a command</button>
        </div>
        ${raw ? json(raw) : ''}
      </article>`;
    }).join('')}</div>`;
}

// ---------- Traffic ----------

const isPoll = (x) => x.via === 'lan' && (x.cmd === 'devStatus' || x.cmd === 'scan');
/** A capability value the way a person would say it */
function capValue(c) {
  if (c.instance === 'colorRgb' && Number.isInteger(c.value)) return intToHex(c.value);
  if (c.instance === 'colorTemperatureK') return `${c.value} K`;
  if (c.instance === 'powerSwitch') return c.value ? 'on' : 'off';
  return short(c.value);
}
const CLOUD_PATHS = { '/user/devices': 'List lights', '/device/state': 'Get state', '/device/scenes': 'List scenes', '/device/diy-scenes': 'List DIY scenes' };

/** One line about a message: who it's for, what it says, and how it went */
function describe(x) {
  if (x.via === 'lan') {
    const d = x.data && typeof x.data === 'object' ? x.data : {};
    const out = x.dir === 'out';
    const who = x.cmd === 'scan' ? (out ? 'Everyone' : d.sku || '') : nameByIp(x.ip);
    const lines = {
      scan: () => (out ? 'Who’s there? (multicast to 239.255.255.250:4001)' : `Here I am: ${d.device || '?'}`),
      devStatus: () => (out ? 'What’s your state?' : `${d.onOff === 1 ? 'On' : 'Off'} · ${d.brightness}% · ${+d.colorTemInKelvin ? `${d.colorTemInKelvin} K` : rgb(d.color)}`),
      turn: () => `Turn ${d.value ? 'on' : 'off'}`,
      brightness: () => `Brightness ${d.value}%`,
      colorwc: () => (+d.colorTemInKelvin ? `White ${d.colorTemInKelvin} K` : `Color ${rgb(d.color)}`),
    };
    const color = (x.cmd === 'colorwc' || (x.cmd === 'devStatus' && !out)) ? (+d.colorTemInKelvin ? kelvinToHex(+d.colorTemInKelvin) : rgb(d.color)) : '';
    return { who, where: x.ip, what: Object.hasOwn(lines, x.cmd) ? lines[x.cmd]() : x.cmd, color };
  }
  const p = x.payload || {};
  const c = p.capability;
  return {
    who: devById(p.device)?.name || (p.device ? p.device : ''),
    where: `${x.method} ${x.path}`,
    what: c ? `${c.instance} = ${capValue(c)}` : CLOUD_PATHS[x.path] || x.path,
    color: c?.instance === 'colorRgb' && Number.isInteger(c.value) ? intToHex(c.value) : c?.instance === 'colorTemperatureK' ? kelvinToHex(+c.value || 2000) : '',
    res: x.status ? `${x.status} · ${x.ms} ms` : `no answer · ${x.ms} ms`,
    err: x.error,
  };
}

function viewTraffic() {
  const show = ui.show;
  const upto = ui.pausedAt || Infinity;
  const kept = traffic.filter((x) => x.n <= upto);
  const polls = kept.filter(isPoll).length;
  const rows = kept.filter((x) => (x.via === 'lan' ? show.lan : show.cloud) && (show.polls || !isPoll(x))).reverse();
  const waiting = ui.pausedAt ? traffic.filter((x) => x.n > ui.pausedAt).length : 0;
  const chip = (key, label) => `<button class="chip" data-action="show" data-key="${key}" aria-pressed="${!!show[key]}">${label}</button>`;
  return `${lead('Every message between the server and your lights, newest first. → is sent by the server, ← came back. Click one to see exactly what was sent.')}
    <div class="toolbar">
      <div class="chips">${chip('lan', 'Local Wi-Fi')}${chip('cloud', 'Govee cloud')}${chip('polls', `Status checks${polls && !show.polls ? ` (${polls} hidden)` : ''}`)}</div>
      <div class="toolbar-end">
        <button class="btn small" data-action="pause">${ui.pausedAt ? `${icon('play')}Resume${waiting ? ` (${waiting} new)` : ''}` : `${icon('pause')}Pause`}</button>
        <button class="btn small ghost" data-action="clear-traffic">${icon('trash')}Clear</button>
      </div>
    </div>
    ${rows.length ? `<div class="rows">${rows.map((x) => {
      const d = describe(x);
      const open = ui.open === `t${x.n}`;
      return `<button class="trow ${x.error ? 'bad' : ''}" data-action="open" data-key="t${x.n}" aria-expanded="${open}">
          <time>${clock(x.t)}</time>
          <span class="badge-via ${x.via === 'lan' ? 'lan' : ''}">${x.via === 'lan' ? 'LAN' : 'Cloud'}</span>
          <span class="dir" title="${x.dir === 'in' ? 'received' : 'sent'}">${x.dir === 'in' ? '←' : '→'}</span>
          <span class="who">${esc(d.who || d.where)}</span>
          <span class="what">${d.color ? `<span class="dot" style="--c:${d.color}" aria-hidden="true"></span>` : ''}${esc(d.what)}</span>
          <span class="res">${esc(d.err || d.res || d.where)}</span>
        </button>${open ? `<div class="detail">${json(x)}</div>` : ''}`;
    }).join('')}</div>` : `<p class="empty">${traffic.length ? 'Nothing matches the filters.' : 'Nothing sent yet. Change a light in the app and watch it appear here.'}</p>`}`;
}

// ---------- Events ----------

function viewEvents() {
  const list = [...events].reverse();
  return `${lead('What the server pushes to every open page over <code>/api/events</code> (server-sent events). A <b>state</b> event always carries the whole picture; below each one is what changed since the one before.')}
    <div class="toolbar"><span class="hint">${plural(events.length, 'event')} since this page opened</span>
      <div class="toolbar-end"><button class="btn small ghost" data-action="clear-events">${icon('trash')}Clear</button></div></div>
    <div class="rows">${list.map((e) => {
      const open = ui.open === `e${e.n}`;
      const more = e.changes.length - 4;
      return `<button class="erow" data-action="open" data-key="e${e.n}" aria-expanded="${open}">
          <time>${clock(e.t)}</time><span class="badge-via ${e.type === 'toast' ? 'lan' : ''}">${e.type}</span><span class="faint size">${kb(e.bytes)}</span>
          <span class="changes">${e.changes.slice(0, 4).map((c) => `<span>${esc(c)}</span>`).join('')}${more > 0 ? `<span class="faint">and ${more} more</span>` : ''}</span>
        </button>${open ? `<div class="detail">${e.changes.length > 4 ? `<ul class="all-changes">${e.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}${json(e.data)}</div>` : ''}`;
    }).join('')}</div>`;
}

// ---------- Console ----------

function viewConsole() {
  const list = [...logs].reverse();
  return `${lead('What the server printed since it started (the last 300 lines). Everything also goes to <code>data/server.log</code> when it runs as a service: <code>lights logs</code> shows it.')}
    <div class="toolbar"><span class="hint">${plural(logs.length, 'line')}</span>
      <div class="toolbar-end"><button class="btn small ghost" data-action="clear-logs">${icon('trash')}Clear</button></div></div>
    ${list.length ? `<div class="rows">${list.map((l) =>
      `<div class="lrow ${l.level}"><time>${clock(l.t)}</time><span class="lvl">${l.level === 'log' ? 'info' : l.level}</span><pre>${esc(l.text)}</pre></div>`).join('')}</div>`
      : '<p class="empty">Nothing printed yet.</p>'}`;
}

// ---------- API explorer ----------

const ROUTE_INFO = {
  'GET /api/state': ['Everything the web app shows: lights, groups, favorites, alarms and settings.'],
  'GET /api/events': ['A live stream (server-sent events), so it can’t be sent from here. Watch it in the Events tab.'],
  'POST /api/control': ['Change lights. target: "all", "group:ID", "device:ID" or a name. action: power ("toggle" too), brightness, color, kelvin, scene, music, segments or favorite.',
    { target: 'all', action: { power: true, brightness: 60, kelvin: 'warm' } }],
  'POST /api/try': ['Show a scene or color for 10 seconds, then go back unless it’s kept.', { target: 'all', action: { color: 'teal' }, label: 'Teal' }],
  'POST /api/try/keep': ['Keep what’s being tried.', {}],
  'POST /api/try/undo': ['Go back to how the lights looked before trying.', {}],
  'DELETE /api/my-scenes/:id': ['Remove a scene from My scenes.'],
  'POST /api/scenes/hidden': ['Hide a Govee scene from this app’s lists; "hidden": false brings it back.', { kind: 'lightScene', name: 'Aurora', hidden: true }],
  'POST /api/refresh': ['Ask every light for its state. "full" also lists lights from Govee again and scans the Wi-Fi.', { full: true }],
  'GET /api/scenes': ['Scenes the target can show, with Govee’s pictures. Add &force=1 to skip the 6-hour cache.'],
  'POST /api/timers': ['Sleep timer: fade out over the minutes, then off.', { target: 'all', minutes: 30, fade: true }],
  'DELETE /api/timers/:id': ['Cancel a sleep timer.'],
  'POST /api/alarms': ['Create an alarm, or change one by including its id.', { name: 'Wake up', type: 'sunrise', time: '07:00', days: [1, 2, 3, 4, 5], target: ['all'], duration: 30 }],
  'POST /api/alarms/preview': ['Play an alarm now, sped up: a sunrise takes 30 seconds.', { type: 'sunrise', time: '07:00', target: ['all'] }],
  'DELETE /api/alarms/:id': ['Delete an alarm.'],
  'POST /api/groups': ['Create a group, or change one by including its id.', { name: 'Bedroom', devices: [] }],
  'DELETE /api/groups/:id': ['Delete a group. Its lights stay.'],
  'POST /api/favorites': ['Save a look as a favorite.', { name: 'Cozy', action: { kelvin: 2700, brightness: 40 } }],
  'POST /api/favorites/capture': ['Save how each light looks right now as one favorite.', { name: 'Right now', target: 'all' }],
  'DELETE /api/favorites/:id': ['Delete a favorite.'],
  'POST /api/devices/:id': ['Rename ("name") or hide ("hidden") a light. An empty name goes back to Govee’s.', { name: 'Desk lamp' }],
  'DELETE /api/devices/:id': ['Forget a light you no longer have.'],
  'POST /api/settings': ['"apiKey" checks a Govee API key, then saves it; an empty one removes it. "location": "50.08, 14.43" sets where you are (for sun times), null removes it.', { location: '50.08, 14.43' }],
  'POST /api/shutdown': ['Stops the server. Only accepted from this computer.', {}],
  'GET /api/dev': ['What this page reads: the server’s insides, its routes, recent traffic and output.'],
  'GET /api/dev/events': ['This page’s live stream, so it can’t be sent from here.'],
  'GET /api/dev/devices/:id': ['Everything the server holds about one light, including Govee’s raw capabilities.'],
};

// Fills ":id" with something that exists, so the example works as is
const ID_FROM = {
  '/api/devices/': () => S.devices[0]?.id, '/api/dev/devices/': () => S.devices[0]?.id, '/api/groups/': () => S.groups[0]?.id,
  '/api/favorites/': () => S.favorites[0]?.id, '/api/alarms/': () => S.alarms[0]?.id, '/api/timers/': () => S.timers[0]?.id,
  '/api/my-scenes/': () => S.myScenes[0]?.id,
};

function pickRoute(method, pattern) {
  const info = ROUTE_INFO[`${method} ${pattern}`] || [];
  let path = pattern;
  if (pattern.endsWith('/:id')) {
    const id = ID_FROM[pattern.slice(0, -3)]?.();
    if (id) path = pattern.slice(0, -3) + encodeURIComponent(id);
  }
  if (pattern === '/api/scenes') path += '?target=all';
  Object.assign(ui.api, { method, path, body: method === 'POST' ? JSON.stringify(info[1] ?? {}, null, 2) : '', result: null });
}

function curl() {
  const { method, path, body } = ui.api;
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  let cmd = `curl${method === 'GET' ? '' : ` -X ${method}`} ${q(location.origin + path)}`;
  if (method !== 'GET') {
    let compact = body.trim() || '{}';
    try { compact = JSON.stringify(JSON.parse(compact)); } catch {}
    cmd += ` \\\n  -H 'Content-Type: application/json' -d ${q(compact)}`;
  }
  return cmd;
}

function viewApi() {
  const a = ui.api;
  const pattern = routes.find((r) => r.method === a.method && new RegExp('^' + r.path.replace(/:\w+/g, '[^/]+') + '$').test(a.path.split('?')[0]));
  const info = pattern ? ROUTE_INFO[`${pattern.method} ${pattern.path}`]?.[0] : '';
  return `${lead('Every route the server answers, the same ones the web app and the <code>lights</code> command use. Pick one, change it, send it. These are real: they change your lights.')}
    <div class="api">
      <nav class="routes" aria-label="Routes">${routes.map((r) => {
        const on = pattern === r;
        return `<button class="route ${on ? 'on' : ''}" data-action="route" data-method="${r.method}" data-path="${esc(r.path)}" ${on ? 'aria-current="true"' : ''}>
          <span class="method ${r.method.toLowerCase()}">${r.method}</span><code>${esc(r.path)}</code></button>`;
      }).join('')}</nav>
      <div class="api-main">
        <div class="panel">
          <div class="input-row">
            <select class="input method-select" data-input="method" aria-label="Method">${['GET', 'POST', 'DELETE'].map((m) => `<option ${m === a.method ? 'selected' : ''}>${m}</option>`).join('')}</select>
            <input class="input mono" data-input="path" value="${esc(a.path)}" aria-label="Path" spellcheck="false" autocomplete="off">
          </div>
          <p class="hint" id="api-info">${esc(info || 'Not a route the server knows.')}</p>
          ${a.method === 'POST' ? `<textarea class="input mono" data-input="body" rows="8" spellcheck="false" aria-label="JSON body">${esc(a.body)}</textarea>` : ''}
          <div class="row-actions">
            <button class="btn primary" data-action="send" ${a.busy ? 'disabled' : ''}>${icon('send')}${a.busy ? 'Sending…' : 'Send'}</button>
            <button class="btn small ghost" data-action="copy-curl">${icon('copy')}Copy as curl</button>
          </div>
          <pre class="code" id="curl">${esc(curl())}</pre>
        </div>
        <div id="api-result">${apiResult()}</div>
      </div>
    </div>`;
}

function apiResult() {
  const r = ui.api.result;
  if (!r) return '';
  if (r.error) return `<p class="callout error">${esc(r.error)}</p>`;
  return `<div class="result-head"><span class="status ${r.ok ? 'ok' : 'bad'}">${r.status}</span><span class="hint">${r.ms} ms · ${kb(r.bytes)}</span></div>${json(r.json)}`;
}

async function send() {
  const a = ui.api;
  const path = a.path.trim();
  const done = (result) => { a.result = result; a.busy = false; schedule(true); };
  if (!path.startsWith('/')) return done({ error: 'The path starts with /, like /api/state' });
  if (/\/events$/.test(path.split('?')[0])) return done({ error: 'That’s a live stream; it never finishes. The Events tab shows it.' });
  let body;
  if (a.method !== 'GET') {
    try { body = a.body.trim() ? JSON.parse(a.body) : {}; } catch (e) { return done({ error: `The body isn’t valid JSON: ${e.message}` }); }
  }
  if (path === '/api/shutdown' && !confirm('This stops the lights server, and alarms won’t fire until it starts again. Stop it?')) return;
  a.busy = true;
  schedule(true);
  const started = performance.now();
  try {
    const res = await fetch(path, {
      method: a.method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let out = text;
    try { out = JSON.parse(text); } catch {}
    done({ status: res.status, ok: res.ok, ms: Math.round(performance.now() - started), bytes: text.length, json: out });
  } catch (e) {
    done({ error: `No answer from the server: ${e.message}` });
  }
}

// ---------- input ----------

const VIEWS = { overview: viewOverview, lights: viewLights, traffic: viewTraffic, events: viewEvents, console: viewConsole, api: viewApi };

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  if (el.tagName === 'A') e.preventDefault();
  if (act === 'tab') {
    ui.tab = el.dataset.tab;
    ui.open = null;
    saved.set('tab', ui.tab);
    schedule(true);
    scrollTo(0, 0);
  } else if (act === 'show') {
    ui.show[el.dataset.key] = !ui.show[el.dataset.key];
    saved.set('show', ui.show);
    schedule(true);
  } else if (act === 'pause') {
    ui.pausedAt = ui.pausedAt ? 0 : traffic.at(-1)?.n ?? -1;
    schedule(true);
  } else if (act === 'clear-traffic') {
    traffic = [];
    ui.pausedAt = 0;
    schedule(true);
  } else if (act === 'clear-events') {
    events.length = 0;
    schedule(true);
  } else if (act === 'clear-logs') {
    logs = [];
    schedule(true);
  } else if (act === 'open') {
    ui.open = ui.open === el.dataset.key ? null : el.dataset.key;
    schedule(true);
  } else if (act === 'raw') {
    const id = el.dataset.id;
    if (ui.raw.has(id)) ui.raw.delete(id);
    else {
      try { ui.raw.set(id, await (await fetch(`/api/dev/devices/${encodeURIComponent(id)}`)).json()); } catch {}
    }
    schedule(true);
  } else if (act === 'try-api') {
    Object.assign(ui.api, {
      method: 'POST', path: '/api/control', result: null,
      body: JSON.stringify({ target: `device:${el.dataset.id}`, action: { power: 'toggle' } }, null, 2),
    });
    ui.tab = 'api';
    saved.set('tab', ui.tab);
    schedule(true);
    scrollTo(0, 0);
  } else if (act === 'route') {
    pickRoute(el.dataset.method, el.dataset.path);
    schedule(true);
  } else if (act === 'send') {
    send();
  } else if (act === 'copy-curl') {
    try {
      await navigator.clipboard.writeText(curl());
      el.lastChild.textContent = 'Copied';
      setTimeout(() => { el.lastChild.textContent = 'Copy as curl'; }, 1500);
    } catch {
      getSelection().selectAllChildren($('#curl'));
    }
  }
});

// Typing in the API tab updates the curl line, without redrawing the inputs
document.addEventListener('input', (e) => {
  const key = e.target.dataset?.input;
  if (!key) return;
  ui.api[key] = e.target.value;
  if (key === 'method') { schedule(true); return; }
  $('#curl').textContent = curl();
});

document.addEventListener('keydown', (e) => {
  if (ui.tab === 'api' && (e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
});

pickRoute('GET', '/api/state');
renderTop();
renderView();
// From a phone or another computer the server says no, so explain instead of reconnecting forever
fetch('/api/dev').then(async (res) => {
  if (res.status !== 403) return connect();
  $('#tabs').innerHTML = '';
  $('#top-actions').innerHTML = `<a class="pill" href="/">${icon('back')}<span class="pill-label">App</span></a>`;
  $('#view').innerHTML = `<p class="callout">${esc((await res.json()).error)}. It shows details about your lights, so it isn’t shared on the network. Open it there with <code>lights dev</code>.</p>`;
}).catch(connect);
