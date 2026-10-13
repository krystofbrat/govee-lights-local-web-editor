import {
  COLORS, TEMPS, DAY_NAMES, DAY_SETS, clamp, kelvinToHex, hsvToHex, hexToHsv, hexToRgb, describeDays, sunriseFrame,
  parseSunTime, sunTimeText, describeSunTime, sunTimes, parseLatLon,
} from '/shared/util.js';

// ---------- small helpers ----------

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const saved = {
  get(k, d) { try { const v = localStorage.getItem('lights:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lights:' + k, JSON.stringify(v)); } catch {} },
};

const ICONS = {
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  bulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  alarm: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2z"/>',
  thermo: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  sunrise: '<path d="M17 18a5 5 0 0 0-10 0M12 2v7M4.22 10.22l1.42 1.42M1 18h2M21 18h2M18.36 11.64l1.42-1.42M23 22H1M8 6l4-4 4 4"/>',
  sunset: '<path d="M17 18a5 5 0 0 0-10 0M12 9V2M4.22 10.22l1.42 1.42M1 18h2M21 18h2M18.36 11.64l1.42-1.42M23 22H1M16 5l-4 4-4-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  play: '<path d="M6 4l14 8-14 8V4z"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 18h.01"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  minus: '<path d="M5 12h14"/>',
};

// One-tap looks, shown next to the user's favorites
const LOOKS = [
  { id: 'bright', name: 'Bright', action: { kelvin: 5000, brightness: 100 } },
  { id: 'relax', name: 'Relax', action: { kelvin: 2700, brightness: 50 } },
  { id: 'focus', name: 'Focus', action: { kelvin: 6000, brightness: 100 } },
  { id: 'movie', name: 'Movie', action: { color: '#3b30ff', brightness: 12 } },
  { id: 'night', name: 'Night light', action: { kelvin: 2000, brightness: 4 } },
];
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- state ----------

let S = null;          // latest snapshot from the server
let connected = false;
const ui = {
  tab: saved.get('tab', 'lights'),
  sheet: null,         // { kind: 'control'|'alarm'|'group'|'favorite', ... }
  scenes: {},          // target -> { loading } | { data } | { error }
  sceneQuery: '',
  scenesTarget: saved.get('scenesTarget', 'all'),
  timerTarget: saved.get('timerTarget', 'all'),
  timerFade: true,
  seg: {},             // deviceId -> { sel: [i], paint: { i: hex } }
  last: {},            // target -> last look applied here (for "Save as favorite")
  hs: {},              // target -> { h, s } for the hue/saturation sliders
  music: {},           // target -> { mode, sensitivity, autoColor }
  sceneEdit: false,    // tapping a scene deletes it instead of turning it on
  sceneCat: '',        // Govee scene category shown ('' = all)
  tryFirst: saved.get('tryFirst', true), // tapping a scene or color only tries it, see trialBar
  apiKey: '',
  savingKey: false,
  location: '',        // what's typed in a location field
  saving: false,
};

// ---------- server ----------

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

async function control(target, action) {
  try {
    const { results } = await api('POST', '/api/control', { target, action });
    const bad = results.filter((r) => !r.ok);
    if (bad.length) toast(bad.map((r) => `${r.name}: ${r.error}`).join('\n'), 'error');
  } catch (e) {
    toast(e.message, 'error');
  }
}

// Sliders send while dragging, but no faster than the lights can take it
const throttles = new Map();
function sendThrottled(target, kind, action) {
  const key = target + '|' + kind;
  let t = throttles.get(key);
  if (!t) throttles.set(key, (t = { last: 0, timer: null, action: null }));
  t.action = action;
  if (t.timer) return;
  const gap = targetDevs(target).every((d) => d.via.startsWith('lan')) ? 120 : 400;
  const fire = () => { t.timer = null; t.last = Date.now(); control(target, t.action); };
  t.timer = setTimeout(fire, Math.max(0, t.last + gap - Date.now()));
}

function patchLocal(target, patch) {
  for (const d of targetDevs(target)) Object.assign(d.state, patch);
}

let appVersion = null;
let clockSkew = 0;     // server clock minus ours, for the trial countdown
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => {
    S = JSON.parse(e.data);
    clockSkew = S.now - Date.now();
    // The app was updated: load the new version instead of running the old one
    if (appVersion && S.version !== appVersion) return location.reload();
    appVersion = S.version;
    connected = true;
    render();
  });
  es.addEventListener('toast', (e) => toast(JSON.parse(e.data).msg));
  es.onerror = () => { connected = false; render(); };
}

// ---------- targets ----------

const devById = (id) => S?.devices.find((d) => d.id === id);

function targetDevs(ref) {
  if (!S) return [];
  if (ref === 'all') return S.devices.filter((d) => !d.hidden);
  if (ref.startsWith('group:')) {
    const g = S.groups.find((x) => 'group:' + x.id === ref);
    return g ? g.devices.map(devById).filter(Boolean) : [];
  }
  if (ref.startsWith('device:')) { const d = devById(ref.slice(7)); return d ? [d] : []; }
  return [];
}

function targetName(ref) {
  if (ref === 'all') return 'All lights';
  if (ref.startsWith('group:')) return S.groups.find((g) => 'group:' + g.id === ref)?.name || 'Deleted group';
  if (ref.startsWith('device:')) return devById(ref.slice(7))?.name || 'Missing light';
  return ref;
}

const allTargets = () => [
  { ref: 'all', name: 'All lights' },
  ...S.groups.map((g) => ({ ref: 'group:' + g.id, name: g.name })),
  ...S.devices.filter((d) => !d.hidden).map((d) => ({ ref: 'device:' + d.id, name: d.name })),
];
const validRef = (ref) => (ref === 'all' || targetDevs(ref).length ? ref : 'all');
const lead = (devs) => devs.find((d) => d.state.power && isOnline(d)) || devs[0];

// ---------- describing lights ----------

function colorName(hex) {
  const { r, g, b } = hexToRgb(hex);
  if (Math.max(r, g, b) - Math.min(r, g, b) < 30) return 'White';
  const { h } = hexToHsv(hex);
  let best = 'Color', dist = Infinity;
  for (const [name, c] of Object.entries(COLORS)) {
    const dh = Math.abs(hexToHsv(c).h - h);
    const d = Math.min(dh, 360 - dh);
    if (d < dist) { dist = d; best = name; }
  }
  return cap(best);
}
const kelvinName = (k) => (k < 2400 ? 'Candle' : k < 3000 ? 'Warm' : k < 3600 ? 'Soft' : k < 4800 ? 'Neutral' : k < 6000 ? 'Daylight' : 'Cool');
const isOnline = (d) => d.via !== 'unreachable' && d.state.online !== false;
const isOn = (d) => isOnline(d) && d.state.power === true;

function lightHex(d) {
  const s = d?.state || {};
  if (s.kelvin) return kelvinToHex(s.kelvin);
  if (s.color && s.color !== '#000000') return s.color;
  return '#ffc98a';
}

function describe(d) {
  const s = d.state;
  if (!isOnline(d)) return 'Offline';
  if (s.power === false) return 'Off';
  if (s.power == null) return 'Unknown';
  const parts = [];
  if (s.scene) parts.push(s.scene);
  else if (s.kelvin) parts.push(`${kelvinName(s.kelvin)} white`);
  else if (s.color) parts.push(colorName(s.color));
  if (s.brightness != null) parts.push(`${s.brightness}%`);
  return parts.join(' · ') || 'On';
}

function describeAction(a = {}) {
  const parts = [];
  if (a.favorite) parts.push('★ ' + (S.favorites.find((f) => f.id === a.favorite)?.name || 'Favorite'));
  if (a.scene) parts.push(typeof a.scene === 'string' ? a.scene : a.scene.name);
  else if (a.music) parts.push('Music: ' + (a.music.name || ''));
  else if (a.kelvin) parts.push(`${kelvinName(a.kelvin)} ${a.kelvin}K`);
  else if (a.color) parts.push(colorName(a.color));
  if (a.brightness) parts.push(`${a.brightness}%`);
  return parts.join(' · ') || 'Last setting';
}
const actionHex = (a = {}) => a.color || (a.kelvin && kelvinToHex(a.kelvin)) || '#ffb347';
const lookText = (a) => (a.power === false ? 'Off' : describeAction(a));
function favText(f) {
  if (!f.lights) return describeAction(f.action);
  const looks = Object.values(f.lights);
  return looks.length === 1 ? lookText(looks[0]) : `${looks.length} lights`;
}

/** CSS gradient of how a sunrise looks over time: dim deep red → bright white */
function sunriseGradient(endBrightness = 100, endKelvin = 4000) {
  const stops = [0, 0.12, 0.25, 0.4, 0.6, 0.8, 1].map((t) => {
    const f = sunriseFrame(t, endBrightness, endKelvin);
    const { r, g, b } = hexToRgb(f.kelvin ? kelvinToHex(f.kelvin) : f.color);
    return `rgba(${r},${g},${b},${(0.3 + 0.7 * Math.sqrt(f.brightness / 100)).toFixed(2)}) ${t * 100}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const viaLabel = (d) => (d.via !== 'unreachable' && !isOnline(d) ? 'Offline'
  : { 'lan+cloud': 'Local Wi-Fi', lan: 'Local Wi-Fi', cloud: 'Govee cloud', unreachable: 'Not reachable' }[d.via]);

// ---------- time formatting ----------

const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtHM = (hm) => { const [h, m] = hm.split(':'); return fmtTime(new Date(2000, 0, 1, +h, +m).getTime()); };
function relDay(ms, lower = false) {
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date(ms)) - day(new Date())) / 864e5);
  const s = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : DAY_NAMES[new Date(ms).getDay()];
  return lower && diff <= 1 ? s.toLowerCase() : s;
}
function fmtDuration(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
function fmtAgo(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return 'within the hour';
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / 1440);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

// ---------- DOM morphing (re-render without losing focus or slider drags) ----------

let dragEl = null;

function morphInto(el, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  morphChildren(el, tpl.content);
}

function morphChildren(from, to) {
  const a = [...from.childNodes], b = [...to.childNodes];
  b.forEach((y, i) => {
    const x = a[i];
    if (!x) return from.appendChild(y);
    const same = x.nodeType === y.nodeType && x.nodeName === y.nodeName &&
      (x.nodeType !== 1 || x.getAttribute('data-key') === y.getAttribute('data-key'));
    if (!same) return from.replaceChild(y, x);
    if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; return; }
    morphEl(x, y);
  });
  for (let i = a.length - 1; i >= b.length; i--) a[i].remove();
}

function morphEl(x, y) {
  const active = x === document.activeElement;
  if (x === dragEl || (active && x.type === 'range')) return;
  const selected = x.tagName === 'SELECT' ? y.querySelector('option[selected]')?.value : null;
  for (const { name } of [...x.attributes]) if (!y.hasAttribute(name)) x.removeAttribute(name);
  for (const { name, value } of [...y.attributes]) if (x.getAttribute(name) !== value) x.setAttribute(name, value);
  if (x.tagName === 'INPUT' && !active) {
    if (x.type === 'checkbox') x.checked = y.hasAttribute('checked');
    else x.value = y.getAttribute('value') ?? '';
  }
  morphChildren(x, y);
  if (selected != null && !active) x.value = selected;
}

// ---------- shared pieces ----------

function range({ input, target = '', value, min = 1, max = 100, step = 1, cls = '', label, style = '', field = '' }) {
  const p = ((value - min) / (max - min)) * 100;
  return `<input type="range" class="range ${cls}" min="${min}" max="${max}" step="${step}" value="${value}"
    style="--p:${p}%;${style}" data-input="${input}" data-target="${target}" ${field ? `data-field="${field}" data-num` : ''} aria-label="${esc(label)}">`;
}

const powerSwitch = (ref, on, label) =>
  `<button class="switch" role="switch" aria-checked="${on}" aria-label="${esc(label)} power" data-action="power" data-target="${ref}"></button>`;
const smallSwitch = (action, attrs, on, label) =>
  `<button class="switch small" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}" data-action="${action}" ${attrs}></button>`;
const closeBtn = () => `<button class="icon-btn" data-action="close-sheet" aria-label="Close">${icon('x')}</button>`;

function callout(html, kind = '') {
  return `<div class="callout ${kind}">${icon(kind === 'error' ? 'info' : 'info')}<div>${html}</div></div>`;
}

const keyForm = (hasKey) => `<div class="input-row">
    <input class="input" type="password" autocomplete="off" placeholder="${hasKey ? 'Replace API key' : 'Paste API key'}" data-input="api-key" value="${esc(ui.apiKey)}" aria-label="Govee API key">
    <button class="btn primary" data-action="save-key" ${ui.savingKey ? 'disabled' : ''}>${ui.savingKey ? 'Checking…' : hasKey ? 'Save' : 'Connect'}</button>
  </div>`;

const keyCallout = (why) => callout(`${why} <button class="btn small" style="margin-top:8px" data-action="tab" data-tab="settings">${icon('key')}Add API key</button>`);

const sheetFrame = (label, head, body) => `
  <div class="backdrop" data-action="close-sheet"></div>
  <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1">
    <header class="sheet-head">${head}</header>
    <div class="sheet-body">${body}</div>
  </section>`;

const SWATCHES = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan', 'sky', 'blue', 'purple', 'magenta', 'pink'];

function swatches(action, attrs, current, custom = true) {
  return `<div class="swatches">${SWATCHES.map((n) => `<button class="swatch" style="--c:${COLORS[n]}" data-action="${action}" ${attrs} data-color="${COLORS[n]}" aria-label="${n}" aria-pressed="${current === COLORS[n]}"></button>`).join('')}
    ${custom ? `<label class="swatch custom" title="Any color"><span class="sr-only">Pick any color</span><input type="color" data-input="${action}-picker" ${attrs} value="${current || '#ff8800'}"></label>` : ''}</div>`;
}

// ---------- top bar ----------

const TABS = [['lights', 'Lights', 'bulb'], ['scenes', 'Scenes', 'sparkles'], ['alarms', 'Alarms', 'alarm'], ['settings', 'Settings', 'gear']];

function renderTabs() {
  return TABS.map(([id, label, ic]) => `<button class="tab" data-action="tab" data-tab="${id}" ${ui.tab === id ? 'aria-current="page"' : ''}>
    ${icon(ic)}<span>${label}</span>${id === 'alarms' && S?.timers.length ? `<span class="badge">${S.timers.length}</span>` : ''}</button>`).join('');
}

function renderTopActions() {
  if (!S) return '';
  const next = S.upcoming[0];
  const alarm = next && S.alarms.find((a) => a.id === next.id);
  const devs = S.devices.filter((d) => !d.hidden);
  const anyOn = devs.some(isOn);
  // The Lights tab has its own big power button and next-alarm line, the Alarms tab its own next alarm
  if (ui.tab === 'lights') return '';
  return `${alarm && ui.tab !== 'alarms' ? `<button class="pill" data-action="tab" data-tab="alarms" title="Next alarm">${icon('alarm')}<span class="pill-label">${relDay(next.at)} ${fmtTime(next.at)}</span></button>` : ''}
    ${devs.length ? `<button class="btn small ${anyOn ? '' : 'primary'}" data-action="all-power" data-on="${anyOn ? 0 : 1}">${icon('power')}${anyOn ? 'All off' : 'All on'}</button>` : ''}`;
}

function renderBanner() {
  if (!S && !connected) return '';
  if (!connected) return callout('Lost connection to the lights server. Retrying…', 'error');
  const err = S.settings.cloudError;
  const visible = S.devices.filter((d) => !d.hidden);
  // The Lights tab already explains it when nothing at all can be reached
  if (err && /online\?$/.test(err) && ui.tab === 'lights' && visible.length && !visible.some(isOnline)) return '';
  if (err && /online\?$/.test(err)) return callout(`${esc(err)} Lights on your Wi-Fi still work. <button class="link" data-action="refresh">Try again</button>`, 'error');
  if (err) return callout(`${esc(err)} — <a href="#" data-action="tab" data-tab="settings" style="color:inherit">check Settings</a>`, 'error');
  return '';
}

// ---------- Lights tab ----------

function card({ ref, key, name, sub, on, offline, color, bri, group }) {
  return `<article class="card ${group ? 'group' : ''} ${on ? 'on' : ''} ${offline ? 'offline' : ''}" data-key="${key}" style="--c:${color}">
    <button class="card-main" data-action="open" data-target="${ref}" aria-label="${esc(name)} controls">
      <span class="bulb" aria-hidden="true"></span>
      <span class="card-text"><span class="card-name">${esc(name)}</span><span class="card-sub">${sub}</span></span>
    </button>
    ${powerSwitch(ref, on, name)}
    ${range({ input: 'brightness', target: ref, value: bri, cls: on ? '' : 'off', label: `${name} brightness` })}
  </article>`;
}

function deviceCard(d) {
  const fading = d.fading ? `<span class="fading-tag">${icon('sunrise').replace('class="i"', 'class="i" style="width:12px;height:12px"')}${esc(d.fading)}</span>` : '';
  return card({
    ref: 'device:' + d.id, key: d.id, name: d.name, sub: esc(describe(d)) + fading,
    on: isOn(d), offline: !isOnline(d), color: lightHex(d), bri: d.state.brightness ?? 100,
  });
}

function groupCard(ref, name, devs) {
  const onDevs = devs.filter(isOn);
  const bri = onDevs.length ? Math.round(onDevs.reduce((s, d) => s + (d.state.brightness ?? 100), 0) / onDevs.length) : 100;
  const offline = devs.length > 0 && !devs.some(isOnline);
  const sub = !devs.length ? 'No lights' : offline ? 'Offline' : onDevs.length ? `${onDevs.length} of ${devs.length} on` : `${devs.length} light${devs.length > 1 ? 's' : ''} · off`;
  return card({ ref, key: ref, name, sub, on: onDevs.length > 0, offline, color: lightHex(lead(devs)), bri, group: true });
}

/** Built-in looks plus the user's favorites and recent scenes, as one-tap buttons for `ref` */
function looks(ref, { add = false, compact = false, favs = true, scenes = true } = {}) {
  const btn = (attrs, name, action, text = describeAction(action)) => `<button class="look" style="--c:${actionHex(action)}" data-target="${ref}" ${attrs}>
      <span class="look-dot" aria-hidden="true"></span><span class="look-text"><span class="look-name">${esc(name)}</span>${compact ? '' : `<small>${esc(text)}</small>`}</span></button>`;
  // One light: save its look to use anywhere. Several: save each light's own look, e.g. a scene set up in the Govee app
  const single = ref.startsWith('device:');
  // The 4 used most recently, kept in list order so a tapped one doesn't jump
  const mine = scenes ? myScenes(ref) : [];
  const recent = new Set([...mine].sort((a, b) => b.usedAt - a.usedAt).slice(0, 4));
  return `<div class="looks ${compact ? 'compact' : ''}" role="group" aria-label="Quick looks">
    ${(favs ? S.favorites : []).map((f) => btn(`data-action="apply-fav" data-id="${f.id}" data-key="lf-${f.id}"`, f.name, f.action, favText(f))).join('')}
    ${mine.filter((m) => recent.has(m)).map((m) => `<button class="look scene" data-action="my-scene" data-id="${m.id}" data-target="${ref}" data-key="ls-${m.id}">
      <span class="look-dot scene" aria-hidden="true">${picture(scenePic(m))}</span><span class="look-text"><span class="look-name">${esc(m.name)}</span>${compact ? '' : `<small>${SCENE_KINDS[m.kind]}</small>`}</span></button>`).join('')}
    ${LOOKS.map((l) => btn(`data-action="look" data-look="${l.id}" data-key="ll-${l.id}"`, l.name, l.action)).join('')}
    ${add ? `<button class="look add" data-action="${single ? 'save-fav' : 'capture-fav'}" data-target="${ref}" data-key="l-add">${icon('star')}<span class="look-text"><span class="look-name">${single ? 'Save current' : "Save what's on now"}</span>${compact ? '' : '<small>as a favorite</small>'}</span></button>` : ''}
  </div>`;
}

function hero(devs) {
  const on = devs.filter(isOn);
  const offline = devs.filter((d) => !isOnline(d)).length;
  const bri = on.length ? Math.round(on.reduce((s, d) => s + (d.state.brightness ?? 100), 0) / on.length) : 100;
  const next = S.upcoming[0];
  const alarm = next && S.alarms.find((a) => a.id === next.id);
  // The card glows with the colors the lights are showing right now
  const spots = ['0% 0%', '100% 0%', '50% 120%'];
  const glow = on.slice(0, 3).map((d, i) => `radial-gradient(60% 120% at ${spots[i]}, color-mix(in srgb, ${lightHex(d)} 26%, transparent), transparent 75%)`).join(', ');
  const unreachable = offline === devs.length;
  const status = unreachable ? `Can't reach your light${devs.length > 1 ? 's' : ''}`
    : !on.length ? 'Everything is off' : on.length === devs.length ? (devs.length === 1 ? 'Your light is on' : `All ${devs.length} lights on`) : `${on.length} of ${devs.length} lights on`;
  const meta = [
    alarm && `<button class="hero-meta" data-action="tab" data-tab="alarms">${icon(TYPE_INFO[alarm.type].icon)}${esc(alarm.name || TYPE_INFO[alarm.type].short)} · ${relDay(next.at)} ${fmtTime(next.at)}</button>`,
    S.timers.length && `<button class="hero-meta" data-action="tab" data-tab="alarms">${icon('moon')}Sleep timer · off at ${fmtTime(S.timers[0].endsAt)}</button>`,
    offline && !unreachable && `<span class="hero-meta warn">${icon('wifi')}${offline} offline</span>`,
  ].filter(Boolean).join('');
  const help = unreachable ? `<p class="hero-help">${icon('wifi')}<span>They're saved — no need to set anything up again. Once this Mac is on the same Wi-Fi as the lights${S.settings.hasKey ? ' and online' : ''}, they reconnect by themselves. <button class="link" data-action="refresh">Try now</button></span></p>` : '';
  return `<section class="hero ${on.length ? 'lit' : ''}" style="${glow ? `--glow:${glow}` : ''}">
    <div class="hero-top">
      <div class="grow"><p class="hero-hi">${greeting()}</p><h1>${status}</h1>${meta ? `<div class="hero-metas">${meta}</div>` : ''}${help}</div>
      ${unreachable ? '' : `<button class="power-big" data-action="all-power" data-on="${on.length ? 0 : 1}" aria-pressed="${on.length > 0}" aria-label="${on.length ? 'Turn all lights off' : 'Turn all lights on'}"><span class="power-ring">${icon('power')}</span><span>${on.length ? 'All off' : 'All on'}</span></button>`}
    </div>
    ${unreachable ? '' : `<div class="slider-row" style="--c:${lightHex(lead(devs))}">${icon('sun')}${range({ input: 'brightness', target: 'all', value: bri, cls: on.length ? '' : 'off', label: 'Brightness of all lights' })}<output>${bri}%</output></div>
    ${looks('all', { add: on.length > 0 })}`}
  </section>`;
}

function viewSetup() {
  const st = S.settings;
  return `<section class="setup">
    <div class="setup-head"><div class="glow" aria-hidden="true"></div>
      <h1>Let's connect your lights</h1>
      <p>Two quick steps in the Govee Home app on your phone. You only do this once — after that, everything happens here.</p></div>
    <div class="setup-steps">
      <article class="step ${st.hasKey ? 'done' : ''}">
        <header><span class="step-n">${st.hasKey ? icon('check') : '1'}</span><h2>Get your Govee API key <span class="tag">free</span></h2></header>
        ${st.hasKey
          ? `<p class="muted">Key connected (${esc(st.keyHint)}), but your Govee account has no lights yet. Add them in the Govee Home app first, then scan again.</p>`
          : `<ol class="steps"><li>Govee Home → <b>Profile</b> → <b>⚙ Settings</b></li><li>Tap <b>Apply for API Key</b> (reason: "home automation")</li><li>It arrives by email in a few minutes — paste it here:</li></ol>
             ${keyForm(false)}`}
        <p class="hint">Unlocks Govee scenes, music mode, segments, and lights without LAN Control.</p>
      </article>
      <article class="step">
        <header><span class="step-n">2</span><h2>Turn on LAN Control <span class="tag">faster</span></h2></header>
        <ol class="steps"><li>Govee Home → tap a light → <b>⚙</b> (top right)</li><li>Switch on <b>LAN Control</b> — repeat for each light</li></ol>
        <p class="hint">These lights then react instantly and keep working without internet. Not every model has it — that's fine, the API key covers the rest.</p>
      </article>
    </div>
    <div class="scan-line">${st.lanError
      ? `${icon('info')}<span>Can't search your Wi-Fi: ${esc(st.lanError)}</span>`
      : `<span class="pulse" aria-hidden="true"></span><span>Looking for lights on your Wi-Fi…</span>`}
      <button class="btn small" data-action="refresh">${icon('refresh')}Scan now</button></div>
  </section>`;
}

function viewLights() {
  const devs = S.devices.filter((d) => !d.hidden);
  if (!devs.length) return viewSetup();
  const groups = S.groups.map((g) => groupCard('group:' + g.id, g.name, targetDevs('group:' + g.id)));
  return `
    ${hero(devs)}
    ${groups.length || devs.length > 1 ? `<section class="section">
      <div class="section-head"><h2>Rooms</h2><button class="btn small ghost" data-action="new-group">${icon('plus')}New group</button></div>
      ${groups.length ? `<div class="grid">${groups.join('')}</div>`
        : `<button class="hint-card" data-action="new-group">${icon('grid')}<span><b>Group lights into rooms</b><span class="muted">Turn a whole room on, off or to a color at once — here, in alarms and from the terminal.</span></span></button>`}
    </section>` : ''}
    <section class="section">
      <div class="section-head"><h2>Lights</h2><button class="btn small ghost" data-action="refresh">${icon('refresh')}Refresh</button></div>
      <div class="grid">${devs.map(deviceCard).join('')}</div>
    </section>`;
}

// ---------- control sheet ----------

function mergeCaps(devs) {
  const key = S.settings.hasKey;
  const kel = devs.map((d) => d.caps.kelvin).filter(Boolean);
  const music = devs.map((d) => d.caps.music).filter((m) => m?.modes.length);
  const one = devs.length === 1 ? devs[0] : null;
  const modes = [];
  for (const m of music) for (const o of m.modes) if (!modes.some((x) => x.name === o.name)) modes.push(o);
  return {
    color: devs.some((d) => d.caps.color),
    kelvin: kel.length ? { min: Math.min(...kel.map((k) => k.min)), max: Math.max(...kel.map((k) => k.max)) } : null,
    scenes: true,
    music: key && music.length ? { modes, sensitivity: music.some((m) => m.sensitivity), autoColor: music.some((m) => m.autoColor) } : null,
    segments: key && one?.caps.segments?.count ? one.caps.segments : null,
    more: key && one && (one.caps.toggles.length || one.caps.modes.length) ? one.caps : null,
  };
}

const PANES = [
  ['color', 'Color', 'palette'], ['white', 'White', 'thermo'], ['scenes', 'Scenes', 'sparkles'],
  ['music', 'Music', 'music'], ['segments', 'Segments', 'grid'], ['more', 'More', 'sliders'],
];

function sheetControl() {
  const ref = ui.sheet.target;
  const devs = targetDevs(ref);
  if (!devs.length) return '';
  const caps = mergeCaps(devs);
  const main = lead(devs);
  const on = devs.some(isOn);
  const color = lightHex(main);
  const bri = main.state.brightness ?? 100;
  const panes = PANES.filter(([id]) => caps[id === 'white' ? 'kelvin' : id]);
  const pane = panes.some(([id]) => id === ui.sheet.pane) ? ui.sheet.pane : panes[0][0];
  const sub = ref.startsWith('device:')
    ? `${main.sku} · ${viaLabel(main)}${main.fading ? ` · ${main.fading}` : ''}`
    : `${devs.filter(isOn).length} of ${devs.length} on`;
  const body = {
    color: () => paneColor(ref, main),
    white: () => paneWhite(ref, main, caps.kelvin),
    scenes: () => sceneBrowser(ref),
    music: () => paneMusic(ref, main, caps.music),
    segments: () => paneSegments(ref, devs[0], caps.segments),
    more: () => paneMore(ref, caps.more),
  }[pane]();
  return sheetFrame(targetName(ref), `
      <span class="bulb big ${on ? 'lit' : ''}" style="--c:${color}" aria-hidden="true"></span>
      <div class="grow"><h2>${esc(targetName(ref))}</h2><p>${esc(sub)}</p></div>
      ${powerSwitch(ref, on, targetName(ref))}${closeBtn()}`, `
      <div class="slider-row" style="--c:${color}">${icon('sun')}${range({ input: 'brightness', target: ref, value: bri, cls: on ? '' : 'off', label: 'Brightness' })}<output>${bri}%</output></div>
      ${looks(ref, { compact: true, add: true, scenes: pane !== 'scenes' })}
      <div class="segmented modes" role="group" aria-label="Mode">${panes.map(([id, label, ic]) => `<button data-action="pane" data-pane="${id}" aria-pressed="${id === pane}">${icon(ic)}${label}</button>`).join('')}</div>
      <div class="field">${body}</div>
      <div class="field">
        <span class="field-label">Sleep timer — fade out, then off</span>
        <div class="chips">${[15, 30, 60].map((m) => `<button class="chip" data-action="sleep" data-target="${ref}" data-min="${m}">${icon('moon')}${m} min</button>`).join('')}</div>
      </div>`);
}

function paneColor(ref, main) {
  const cur = main.state.color && !main.state.kelvin && !main.state.scene ? main.state.color : null;
  const hs = ui.hs[ref] || (cur ? hexToHsv(cur) : { h: 30, s: 1 });
  return `<div class="color-pane">
    <div class="wheel" data-wheel data-target="${ref}" tabindex="0" role="slider" aria-label="Color wheel (arrow keys change hue and saturation)"
      aria-valuemin="0" aria-valuemax="359" aria-valuenow="${Math.round(hs.h)}" aria-valuetext="${colorName(hsvToHex(hs.h, hs.s))}">
      <span class="wheel-thumb" style="${wheelThumb(hs)}"></span></div>
    ${swatches('color', `data-target="${ref}"`, cur)}
  </div>
  ${tryRow()}`;
}

/** Hue goes around the wheel (red at the top), saturation from white in the middle to full at the rim */
function wheelThumb({ h, s }) {
  const a = (h * Math.PI) / 180;
  return `left:${(50 + 50 * s * Math.sin(a)).toFixed(2)}%;top:${(50 - 50 * s * Math.cos(a)).toFixed(2)}%;--c:${hsvToHex(h, s)}`;
}

function setWheel(el, hs) {
  ui.hs[el.dataset.target] = hs;
  el.querySelector('.wheel-thumb').setAttribute('style', wheelThumb(hs));
  el.setAttribute('aria-valuenow', Math.round(hs.h));
  pickColor(el.dataset.target, hsvToHex(hs.h, hs.s), false);
}

function wheelAt(el, e) {
  const r = el.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  setWheel(el, { h: ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360, s: clamp(Math.hypot(dx, dy) / (r.width / 2), 0, 1) });
}

function paneWhite(ref, main, kr) {
  const k = clamp(main.state.kelvin || 3000, kr.min, kr.max);
  const presets = Object.entries(TEMPS).filter(([, v]) => v >= kr.min && v <= kr.max);
  return `<div class="slider-row">${range({ input: 'kelvin', target: ref, value: k, min: kr.min, max: kr.max, step: 50, cls: 'kelvin', label: 'White temperature' })}<output>${k}K</output></div>
    <div class="chips">${presets.map(([name, v]) => `<button class="chip" data-action="kelvin" data-target="${ref}" data-k="${v}" aria-pressed="${main.state.kelvin === v}"><span class="dot" style="--c:${kelvinToHex(v)}"></span>${cap(name)}</button>`).join('')}</div>
    ${tryRow()}`;
}

const SCENE_KINDS = { lightScene: 'Govee scene', diyScene: 'DIY scene', snapshot: 'Snapshot' };
const SCENE_GROUPS = [['lightScene', 'Govee scenes'], ['diyScene', 'My DIY scenes'], ['snapshot', 'Snapshots']];
const sceneKey = (kind, name) => `${kind}|${name.toLowerCase()}`;

/** Scenes turned on from this app before, that at least one of `ref`'s lights has */
function myScenes(ref) {
  if (!S.settings.hasKey) return [];
  const skus = new Set(targetDevs(ref).map((d) => d.sku));
  return S.myScenes.filter((m) => m.skus.some((k) => skus.has(k)));
}

/** Govee's own picture for a scene (light and dark versions), if it has one */
const picture = (o) => (o?.pic
  ? `<picture><source media="(prefers-color-scheme: dark)" srcset="${esc(o.picDark || o.pic)}"><img src="${esc(o.pic)}" alt="" loading="lazy" referrerpolicy="no-referrer"></picture>` : '');

/** A saved scene's picture: saved with it, or from any scene list loaded since */
function scenePic(m) {
  if (m.pic) return m;
  for (const st of Object.values(ui.scenes)) {
    const o = st.data?.lightScene.find((x) => x.name === m.name);
    if (o?.pic) return o;
  }
  return null;
}

const tryRow = () => `<div class="slider-row try-row"><span style="flex:1"><b>Try first</b> <span class="hint">— the lights go back after 10 seconds unless you tap Keep</span></span>${smallSwitch('try-first', '', ui.tryFirst, 'Try first')}</div>`;

function sceneBrowser(ref) {
  if (!S.settings.hasKey) return keyCallout("Govee's scenes (Sunrise, Aurora, Movie…) live in Govee's cloud, so they need your free API key.");
  const st = ui.scenes[ref];
  if (!st) queueMicrotask(() => loadScenes(ref));
  const edit = ui.sceneEdit;
  const q = ui.sceneQuery.trim().toLowerCase();
  const cats = st?.data?.categories || [];
  const cat = cats.includes(ui.sceneCat) ? ui.sceneCat : '';
  const match = (o) => !q || o.name.toLowerCase().includes(q);
  const hidden = new Set(S.hiddenScenes);
  const playing = lead(targetDevs(ref))?.state.scene;
  // In edit mode a tap deletes (or brings back) a scene instead of turning it on
  const btn = (attrs, o, mode = 'play') => {
    const inner = `<span class="scene-pic" aria-hidden="true">${picture(o)}</span><span class="scene-name">${esc(o.name)}</span>`;
    return mode === 'play'
      ? `<button class="scene-btn" data-target="${ref}" ${attrs} aria-pressed="${playing === o.name}"${o.hint ? ` title="${esc(o.hint)}"` : ''}>${inner}</button>`
      : `<button class="scene-btn ${mode}" ${attrs} aria-label="${mode === 'del' ? 'Delete' : 'Bring back'} ${esc(o.name)}"><span class="scene-badge">${icon(mode === 'del' ? 'minus' : 'plus')}</span>${inner}</button>`;
  };
  const group = (title, items, empty = '') => items.length || empty
    ? `<div class="scene-group"><h3>${title}${items.length ? ` · ${items.length}` : ''}</h3>${items.length ? `<div class="scene-list">${items.join('')}</div>` : empty}</div>` : '';

  const mine = group('My scenes', myScenes(ref).filter(match).map((m) => {
    const o = { ...scenePic(m), name: m.name };
    return edit ? btn(`data-action="delete-my-scene" data-id="${m.id}"`, o, 'del') : btn(`data-action="my-scene" data-id="${m.id}"`, o);
  }), q ? '' : '<p class="hint">Scenes you turn on are saved here, so they\'re one tap away next time.</p>');

  let govee;
  if (!st || st.loading) govee = '<p class="muted">Loading scenes…</p>';
  else if (st.error) govee = callout(`Couldn't load scenes: ${esc(st.error)} <button class="btn small" data-action="reload-scenes" data-target="${ref}">Retry</button>`, 'error');
  else if (!SCENE_GROUPS.some(([kind]) => st.data[kind].length)) govee = '<p class="muted">No Govee scenes for these lights.</p>';
  else {
    const attrs = (action, kind, o) => `data-action="${action}" data-kind="${kind}" data-name="${esc(o.name)}"`;
    const gone = [];
    // A category only narrows Govee's own scenes; DIY scenes and snapshots have none
    const inCat = (kind, o) => !cat || (kind === 'lightScene' && o.category === cat);
    govee = SCENE_GROUPS.map(([kind, title]) => group(title, st.data[kind].filter((o) => match(o) && inCat(kind, o)).flatMap((o) => {
      if (hidden.has(sceneKey(kind, o.name))) { gone.push(btn(attrs('unhide-scene', kind, o), o, 'restore')); return []; }
      return [edit ? btn(attrs('hide-scene', kind, o), o, 'del') : btn(attrs('scene', kind, o), o)];
    }))).join('');
    if (edit) govee += group('Deleted', gone);
    else if (gone.length) govee += `<p class="hint">${gone.length} deleted scene${gone.length > 1 ? 's' : ''} hidden. <button class="link" data-action="scene-edit">Bring back</button></p>`;
    if (!govee) govee = '<p class="muted">No scenes match.</p>';
  }

  return `<div class="input-row"><input class="input" type="search" placeholder="Search scenes" data-input="scene-query" value="${esc(ui.sceneQuery)}" aria-label="Search scenes">
    <button class="icon-btn" data-action="reload-scenes" data-target="${ref}" aria-label="Reload scenes" title="Reload from Govee">${icon('refresh')}</button>
    <button class="btn ${edit ? 'primary' : ''}" data-action="scene-edit" aria-pressed="${edit}">${edit ? 'Done' : 'Edit'}</button></div>
    ${edit ? '<p class="hint">Tap a scene to delete it. Deleting only removes it from this app: Govee keeps its scenes, so you can bring them back here.</p>' : tryRow()}
    ${cats.length ? `<div class="chips scroll" role="group" aria-label="Kind of scene">${['', ...cats].map((c) => `<button class="chip" data-action="scene-cat" data-cat="${esc(c)}" aria-pressed="${c === cat}">${esc(c || 'All')}</button>`).join('')}</div>` : ''}
    ${mine}${govee}`;
}

async function loadScenes(ref, force = false) {
  if (ui.scenes[ref]?.loading) return;
  ui.scenes[ref] = { loading: true };
  render();
  try {
    ui.scenes[ref] = { data: await api('GET', `/api/scenes?target=${encodeURIComponent(ref)}${force ? '&force=1' : ''}`) };
  } catch (e) {
    ui.scenes[ref] = { error: e.message };
  }
  render();
}

function paneMusic(ref, main, mc) {
  const m = (ui.music[ref] ||= { mode: null, sensitivity: 80, autoColor: true });
  return `<div class="chips">${mc.modes.map((o) => `<button class="chip" data-action="music" data-target="${ref}" data-name="${esc(o.name)}" aria-pressed="${m.mode === o.name}">${esc(o.name)}</button>`).join('')}</div>
    ${mc.sensitivity ? `<div class="field"><span class="field-label">Sensitivity</span><div class="slider-row">${range({ input: 'music-sens', target: ref, value: m.sensitivity, min: 0, max: 100, cls: 'music', label: 'Sensitivity' })}<output>${m.sensitivity}%</output></div></div>` : ''}
    ${mc.autoColor ? `<div class="slider-row"><span style="flex:1">Automatic colors <span class="hint">(off = use the current color)</span></span>${smallSwitch('music-auto', `data-target="${ref}"`, m.autoColor, 'Automatic colors')}</div>` : ''}
    <p class="hint">Reacts to sound through the light's built-in microphone.</p>`;
}

function paneSegments(ref, d, sc) {
  const st = (ui.seg[d.id] ||= { sel: [], paint: {} });
  const attrs = `data-dev="${d.id}" data-target="${ref}"`;
  return `<p class="hint">${st.sel.length ? `${st.sel.length} selected — tap a color to paint them.` : 'Tap a color to paint the whole light, or pick segments first.'}</p>
    <div class="segments">${[...Array(sc.count).keys()].map((i) => `<button class="seg ${st.paint[i] ? 'painted' : ''}" style="${st.paint[i] ? `--c:${st.paint[i]}` : ''}" data-action="seg-toggle" ${attrs} data-i="${i}" aria-pressed="${st.sel.includes(i)}" aria-label="Segment ${i + 1}">${i + 1}</button>`).join('')}</div>
    <div class="chips"><button class="chip" data-action="seg-all" ${attrs}>Select all</button><button class="chip" data-action="seg-none" ${attrs}>Select none</button><button class="chip" data-action="seg-rainbow" ${attrs}>${icon('sparkles')}Rainbow</button></div>
    ${swatches('seg-color', attrs, null, false)}`;
}

function paneMore(ref, caps) {
  const toggles = caps.toggles.map((t) => `<div class="slider-row"><span style="flex:1">${esc(t.name)}</span>
      <span class="chips"><button class="chip" data-action="cap-toggle" data-target="${ref}" data-instance="${esc(t.instance)}" data-on="1">On</button><button class="chip" data-action="cap-toggle" data-target="${ref}" data-instance="${esc(t.instance)}" data-on="0">Off</button></span></div>`).join('');
  const modes = caps.modes.map((m) => `<div class="field"><span class="field-label">${esc(m.name)}</span><div class="chips">${m.options.map((o) =>
    `<button class="chip" data-action="cap-mode" data-target="${ref}" data-instance="${esc(m.instance)}" data-value="${esc(JSON.stringify(o.value))}">${esc(o.name)}</button>`).join('')}</div></div>`).join('');
  return toggles + modes;
}

// ---------- Scenes tab ----------

function favCard(f, ref) {
  return `<div class="fav-wrap" data-key="f-${f.id}">
    <button class="fav" style="--c:${actionHex(f.action)}" data-action="apply-fav" data-id="${f.id}" data-target="${ref}">
      <span class="bulb lit" style="--c:${actionHex(f.action)}" aria-hidden="true"></span>
      <span>${esc(f.name)}<small>${esc(favText(f))}</small></span>
    </button>
    <button class="icon-btn" data-action="edit-fav" data-id="${f.id}" aria-label="Edit ${esc(f.name)}">${icon('edit')}</button>
  </div>`;
}

function viewScenes() {
  const ref = validRef(ui.scenesTarget);
  if (!S.devices.length) return viewLights();
  return `
    <section class="section">
      <div class="section-head"><h2>Apply to</h2></div>
      <div class="chips scroll" role="group" aria-label="Apply to">${allTargets().map((t) => `<button class="chip" data-action="scenes-target" data-target="${t.ref}" aria-pressed="${t.ref === ref}">${esc(t.name)}</button>`).join('')}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Quick looks</h2></div>
      ${looks(ref, { favs: false, scenes: false })}
    </section>
    <section class="section">
      <div class="section-head"><h2>Favorites</h2><button class="btn small ghost" data-action="new-fav">${icon('plus')}New favorite</button></div>
      ${S.favorites.length ? `<div class="fav-grid">${S.favorites.map((f) => favCard(f, ref)).join('')}</div>`
        : `<p class="muted small-text">Save a look from any light with ★ Save current, or create one here. To keep a scene you made in the Govee app, turn it on there, then tap ★ Save what's on now on the Lights tab. Favorites also work in alarms and from the terminal.</p>`}
    </section>
    <section class="section">
      <div class="section-head"><h2>Scenes</h2></div>
      <div class="field">${sceneBrowser(ref)}</div>
    </section>`;
}

// ---------- Alarms tab ----------

// Type "sunrise" is the wake-up fade. It's not the same as an alarm *at* sunrise (a sun time, see parseSunTime)
const TYPE_INFO = {
  sunrise: { label: 'Sunrise fade (wake-up)', short: 'Sunrise fade', icon: 'sunrise' },
  on: { label: 'Turn on', short: 'Turn on', icon: 'bulb' },
  off: { label: 'Turn off', short: 'Turn off', icon: 'moon' },
};

function alarmLine(a) {
  if (a.type === 'sunrise') return `Sunrise fade · ${a.duration} min`;
  if (a.type === 'on') return `Turn on · ${describeAction(a.action)}`;
  return a.fade ? `Fade out · ${a.fade} min` : 'Turn off';
}

function alarmStrip(a, dir = '180deg') {
  if (a.type === 'sunrise') return sunriseGradient(a.brightness, a.kelvin).replace('90deg', dir);
  if (a.type === 'on') return actionHex(a.action);
  return `linear-gradient(${dir}, #8b7cff, #2a2350)`;
}

function dayDots(days) {
  if (!days.length) return '<span class="day-dots once">Once</span>';
  return `<span class="day-dots" role="img" title="${esc(describeDays(days))}" aria-label="${esc(describeDays(days))}">${[1, 2, 3, 4, 5, 6, 0]
    .map((n) => `<span class="${days.includes(n) ? 'on' : ''}" aria-hidden="true">${DAY_NAMES[n][0]}</span>`).join('')}</span>`;
}

const smallAmPm = (text) => esc(text).replace(/\s*([AaPp]\.?\s?[Mm]\.?)$/, '<small>$1</small>');

function alarmCard(a) {
  const up = S.upcoming.find((u) => u.id === a.id);
  const sun = parseSunTime(a.time);
  const now = Date.now();
  let next = '';
  if (a.enabled && up) {
    next = a.type === 'sunrise'
      ? `Starts ${relDay(up.start, true)} ${fmtTime(up.start)} · in ${fmtDuration(up.start - now)}`
      : `${relDay(up.at)} · in ${fmtDuration(up.at - now)}`;
  } else if (a.enabled && sun) {
    next = S.settings.location ? `No ${sun.event} here in the next week` : 'Needs your location (Settings)';
  }
  const sub = [a.target.map(targetName).join(', '), a.name ? alarmLine(a) : ''].filter(Boolean).join(' · ');
  // Sun times show when they'll actually happen next, and what they follow
  const time = sun ? (up ? fmtTime(up.at) : cap(sun.event)) : fmtHM(a.time);
  return `<article class="alarm ${a.enabled ? '' : 'disabled'}" data-key="a-${a.id}" style="--strip:${alarmStrip(a)}">
    <button class="alarm-main" data-action="edit-alarm" data-id="${a.id}">
      <span class="alarm-time">${smallAmPm(time)}</span>
      <span class="alarm-meta">
        ${sun ? `<span class="sun-when">${icon(sun.event)}${esc(cap(describeSunTime(a.time)))}</span>` : ''}
        <span class="type">${icon(TYPE_INFO[a.type].icon)}${esc(a.name || alarmLine(a))}</span>
        <span class="sub">${dayDots(a.days)}<span class="sub-text">${esc(sub)}</span></span>
        ${next ? `<span class="next">${esc(next)}</span>` : ''}
      </span>
    </button>
    <button class="switch" role="switch" aria-checked="${a.enabled}" aria-label="Alarm on" data-action="toggle-alarm" data-id="${a.id}"></button>
  </article>`;
}

function timerRow(t) {
  const now = Date.now();
  const p = clamp((now - t.startAt) / (t.endsAt - t.startAt), 0, 1);
  return `<div class="timer-row" data-key="t-${t.id}">${icon('moon')}
    <div class="grow"><b>${esc(t.label)}</b><span class="muted small-text">${t.fade ? 'Fading out' : 'Turning off'} · off at ${fmtTime(t.endsAt)} (${fmtDuration(t.endsAt - now)} left)</span>
      <div class="progress"><span style="width:${(p * 100).toFixed(1)}%"></span></div></div>
    <button class="btn small" data-action="cancel-timer" data-id="${t.id}">Cancel</button></div>`;
}

function viewAlarms() {
  const ref = validRef(ui.timerTarget);
  const order = (a) => S.upcoming.find((u) => u.id === a.id)?.start ?? Infinity;
  const alarms = [...S.alarms].sort((a, b) => (b.enabled - a.enabled) || order(a) - order(b) || a.time.localeCompare(b.time));
  const next = S.upcoming[0];
  const na = next && S.alarms.find((a) => a.id === next.id);
  const now = Date.now();
  const nextCard = na ? `<section class="next-alarm" style="--strip:${alarmStrip(na, '90deg')}">
      <div class="grow"><p class="hero-hi">Next alarm</p>
        <h1>${relDay(next.at)} ${fmtTime(next.at)}</h1>
        <p class="muted">${esc(na.name || TYPE_INFO[na.type].label)} · ${na.type === 'sunrise' && next.start > now
          ? `lights start at ${fmtTime(next.start)}, in ${fmtDuration(next.start - now)}`
          : `in ${fmtDuration(next.at - now)}`}</p></div>
      <span class="next-icon" aria-hidden="true">${icon(TYPE_INFO[na.type].icon)}</span>
    </section>` : '';
  return `
    ${nextCard}
    <section class="section">
      <div class="section-head"><h2>Alarms</h2><button class="btn small primary" data-action="new-alarm">${icon('plus')}New alarm</button></div>
      ${alarms.length ? `<div class="alarm-list">${alarms.map(alarmCard).join('')}</div>` : `<div class="empty"><div class="glow"></div><h2>Wake up to light</h2>
        <p>A sunrise fade slowly brings your lights from deep red to bright white, so you wake up gently, before your phone alarm goes off. Alarms can also follow the real sun, like “30 minutes before sunset”.</p>
        <button class="btn primary" data-action="new-alarm">${icon('sunrise')}Create a sunrise fade</button></div>`}
    </section>
    <section class="section">
      <div class="section-head"><h2>Sleep timer</h2></div>
      <div class="panel">
        ${S.timers.map(timerRow).join('')}
        <div class="input-row">
          <select class="input" data-change="timer-target" aria-label="Which lights">${allTargets().map((t) => `<option value="${t.ref}" ${t.ref === ref ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        </div>
        <div class="chips">${[15, 30, 45, 60, 90].map((m) => `<button class="chip" data-action="timer" data-min="${m}">${icon('moon')}${m} min</button>`).join('')}</div>
        <div class="slider-row"><span style="flex:1">Fade out gradually <span class="hint">(otherwise just switch off at the end)</span></span>${smallSwitch('timer-fade', '', ui.timerFade, 'Fade out gradually')}</div>
      </div>
    </section>`;
}

// ---------- alarm editor ----------

function newAlarmDraft() {
  return {
    type: 'sunrise', time: '07:00', when: 'clock', offset: 0, days: [...DAY_SETS.weekdays], target: ['all'], name: '', enabled: true,
    duration: 30, brightness: 100, kelvin: 4000, fade: 15,
    onMode: 'white', onBrightness: 80, onColor: COLORS.orange, onKelvin: 3000, onFavorite: S.favorites[0]?.id || '', onScene: '',
  };
}

function alarmToDraft(a) {
  const d = { ...newAlarmDraft(), ...structuredClone(a) };
  const sun = parseSunTime(a.time);
  if (sun) Object.assign(d, { when: sun.event, offset: sun.offset, time: '07:00' });
  const x = a.action || {};
  if (a.type === 'on') {
    d.onBrightness = x.brightness ?? 100;
    d.onMode = x.favorite ? 'favorite' : x.scene ? 'scene' : x.color ? 'color' : x.kelvin ? 'white' : 'keep';
    if (x.favorite) d.onFavorite = x.favorite;
    if (x.scene) d.onScene = typeof x.scene === 'string' ? x.scene : x.scene.name;
    if (x.color) d.onColor = x.color;
    if (x.kelvin) d.onKelvin = x.kelvin;
  }
  return d;
}

function draftToAlarm(d) {
  const time = d.when === 'clock' ? d.time : sunTimeText({ event: d.when, offset: d.offset });
  const a = { id: d.id, name: d.name.trim(), enabled: d.enabled, type: d.type, time, days: d.days, target: d.target.length ? d.target : ['all'] };
  if (d.type === 'sunrise') Object.assign(a, { duration: d.duration, brightness: d.brightness, kelvin: d.kelvin });
  if (d.type === 'off') a.fade = d.fade;
  if (d.type === 'on') {
    a.action = { brightness: d.onBrightness };
    if (d.onMode === 'color') a.action.color = d.onColor;
    if (d.onMode === 'white') a.action.kelvin = d.onKelvin;
    if (d.onMode === 'favorite' && d.onFavorite) a.action.favorite = d.onFavorite;
    if (d.onMode === 'scene' && d.onScene.trim()) a.action.scene = d.onScene.trim();
  }
  return a;
}

/** The next sunrise/sunset (event) plus offset minutes at the saved location, as ms; null without one */
function nextSun(event, offset, from = Date.now()) {
  const loc = S.settings.location;
  if (!loc) return null;
  for (let add = 0; add < 8; add++) {
    const day = new Date(from);
    day.setDate(day.getDate() + add);
    const t = sunTimes(day, loc.lat, loc.lon)[event];
    if (t != null && Math.round(t / 60000) * 60000 + offset * 60000 > from) return Math.round(t / 60000) * 60000 + offset * 60000;
  }
  return null;
}

/** When the draft's lights reach their look, as ms (any day for a clock time; the next one for a sun time) */
function draftAt(d) {
  if (d.when !== 'clock') return nextSun(d.when, d.offset);
  if (!d.time) return null;
  const [h, m] = d.time.split(':');
  return new Date(2000, 0, 1, +h, +m).getTime();
}

function alarmSummary(d) {
  const at = draftAt(d);
  if (at == null) return '';
  const t = (ms) => `<b>${fmtTime(ms)}</b>`;
  const day = d.when === 'clock' ? '' : ` (${relDay(at, true)}: ${describeSunTime(sunTimeText({ event: d.when, offset: d.offset }))})`;
  if (d.type === 'sunrise') return `Lights start glowing deep red at ${t(at - d.duration * 60000)} and reach full ${kelvinName(d.kelvin).toLowerCase()} white at ${t(at)}${day}.`;
  if (d.type === 'off') return d.fade ? `Starts dimming at ${t(at)}, lights are off at ${t(at + d.fade * 60000)}${day}.` : `Lights switch off at ${t(at)}${day}.`;
  return `Lights turn on at ${t(at)}${day}.`;
}

const OFFSETS = [-60, -30, -15, 0, 15, 30, 60];
const offsetLabel = (m) => (!m ? 'Exactly' : `${Math.abs(m) % 60 ? `${Math.abs(m)} min` : `${Math.abs(m) / 60} h`} ${m < 0 ? 'before' : 'after'}`);

/** Today's sunrise and sunset at a location, in words */
function sunToday(loc) {
  const s = sunTimes(new Date(), loc.lat, loc.lon);
  if (s.polar) return s.polar === 'day' ? 'The sun stays up all day today' : 'The sun stays down all day today';
  return `Today: sunrise ${fmtTime(s.sunrise)}, sunset ${fmtTime(s.sunset)}`;
}

const canLocate = () => window.isSecureContext && 'geolocation' in navigator;
const locationForm = () => `<div class="input-row">
    <input class="input" placeholder="e.g. 50.08, 14.43" data-input="location" value="${esc(ui.location)}" aria-label="Latitude and longitude" autocomplete="off">
    <button class="btn primary" data-action="save-location">Save</button></div>
  <p class="hint">In a map app, long-press your home to copy its coordinates. South and west are negative.${canLocate() ? ` <button class="link" data-action="locate">Use this device’s location</button>` : ''}</p>`;

/** The "When" part of the alarm editor: a clock time, or when the sun rises or sets */
function whenField(d) {
  const kinds = [['clock', 'Clock time', 'clock'], ['sunrise', 'Sun rises', 'sunrise'], ['sunset', 'Sun sets', 'sunset']];
  const loc = S.settings.location;
  let body;
  if (d.when === 'clock') {
    body = `<input type="time" class="input time-input" value="${d.time}" data-input="draft" data-field="time" aria-label="${d.type === 'sunrise' ? 'Wake-up time' : 'Time'}" required>`;
  } else {
    const offsets = OFFSETS.includes(d.offset) ? OFFSETS : [...OFFSETS, d.offset].sort((x, y) => x - y);
    const s = loc && sunTimes(new Date(), loc.lat, loc.lon);
    body = `<div class="chips">${offsets.map((m) => chip('draft', `data-field="offset" data-value="${m}" data-num`, d.offset === m, offsetLabel(m))).join('')}</div>
      ${!loc ? callout(`<b>Sun times need your location</b><p class="small-text muted">It’s only used to work out when the sun rises and sets, rounded to about 1 km.</p>${locationForm()}`)
        : `<p class="hint">${s[d.when] ? `Today the sun ${d.when === 'sunrise' ? 'rises' : 'sets'} at ${fmtTime(s[d.when])} at your location.`
          : `The sun doesn’t ${d.when === 'sunrise' ? 'rise' : 'set'} at your location today, so the alarm skips days like this.`}</p>`}`;
  }
  return `<div class="field">
    <div class="segmented" role="group" aria-label="When">${kinds.map(([k, l, ic]) => `<button data-action="draft" data-field="when" data-value="${k}" aria-pressed="${d.when === k}">${icon(ic)}${l}</button>`).join('')}</div>
    ${body}
  </div>`;
}

const chip = (action, attrs, pressed, label) => `<button class="chip" data-action="${action}" ${attrs} aria-pressed="${!!pressed}">${label}</button>`;
const sceneChips = (field, value) => myScenes('all').length
  ? `<div class="chips">${myScenes('all').map((m) => chip('draft', `data-field="${field}" data-value="${esc(m.name)}"`, value === m.name, `<span class="dot scene"></span>${esc(m.name)}`)).join('')}</div>` : '';

function sheetAlarm() {
  const d = ui.sheet.draft;
  const at = draftAt(d);
  const days = [1, 2, 3, 4, 5, 6, 0];
  const presets = [['weekdays', 'Weekdays'], ['weekends', 'Weekends'], ['daily', 'Every day'], ['once', 'Once']];
  const daysKey = [...d.days].sort().join(',');
  const preset = (k) => (k === 'once' ? !d.days.length : DAY_SETS[k].join(',') === daysKey);
  const typeFields = {
    sunrise: () => `
      <div class="field"><span class="field-label">Fade-in length</span>
        <div class="chips">${[10, 15, 20, 30, 45, 60].map((m) => chip('draft', `data-field="duration" data-value="${m}" data-num`, d.duration === m, `${m} min`)).join('')}</div></div>
      <div class="field"><span class="field-label">Ends at brightness</span>
        <div class="slider-row" style="--c:var(--accent)">${range({ input: 'draft', field: 'brightness', value: d.brightness, label: 'End brightness' })}<output>${d.brightness}%</output></div></div>
      <div class="field"><span class="field-label">Ends at white</span>
        <div class="slider-row">${range({ input: 'draft', field: 'kelvin', value: d.kelvin, min: 2000, max: 6500, step: 100, cls: 'kelvin', label: 'End white temperature' })}<output>${d.kelvin}K</output></div></div>`,
    on: () => {
      const modes = [['keep', 'As before'], ['color', 'Color'], ['white', 'White'], ['favorite', 'Favorite'], ['scene', 'Scene']];
      const sub = {
        keep: '<p class="hint">Turns on with whatever the light was showing last.</p>',
        color: swatches('draft-color', '', d.onColor),
        white: `<div class="slider-row">${range({ input: 'draft', field: 'onKelvin', value: d.onKelvin, min: 2000, max: 6500, step: 100, cls: 'kelvin', label: 'White temperature' })}<output>${d.onKelvin}K</output></div>`,
        favorite: S.favorites.length
          ? `<div class="chips">${S.favorites.map((f) => chip('draft', `data-field="onFavorite" data-value="${f.id}"`, d.onFavorite === f.id, `<span class="dot" style="--c:${actionHex(f.action)}"></span>${esc(f.name)}`)).join('')}</div>`
          : '<p class="hint">No favorites yet — save one from any light first.</p>',
        scene: `<input class="input" placeholder="Scene name, e.g. Sunrise" data-input="draft" data-field="onScene" value="${esc(d.onScene)}" aria-label="Scene name">${sceneChips('onScene', d.onScene)}`,
      }[d.onMode];
      return `<div class="field"><span class="field-label">Brightness</span>
          <div class="slider-row" style="--c:var(--accent)">${range({ input: 'draft', field: 'onBrightness', value: d.onBrightness, label: 'Brightness' })}<output>${d.onBrightness}%</output></div></div>
        <div class="field"><span class="field-label">Light</span>
          <div class="segmented">${modes.map(([k, l]) => `<button data-action="draft" data-field="onMode" data-value="${k}" aria-pressed="${d.onMode === k}">${l}</button>`).join('')}</div>${sub}</div>`;
    },
    off: () => `<div class="field"><span class="field-label">Fade out</span>
        <div class="chips">${[0, 5, 10, 15, 30, 60].map((m) => chip('draft', `data-field="fade" data-value="${m}" data-num`, d.fade === m, m ? `${m} min` : 'Instantly')).join('')}</div></div>`,
  };
  return sheetFrame('Alarm', `
      <div class="grow"><h2>${d.id ? 'Edit alarm' : 'New alarm'}</h2><p>${esc(TYPE_INFO[d.type].label)}</p></div>${closeBtn()}`, `
      <div class="segmented" role="group" aria-label="Alarm type">${Object.entries(TYPE_INFO).map(([k, t]) => `<button data-action="draft" data-field="type" data-value="${k}" aria-pressed="${d.type === k}">${icon(t.icon)}${t.short}</button>`).join('')}</div>
      ${whenField(d)}
      <div class="field">
        ${d.type === 'sunrise' && at != null ? `<div class="sunrise-preview" aria-hidden="true">
          <div class="sunrise-bar" style="background:${sunriseGradient(d.brightness, d.kelvin)}"></div>
          <div class="sunrise-labels"><span>${fmtTime(at - d.duration * 60000)}</span><span>${d.duration} min</span><span>${fmtTime(at)}</span></div></div>` : ''}
        <p class="hint" style="text-align:center">${alarmSummary(d)}</p>
      </div>
      <div class="field"><span class="field-label">Repeat</span>
        <div class="chips day-chips">${days.map((n) => chip('draft-day', `data-day="${n}"`, d.days.includes(n), DAY_NAMES[n].slice(0, 2))).join('')}</div>
        <div class="chips">${presets.map(([k, l]) => chip('draft-days', `data-set="${k}"`, preset(k), l)).join('')}</div></div>
      <div class="field"><span class="field-label">Lights</span>
        <div class="chips">${allTargets().map((t) => chip('draft-target', `data-target="${t.ref}"`, d.target.includes(t.ref), esc(t.name))).join('')}</div></div>
      ${typeFields[d.type]()}
      <div class="field"><span class="field-label">Name (optional)</span>
        <input class="input" placeholder="${esc(TYPE_INFO[d.type].label)}" data-input="draft" data-field="name" value="${esc(d.name)}" maxlength="60"></div>
      <div class="sheet-foot">
        ${d.id ? `<button class="btn danger" data-action="delete-alarm">${icon('trash')}Delete</button>` : ''}
        <span class="spacer"></span>
        <button class="btn" data-action="preview-alarm" title="${d.type === 'sunrise' ? 'Plays the whole sunrise in 30 seconds' : 'Runs it now'}">${icon('play')}Preview</button>
        <button class="btn primary" data-action="save-alarm">Save</button>
      </div>`);
}

// ---------- group & favorite editors ----------

function sheetGroup() {
  const d = ui.sheet.draft;
  return sheetFrame('Group', `<div class="grow"><h2>${d.id ? 'Edit group' : 'New group'}</h2><p>Control several lights together</p></div>${closeBtn()}`, `
    <div class="field"><label for="group-name">Name</label><input id="group-name" class="input" placeholder="Bedroom" data-input="draft" data-field="name" value="${esc(d.name)}" maxlength="40"></div>
    <div class="field"><span class="field-label">Lights</span>
      <div class="chips">${S.devices.map((x) => chip('group-dev', `data-id="${x.id}"`, d.devices.includes(x.id), `<span class="dot" style="--c:${lightHex(x)}"></span>${esc(x.name)}`)).join('')}</div></div>
    <div class="sheet-foot">
      ${d.id ? `<button class="btn danger" data-action="delete-group">${icon('trash')}Delete</button>` : ''}
      <span class="spacer"></span><button class="btn primary" data-action="save-group">Save</button>
    </div>`);
}

/** New "what's on now" favorite (draft.capture = target), or editing one (draft.lights) */
function sheetCapture(d) {
  const rows = d.lights
    ? Object.entries(d.lights).map(([id, look]) => { const dev = devById(id); return dev && [dev.name, look.power === false ? null : actionHex(look), lookText(look)]; })
    : targetDevs(d.capture).map((dev) => [dev.name, isOn(dev) ? lightHex(dev) : null, describe(dev)]);
  return sheetFrame('Favorite', `<span class="bulb big lit" style="--c:${rows.find((r) => r?.[1])?.[1] || '#ffb347'}" aria-hidden="true"></span>
      <div class="grow"><h2>${d.id ? 'Edit favorite' : "Save what's on now"}</h2><p>${d.lights ? 'Each light gets its own look back' : 'Each light keeps its own color and brightness'}</p></div>${closeBtn()}`, `
    <div class="field"><label for="fav-name">Name</label><input id="fav-name" class="input" placeholder="Evening" data-input="draft" data-field="name" value="${esc(d.name)}" maxlength="40"></div>
    <div class="field"><span class="field-label">${d.lights ? 'Saved looks' : 'Right now'}</span>
      <div class="capture-list">${rows.filter(Boolean).map(([name, hex, text]) => `<div class="capture-row">
        <span class="bulb ${hex ? 'lit' : ''}" style="--c:${hex || 'transparent'}" aria-hidden="true"></span><b>${esc(name)}</b><span class="muted">${esc(text)}</span></div>`).join('')}</div>
      <p class="hint">${d.lights ? "Changed the lights? Update saves how they look now instead." : "Works for looks you set in the Govee app too: it asks Govee for each light's current color. Moving effects are saved as their color only — for those, turn the scene on from the Scenes list here and it's kept in My scenes."}</p></div>
    <div class="sheet-foot">
      ${d.id ? `<button class="btn danger" data-action="delete-fav">${icon('trash')}Delete</button><button class="btn" data-action="recapture-fav">${icon('refresh')}Update</button>` : ''}
      <span class="spacer"></span><button class="btn primary" data-action="save-capture" ${ui.saving ? 'disabled' : ''}>${ui.saving ? 'Saving…' : 'Save'}</button>
    </div>`);
}

function sheetFavorite() {
  const d = ui.sheet.draft;
  if (d.capture || d.lights) return sheetCapture(d);
  const modes = [['color', 'Color'], ['white', 'White'], ['scene', 'Scene']];
  const sub = {
    color: swatches('draft-color', '', d.color),
    white: `<div class="slider-row">${range({ input: 'draft', field: 'kelvin', value: d.kelvin, min: 2000, max: 9000, step: 50, cls: 'kelvin', label: 'White temperature' })}<output>${d.kelvin}K</output></div>`,
    scene: `<input class="input" placeholder="Govee scene name, e.g. Aurora" data-input="draft" data-field="scene" value="${esc(d.scene)}" aria-label="Scene name">${sceneChips('scene', d.scene)}`,
  }[d.mode];
  return sheetFrame('Favorite', `<span class="bulb big lit" style="--c:${actionHex(favDraftAction(d))}" aria-hidden="true"></span>
      <div class="grow"><h2>${d.id ? 'Edit favorite' : 'New favorite'}</h2><p>${esc(describeAction(favDraftAction(d)))}</p></div>${closeBtn()}`, `
    <div class="field"><label for="fav-name">Name</label><input id="fav-name" class="input" placeholder="Cozy evening" data-input="draft" data-field="name" value="${esc(d.name)}" maxlength="40"></div>
    <div class="field"><span class="field-label">Light</span><div class="segmented">${modes.map(([k, l]) => `<button data-action="draft" data-field="mode" data-value="${k}" aria-pressed="${d.mode === k}">${l}</button>`).join('')}</div>${sub}</div>
    <div class="field"><span class="field-label">Brightness</span>
      <div class="slider-row" style="--c:var(--accent)">${range({ input: 'draft', field: 'brightness', value: d.brightness, label: 'Brightness' })}<output>${d.brightness}%</output></div></div>
    <div class="sheet-foot">
      ${d.id ? `<button class="btn danger" data-action="delete-fav">${icon('trash')}Delete</button>` : ''}
      <span class="spacer"></span><button class="btn primary" data-action="save-fav-draft">Save</button>
    </div>`);
}

function favDraftAction(d) {
  const a = { brightness: d.brightness };
  if (d.mode === 'color') a.color = d.color;
  if (d.mode === 'white') a.kelvin = d.kelvin;
  if (d.mode === 'scene' && d.scene.trim()) a.scene = d.scene.trim();
  return a;
}

function favToDraft(f) {
  if (f.lights) return { id: f.id, name: f.name, lights: f.lights };
  const a = f.action || {};
  return {
    id: f.id, name: f.name, brightness: a.brightness ?? 100,
    mode: a.scene ? 'scene' : a.kelvin ? 'white' : 'color',
    color: a.color || COLORS.orange, kelvin: a.kelvin || 2700, scene: a.scene ? (typeof a.scene === 'string' ? a.scene : a.scene.name) : '',
  };
}

// ---------- Settings tab ----------

function viewSettings() {
  const st = S.settings;
  const phone = st.urls.filter((u) => !u.includes('localhost'));
  return `
    <section class="section">
      <div class="section-head"><h2>Govee account</h2></div>
      <div class="panel">
        ${st.hasKey
          ? `<div class="slider-row">${icon('key')}<span style="flex:1"><b>API key connected</b> <span class="muted">${esc(st.keyHint)}</span></span><button class="btn small danger" data-action="remove-key">Remove</button></div>`
          : `<div><b>Add your Govee API key</b><p class="muted small-text">Unlocks scenes, music mode, segments, and lights that don't have LAN Control.</p></div>
             <ol class="steps"><li>Open the <b>Govee Home</b> app → <b>Profile</b> (bottom right) → <b>⚙ Settings</b></li>
               <li>Tap <b>Apply for API Key</b>, fill in your name and a reason (e.g. "home automation")</li><li>The key arrives by email in a few minutes — paste it below</li></ol>`}
        ${keyForm(st.hasKey)}
        <div class="field"><span class="field-label">Cloud requests today: ${st.usage.toLocaleString()} of 10,000</span>
          <div class="meter"><span style="width:${Math.min(100, st.usage / 100)}%"></span></div></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Location</h2>${st.location ? `<button class="btn small ghost danger" data-action="remove-location">Remove</button>` : ''}</div>
      <div class="panel">
        ${st.location ? `<div class="slider-row">${icon('pin')}<span style="flex:1"><b>${st.location.lat}, ${st.location.lon}</b> <span class="muted">${esc(sunToday(st.location))}</span></span></div>`
          : '<p class="muted small-text">For alarms at sunrise or sunset, like “30 minutes before sunset”. It’s rounded to about 1 km and only kept on this computer.</p>'}
        ${locationForm()}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Lights</h2><button class="btn small ghost" data-action="refresh">${icon('refresh')}Scan again</button></div>
      ${st.lanError ? callout(`Local control is off: ${esc(st.lanError)}`, 'error') : ''}
      ${S.devices.length ? `<div class="list">${S.devices.map((d) => `<div class="list-row" data-key="s-${d.id}">
          <span class="bulb ${isOn(d) ? 'lit' : ''}" style="--c:${lightHex(d)};width:28px;height:28px" aria-hidden="true"></span>
          <div class="grow"><input class="input" value="${esc(d.customName)}" placeholder="${esc(d.name)}" data-change="rename" data-id="${d.id}" aria-label="Name for ${esc(d.name)}" maxlength="40">
            <div class="meta">${esc(d.sku)} · <span class="badge-via ${!isOnline(d) ? 'off' : d.via.startsWith('lan') ? 'lan' : ''}">${viaLabel(d)}</span>${d.ip ? ` · ${d.ip}` : ''}${!isOnline(d) && d.seenAt ? ` · last seen ${esc(fmtAgo(d.seenAt))}` : ''}</div></div>
          ${d.via === 'unreachable' ? `<button class="btn small ghost" data-action="forget-dev" data-id="${d.id}" title="Remove a light you no longer have">Forget</button>` : ''}
          <span class="hint">Show</span>${smallSwitch('hide-dev', `data-id="${d.id}"`, !d.hidden, `Show ${d.name}`)}
        </div>`).join('')}</div>` : '<p class="muted">No lights found yet.</p>'}
      <p class="hint" style="margin-top:10px">Lights are remembered, so they show up right away after a restart even before they reconnect. “Local Wi-Fi” lights respond instantly and work without internet. To enable it: Govee Home app → the light → ⚙ → <b>LAN Control</b> on.</p>
    </section>

    <section class="section">
      <div class="section-head"><h2>Groups</h2><button class="btn small ghost" data-action="new-group">${icon('plus')}New group</button></div>
      ${S.groups.length ? `<div class="list">${S.groups.map((g) => `<div class="list-row" data-key="g-${g.id}"><div class="grow"><b>${esc(g.name)}</b><div class="hint">${esc(g.devices.map((id) => devById(id)?.name).filter(Boolean).join(', ') || 'No lights')}</div></div>
          <button class="btn small" data-action="edit-group" data-id="${g.id}">${icon('edit')}Edit</button></div>`).join('')}</div>` : '<p class="muted small-text">Groups like “Bedroom” let you control several lights at once, here, in alarms and from the terminal.</p>'}
    </section>

    <section class="section">
      <div class="section-head"><h2>On your phone</h2></div>
      <div class="panel"><div class="slider-row">${icon('phone')}<span>Open on any phone or tablet on the same Wi-Fi, then use “Add to Home Screen”:</span></div>
        ${phone.map((u) => `<code class="code">${esc(u)}</code>`).join('') || '<p class="muted">No network connection.</p>'}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Terminal</h2><a class="btn small ghost" href="/dev" style="color:inherit;text-decoration:none" title="See how it works: live traffic, events and an API explorer">${icon('terminal')}Developer page</a></div>
<pre class="code">lights                    <span class="c"># status of every light</span>
lights off                <span class="c"># everything off</span>
lights bedroom on         <span class="c"># a light or group by name</span>
lights desk 40            <span class="c"># brightness</span>
lights red / lights warm  <span class="c"># color or white</span>
lights scene aurora       <span class="c"># any Govee scene</span>
lights sleep 30           <span class="c"># fade out over 30 min</span>
lights alarm add 7:00 wake weekdays  <span class="c"># sunrise fade</span>
lights alarm add sunset-30 on
lights help               <span class="c"># everything else</span></pre>
    </section>`;
}

// ---------- render ----------

const VIEWS = { lights: viewLights, scenes: viewScenes, alarms: viewAlarms, settings: viewSettings };
const SHEETS = { control: sheetControl, alarm: sheetAlarm, group: sheetGroup, favorite: sheetFavorite };

function render() {
  morphInto($('#tabs'), renderTabs());
  morphInto($('#top-actions'), renderTopActions());
  morphInto($('#banner'), renderBanner());
  if (!S) { morphInto($('#view'), '<p class="muted" style="text-align:center;padding:60px 0">Connecting to your lights…</p>'); return; }
  morphInto($('#view'), VIEWS[ui.tab]());
  let sheet = ui.sheet ? SHEETS[ui.sheet.kind]() : '';
  if (ui.sheet && !sheet) { ui.sheet = null; sheet = ''; }
  morphInto($('#sheet-root'), sheet);
  morphInto($('#trial-root'), trialBar());
  document.body.style.overflow = ui.sheet ? 'hidden' : '';
  document.body.classList.toggle('sheet-open', !!ui.sheet);
}

let lastFocus = null;
function openSheet(sheet) {
  lastFocus = document.activeElement;
  ui.sheet = sheet;
  ui.sceneEdit = false;
  render();
  requestAnimationFrame(() => $('.sheet')?.focus({ preventScroll: true }));
}
function closeSheet() {
  ui.sheet = null;
  ui.sceneEdit = false;
  render();
  lastFocus?.focus?.({ preventScroll: true });
}

// ---------- toasts ----------

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3000);
}

// ---------- actions ----------

const draft = () => ui.sheet?.draft;
const setDraft = (patch) => { Object.assign(draft(), patch); render(); };

function applyLook(ref, action, local) {
  ui.last[ref] = action;
  patchLocal(ref, { power: true, ...local });
  render();
  control(ref, action);
}

/** What a favorite's look does to a light's state, to show it before the light confirms */
function lookState(a) {
  if (a.power === false) return { power: false };
  const scene = typeof a.scene === 'string' ? a.scene : a.scene?.name;
  const look = scene ? { scene } : a.color ? { color: a.color, kelvin: null, scene: null } : a.kelvin ? { kelvin: a.kelvin, color: null, scene: null } : {};
  return { power: true, ...look, ...(a.brightness ? { brightness: a.brightness } : {}) };
}

function lookOrTry(ref, action, local, label) {
  if (ui.tryFirst) tryLook(ref, action, local, label);
  else applyLook(ref, action, local);
}

/** Shows it on the lights for a few seconds; the server puts them back unless it's kept */
async function tryLook(ref, action, local, label) {
  patchLocal(ref, { power: true, ...local });
  S.trial = { target: ref, label, endsAt: Date.now() + clockSkew + 10_000 };
  render();
  try {
    const { results } = await api('POST', '/api/try', { target: ref, action, label });
    const bad = results.filter((r) => !r.ok);
    if (bad.length) toast(bad.map((r) => `${r.name}: ${r.error}`).join('\n'), 'error');
  } catch (e) { toast(e.message, 'error'); }
}

function endTrial(how) {
  S.trial = null;
  render();
  api('POST', `/api/try/${how}`).catch((e) => toast(e.message, 'error'));
}

function trialBar() {
  const t = S?.trial;
  if (!t) return '';
  const secs = Math.max(0, Math.ceil((t.endsAt - clockSkew - Date.now()) / 1000));
  const d = lead(targetDevs(t.target));
  return `<div class="trial" role="status">
    <span class="bulb lit" style="--c:${d ? lightHex(d) : 'var(--accent)'}" aria-hidden="true"></span>
    <div class="trial-text"><b>Trying ${esc(t.label || 'a look')}</b><small>${esc(targetName(t.target))} · back in ${secs}s</small></div>
    <button class="btn" data-action="try-undo">Undo</button><button class="btn primary" data-action="try-keep">Keep</button>
  </div>`;
}
setInterval(() => { if (S?.trial) morphInto($('#trial-root'), trialBar()); }, 500);

function applyScene(ref, kind, name) {
  applyLook(ref, { scene: { name, instance: kind } }, { scene: name });
}

function hideScene(kind, name, hidden) {
  const key = sceneKey(kind, name);
  S.hiddenScenes = S.hiddenScenes.filter((k) => k !== key).concat(hidden ? [key] : []);
  render();
  api('POST', '/api/scenes/hidden', { kind, name, hidden }).catch((e) => toast(e.message, 'error'));
}

function startTimer(target, minutes, fade) {
  api('POST', '/api/timers', { target, minutes, fade })
    .then((t) => toast(`${t.label}: ${fade ? 'fading out' : 'off'} in ${minutes} min`))
    .catch((e) => toast(e.message, 'error'));
}

const actions = {
  tab(el) {
    ui.tab = el.dataset.tab;
    saved.set('tab', ui.tab);
    ui.sheet = null;
    ui.sceneEdit = false;
    render();
    window.scrollTo({ top: 0 });
  },
  'all-power'(el) {
    const on = el.dataset.on === '1';
    patchLocal('all', { power: on });
    render();
    control('all', { power: on });
  },
  power(el) {
    const ref = el.dataset.target;
    const on = el.getAttribute('aria-checked') !== 'true';
    patchLocal(ref, { power: on });
    render();
    control(ref, { power: on });
  },
  open(el) { openSheet({ kind: 'control', target: el.dataset.target, pane: saved.get('pane', 'color') }); },
  'close-sheet': () => closeSheet(),
  pane(el) { ui.sheet.pane = el.dataset.pane; saved.set('pane', ui.sheet.pane); render(); },
  color(el) {
    const ref = el.dataset.target, hex = el.dataset.color;
    ui.hs[ref] = hexToHsv(hex);
    lookOrTry(ref, { color: hex }, { color: hex, kelvin: null, scene: null }, colorName(hex));
  },
  kelvin(el) {
    const k = +el.dataset.k;
    lookOrTry(el.dataset.target, { kelvin: k }, { kelvin: k, color: null, scene: null }, `${cap(kelvinName(k))} white`);
  },
  scene(el) {
    const { target, kind, name } = el.dataset;
    if (ui.tryFirst) tryLook(target, { scene: { name, instance: kind } }, { scene: name }, name);
    else applyScene(target, kind, name);
  },
  'try-first'() { ui.tryFirst = !ui.tryFirst; saved.set('tryFirst', ui.tryFirst); render(); },
  'try-keep'() { endTrial('keep'); },
  'try-undo'() { endTrial('undo'); },
  'scene-cat'(el) { ui.sceneCat = el.dataset.cat; render(); },
  'my-scene'(el) {
    const m = S.myScenes.find((x) => x.id === el.dataset.id);
    if (m) applyScene(el.dataset.target, m.kind, m.name);
  },
  'scene-edit'() { ui.sceneEdit = !ui.sceneEdit; render(); },
  'delete-my-scene'(el) {
    const { id } = el.dataset; // read before render(): the morph reuses this button for the next scene
    S.myScenes = S.myScenes.filter((x) => x.id !== id);
    render();
    api('DELETE', `/api/my-scenes/${id}`).catch((e) => toast(e.message, 'error'));
  },
  'hide-scene'(el) { hideScene(el.dataset.kind, el.dataset.name, true); },
  'unhide-scene'(el) { hideScene(el.dataset.kind, el.dataset.name, false); },
  look(el) {
    const { action } = LOOKS.find((l) => l.id === el.dataset.look);
    applyLook(el.dataset.target, action, { color: action.color || null, kelvin: action.kelvin || null, scene: null, brightness: action.brightness });
  },
  'reload-scenes'(el) { loadScenes(el.dataset.target, true); },
  music(el) {
    const ref = el.dataset.target;
    const m = ui.music[ref];
    m.mode = el.dataset.name;
    sendMusic(ref);
  },
  'music-auto'(el) {
    const m = ui.music[el.dataset.target];
    m.autoColor = !m.autoColor;
    render();
    if (m.mode) sendMusic(el.dataset.target);
  },
  'seg-toggle'(el) {
    const st = ui.seg[el.dataset.dev], i = +el.dataset.i;
    st.sel = st.sel.includes(i) ? st.sel.filter((x) => x !== i) : [...st.sel, i];
    render();
  },
  'seg-all'(el) { const d = devById(el.dataset.dev); ui.seg[d.id].sel = [...Array(d.caps.segments.count).keys()]; render(); },
  'seg-none'(el) { ui.seg[el.dataset.dev].sel = []; render(); },
  'seg-color'(el) {
    const st = ui.seg[el.dataset.dev];
    const segs = st.sel.length ? st.sel : [...Array(devById(el.dataset.dev).caps.segments.count).keys()];
    for (const i of segs) st.paint[i] = el.dataset.color;
    render();
    control(el.dataset.target, { segments: { segments: segs, color: el.dataset.color } });
  },
  'seg-rainbow'(el) {
    const d = devById(el.dataset.dev), n = d.caps.segments.count, st = ui.seg[d.id];
    const bands = Math.min(n, 7); // one request per band keeps this quick on the cloud API
    for (let b = 0; b < bands; b++) {
      const segs = [...Array(n).keys()].filter((i) => Math.floor((i * bands) / n) === b);
      const hex = hsvToHex((b * 360) / bands, 1);
      segs.forEach((i) => (st.paint[i] = hex));
      control(el.dataset.target, { segments: { segments: segs, color: hex } });
    }
    render();
  },
  'cap-toggle'(el) { control(el.dataset.target, { toggle: { instance: el.dataset.instance, on: el.dataset.on === '1' } }); },
  'cap-mode'(el) { control(el.dataset.target, { mode: { instance: el.dataset.instance, value: JSON.parse(el.dataset.value) } }); },
  sleep(el) { startTimer(el.dataset.target, +el.dataset.min, true); },
  timer(el) { startTimer(validRef(ui.timerTarget), +el.dataset.min, ui.timerFade); },
  'timer-fade'() { ui.timerFade = !ui.timerFade; render(); },
  'cancel-timer'(el) { api('DELETE', `/api/timers/${el.dataset.id}`).catch((e) => toast(e.message, 'error')); },

  // favorites
  'scenes-target'(el) { ui.scenesTarget = el.dataset.target; saved.set('scenesTarget', ui.scenesTarget); render(); },
  'apply-fav'(el) {
    const f = S.favorites.find((x) => x.id === el.dataset.id);
    if (f.lights) for (const d of targetDevs(el.dataset.target)) { if (f.lights[d.id]) Object.assign(d.state, lookState(f.lights[d.id])); }
    else patchLocal(el.dataset.target, lookState(f.action || {}));
    render();
    if (ui.tab !== 'lights') toast(`${f.name} → ${targetName(el.dataset.target)}`);
    control(el.dataset.target, { favorite: f.id });
  },
  'new-fav'() { openSheet({ kind: 'favorite', draft: { name: '', mode: 'color', color: COLORS.orange, kelvin: 2700, scene: '', brightness: 80 } }); },
  'capture-fav'(el) { openSheet({ kind: 'favorite', draft: { capture: el.dataset.target, name: '' } }); },
  async 'save-capture'() {
    const d = draft();
    if (!d.name.trim()) return toast('Give it a name', 'error');
    ui.saving = true;
    render();
    try {
      if (d.lights) await api('POST', '/api/favorites', { id: d.id, name: d.name });
      else await api('POST', '/api/favorites/capture', { name: d.name, target: d.capture });
      toast('Favorite saved');
      closeSheet();
    } catch (e) { toast(e.message, 'error'); }
    ui.saving = false;
    render();
  },
  async 'recapture-fav'() {
    const d = draft();
    try {
      const f = await api('POST', '/api/favorites/capture', { id: d.id, name: d.name });
      setDraft({ lights: f.lights });
      toast('Updated to how the lights look now');
    } catch (e) { toast(e.message, 'error'); }
  },
  'edit-fav'(el) { openSheet({ kind: 'favorite', draft: favToDraft(S.favorites.find((f) => f.id === el.dataset.id)) }); },
  'save-fav'(el) {
    const ref = el.dataset.target;
    const main = lead(targetDevs(ref));
    const s = main.state;
    const last = ui.last[ref] || (s.scene ? { scene: s.scene } : s.kelvin ? { kelvin: s.kelvin } : s.color ? { color: s.color } : {});
    const f = { action: { ...last, brightness: s.brightness ?? 100 } };
    openSheet({ kind: 'favorite', draft: { ...favToDraft(f), id: undefined, name: '' } });
  },
  async 'save-fav-draft'() {
    const d = draft();
    if (!d.name.trim()) return toast('Give it a name', 'error');
    try {
      await api('POST', '/api/favorites', { id: d.id, name: d.name, action: favDraftAction(d) });
      toast('Favorite saved');
      closeSheet();
    } catch (e) { toast(e.message, 'error'); }
  },
  async 'delete-fav'() {
    if (!confirm(`Delete favorite "${draft().name}"?`)) return;
    await api('DELETE', `/api/favorites/${draft().id}`).catch((e) => toast(e.message, 'error'));
    closeSheet();
  },

  // alarms
  'new-alarm'() { openSheet({ kind: 'alarm', draft: newAlarmDraft() }); },
  'edit-alarm'(el) { openSheet({ kind: 'alarm', draft: alarmToDraft(S.alarms.find((a) => a.id === el.dataset.id)) }); },
  async 'toggle-alarm'(el) {
    const a = S.alarms.find((x) => x.id === el.dataset.id);
    a.enabled = !a.enabled;
    render();
    await api('POST', '/api/alarms', { ...a }).catch((e) => toast(e.message, 'error'));
  },
  draft(el) {
    const v = el.dataset.value;
    setDraft({ [el.dataset.field]: el.hasAttribute('data-num') ? +v : v });
  },
  'draft-day'(el) {
    const n = +el.dataset.day, d = draft();
    setDraft({ days: d.days.includes(n) ? d.days.filter((x) => x !== n) : [...d.days, n] });
  },
  'draft-days'(el) { setDraft({ days: el.dataset.set === 'once' ? [] : [...DAY_SETS[el.dataset.set]] }); },
  'draft-target'(el) {
    const ref = el.dataset.target, d = draft();
    let t = d.target.includes(ref) ? d.target.filter((x) => x !== ref) : [...d.target.filter((x) => (ref === 'all' ? false : x !== 'all')), ref];
    if (!t.length) t = ['all'];
    setDraft({ target: t });
  },
  'draft-color'(el) {
    setDraft(ui.sheet.kind === 'alarm' ? { onColor: el.dataset.color } : { color: el.dataset.color });
  },
  async 'save-alarm'() {
    const d = draft();
    if (d.when === 'clock' && !d.time) return toast('Pick a time', 'error');
    try {
      const a = await api('POST', '/api/alarms', draftToAlarm(d));
      toast(d.id ? 'Alarm updated' : `Alarm set ${d.when === 'clock' ? `for ${fmtHM(d.time)}` : describeSunTime(a.time)}`);
      closeSheet();
    } catch (e) { toast(e.message, 'error'); }
  },
  async 'delete-alarm'() {
    if (!confirm('Delete this alarm?')) return;
    await api('DELETE', `/api/alarms/${draft().id}`).catch((e) => toast(e.message, 'error'));
    closeSheet();
  },
  async 'preview-alarm'() {
    const d = draft();
    try {
      await api('POST', '/api/alarms/preview', draftToAlarm(d));
      toast(d.type === 'sunrise' ? 'Playing the sunrise in 30 seconds — touch any light to stop' : 'Running it now');
    } catch (e) { toast(e.message, 'error'); }
  },

  // groups
  'new-group'() { openSheet({ kind: 'group', draft: { name: '', devices: [] } }); },
  'edit-group'(el) { openSheet({ kind: 'group', draft: structuredClone(S.groups.find((g) => g.id === el.dataset.id)) }); },
  'group-dev'(el) {
    const d = draft(), id = el.dataset.id;
    setDraft({ devices: d.devices.includes(id) ? d.devices.filter((x) => x !== id) : [...d.devices, id] });
  },
  async 'save-group'() {
    const d = draft();
    if (!d.name.trim()) return toast('Give the group a name', 'error');
    if (!d.devices.length) return toast('Pick at least one light', 'error');
    try { await api('POST', '/api/groups', d); closeSheet(); } catch (e) { toast(e.message, 'error'); }
  },
  async 'delete-group'() {
    if (!confirm(`Delete group "${draft().name}"? The lights stay.`)) return;
    await api('DELETE', `/api/groups/${draft().id}`).catch((e) => toast(e.message, 'error'));
    closeSheet();
  },

  // settings
  async 'save-key'() {
    if (!ui.apiKey.trim()) return toast('Paste your API key first', 'error');
    ui.savingKey = true;
    render();
    try {
      const r = await api('POST', '/api/settings', { apiKey: ui.apiKey });
      ui.apiKey = '';
      toast(`Connected — found ${r.lights} light${r.lights === 1 ? '' : 's'} in your Govee account`);
    } catch (e) { toast(e.message, 'error'); }
    ui.savingKey = false;
    render();
  },
  async 'remove-key'() {
    if (!confirm('Remove the API key? Lights with LAN Control keep working.')) return;
    await api('POST', '/api/settings', { apiKey: '' }).catch((e) => toast(e.message, 'error'));
  },
  'save-location'() {
    const loc = parseLatLon(ui.location);
    if (!loc) return toast('Type latitude and longitude, like 50.08, 14.43', 'error');
    saveLocation(loc);
  },
  locate() {
    toast('Finding your location…');
    navigator.geolocation.getCurrentPosition((p) => saveLocation({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => toast(`Couldn’t get the location: ${e.message}`, 'error'), { timeout: 15_000 });
  },
  async 'remove-location'() {
    const n = S.alarms.filter((a) => a.enabled && parseSunTime(a.time)).length;
    if (!confirm(n ? `Remove your location? ${n} alarm${n === 1 ? '' : 's'} at sunrise or sunset won’t run until you set it again.` : 'Remove your location?')) return;
    await api('POST', '/api/settings', { location: null }).catch((e) => toast(e.message, 'error'));
  },
  async refresh() {
    toast('Looking for lights…');
    await api('POST', '/api/refresh', { full: true }).catch((e) => toast(e.message, 'error'));
  },
  async 'forget-dev'(el) {
    const d = devById(el.dataset.id);
    if (!confirm(`Forget "${d.name}"? It's removed from groups too. If it shows up on your Wi-Fi or Govee account again, it comes back.`)) return;
    await api('DELETE', `/api/devices/${encodeURIComponent(d.id)}`).then(() => toast(`Forgot ${d.name}`)).catch((e) => toast(e.message, 'error'));
  },
  async 'hide-dev'(el) {
    const d = devById(el.dataset.id);
    await api('POST', `/api/devices/${encodeURIComponent(d.id)}`, { hidden: !d.hidden }).catch((e) => toast(e.message, 'error'));
  },
};

async function saveLocation(loc) {
  try {
    const r = await api('POST', '/api/settings', { location: loc });
    ui.location = '';
    S.settings.location = r.location;
    toast(`Location saved — ${sunToday(r.location).replace(/^Today: /, 'today ')}`);
    render();
  } catch (e) { toast(e.message, 'error'); }
}

function sendMusic(ref) {
  const m = ui.music[ref];
  const main = lead(targetDevs(ref));
  ui.last[ref] = null;
  patchLocal(ref, { power: true, scene: `Music: ${m.mode}` });
  render();
  control(ref, { music: { name: m.mode, sensitivity: m.sensitivity, color: m.autoColor ? undefined : lightHex(main) } });
}

function setOutput(el, text) {
  const out = el.closest('.slider-row')?.querySelector('output');
  if (out) out.textContent = text;
}

const inputs = {
  brightness(el) {
    const ref = el.dataset.target, v = +el.value;
    setOutput(el, `${v}%`);
    patchLocal(ref, { brightness: v, power: true });
    sendThrottled(ref, 'bri', { brightness: v });
  },
  kelvin(el) {
    const ref = el.dataset.target, k = +el.value;
    setOutput(el, `${k}K`);
    ui.last[ref] = { kelvin: k };
    patchLocal(ref, { kelvin: k, color: null, scene: null, power: true });
    sendThrottled(ref, 'look', { kelvin: k });
  },
  'color-picker'(el) { pickColor(el.dataset.target, el.value); },
  'draft-color-picker'(el) { setDraft(ui.sheet.kind === 'alarm' ? { onColor: el.value } : { color: el.value }); },
  'music-sens'(el) {
    const ref = el.dataset.target, m = ui.music[ref];
    m.sensitivity = +el.value;
    setOutput(el, `${m.sensitivity}%`);
    if (m.mode) sendThrottled(ref, 'music', { music: { name: m.mode, sensitivity: m.sensitivity } });
  },
  'scene-query'(el) { ui.sceneQuery = el.value; render(); },
  draft(el) {
    const v = el.hasAttribute('data-num') ? +el.value : el.value;
    setDraft({ [el.dataset.field]: v });
  },
  'api-key'(el) { ui.apiKey = el.value; },
  location(el) { ui.location = el.value; },
};

function pickColor(ref, hex, updateHS = true) {
  if (updateHS) ui.hs[ref] = hexToHsv(hex);
  ui.last[ref] = { color: hex };
  patchLocal(ref, { color: hex, kelvin: null, scene: null, power: true });
  sendThrottled(ref, 'look', { color: hex });
}

const changes = {
  async rename(el) {
    await api('POST', `/api/devices/${encodeURIComponent(el.dataset.id)}`, { name: el.value })
      .then(() => toast('Renamed')).catch((e) => toast(e.message, 'error'));
  },
  'timer-target'(el) { ui.timerTarget = el.value; saved.set('timerTarget', el.value); },
};

// ---------- wiring ----------

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  actions[el.dataset.action](el, e);
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.type === 'range') el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
  inputs[el.dataset.input]?.(el, e);
});

document.addEventListener('change', (e) => changes[e.target.dataset.change]?.(e.target));

let wheelPointer = null; // pointer currently dragging the color wheel
document.addEventListener('pointerdown', (e) => {
  if (e.target.matches?.('input[type="range"]')) dragEl = e.target;
  const wheel = e.target.closest?.('[data-wheel]');
  if (wheel) {
    e.preventDefault();
    dragEl = wheel;
    wheelPointer = e.pointerId;
    try { wheel.setPointerCapture(e.pointerId); } catch {}
    wheel.focus({ preventScroll: true });
    wheelAt(wheel, e);
  }
});
document.addEventListener('pointermove', (e) => { if (dragEl && e.pointerId === wheelPointer) wheelAt(dragEl, e); });
const endDrag = () => { wheelPointer = null; if (dragEl) { dragEl = null; setTimeout(render, 50); } };
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.sheet) closeSheet();
  const wheel = e.target.closest?.('[data-wheel]');
  const step = { ArrowLeft: [-6, 0], ArrowRight: [6, 0], ArrowUp: [0, 0.05], ArrowDown: [0, -0.05] }[e.key];
  if (wheel && step) {
    e.preventDefault();
    const hs = ui.hs[wheel.dataset.target] || { h: 30, s: 1 };
    setWheel(wheel, { h: (hs.h + step[0] + 360) % 360, s: clamp(hs.s + step[1], 0, 1) });
  }
  if (e.key === 'Enter' && e.target.dataset?.input === 'api-key') actions['save-key']();
  if (e.key === 'Enter' && e.target.dataset?.input === 'location') actions['save-location']();
});

// Coming back to the tab: refresh states of cloud-only lights (throttled on the server)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && connected) api('POST', '/api/refresh', {}).catch(() => {});
});

// Keep countdowns fresh
setInterval(() => { if (S && !dragEl) render(); }, 20_000);

render();
connect();
