#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, DATA_DIR, LOG_FILE, configuredPort } from '../lib/store.js';
import {
  COLORS, TEMPS, DAY_SETS, DAY_NAMES, sleep, parseColor, parseKelvin, describeDays, hexToRgb, kelvinToHex,
  parseAlarmTime, parseSunTime, describeSunTime, sunTimes, parseLatLon,
} from '../lib/util.js';
import { isValueWord, valueAction as parseValue } from '../lib/commands.js';
import { serviceEnv, servicePlist } from '../lib/service.js';

const PORT = configuredPort();
const BASE = `http://127.0.0.1:${PORT}`;
const LABEL = 'com.lights.server';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const style = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = style(1), dim = style(2), red = style(31), green = style(32), yellow = style(33);
const swatch = (hex) => {
  if (!tty || !hex) return '  ';
  const { r, g, b } = hexToRgb(hex);
  return `\x1b[48;2;${r};${g};${b}m  \x1b[0m`;
};
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].length));

class CliError extends Error {}

const HELP = `
${bold('lights')} — control your Govee lights from the terminal

  ${bold('lights')}                          status of every light
  lights on | off | toggle         all lights
  lights ${dim('<name>')} on | off | toggle  one light or group ${dim('(partial names work: "bed")')}
  lights ${dim('[name]')} 40                 brightness 1-100 ${dim('(0 = off, 0.5 / 0.25 / 0.1 = dimmer than 1%)')}
  lights ${dim('[name]')} red | "#ff8800"    color ${dim(`(${Object.keys(COLORS).slice(0, 9).join(', ')}, …)`)}
  lights ${dim('[name]')} warm | 2700        white ${dim(`(${Object.keys(TEMPS).join(', ')} or 2000-9000)`)}
  lights ${dim('[name]')} scene ${dim('<scene>')}     a Govee scene ${dim('— "lights scene aurora"')}
  lights ${dim('[name]')} scenes             list the scenes you can use
  lights ${dim('[name]')} music ${dim('[mode]')}      music-reactive mode
  lights ${dim('[name]')} fav ${dim('<favorite>')}    apply a saved favorite ${dim('— "lights favs" lists them')}
  lights ${dim('[name]')} sleep ${dim('[min]')}       fade out over N minutes ${dim('(default 30)')}, then off
  lights ${dim('[name]')} timer ${dim('<min>')}       switch off after N minutes, no fade
  lights timers ${dim('[cancel]')}           list or cancel sleep timers

  ${bold('lights alarms')}                   list alarms
  lights alarm add ${dim('<when> [wake|on|off] [days] [options]')}
      when     7:00 | 6:30am  ${dim('or the real sun:')} sunrise | sunset | sunset-30 | sunrise+15
               ${dim('(minutes before/after; needs "lights location")')}
      wake     sunrise fade: glows from red to white, done at <when> ${dim('(the default)')}
      on, off  turn on, or turn off ${dim('(with --for: fade out)')}
      days     weekdays | weekends | daily | once | mon,wed,fri   ${dim('(default daily)')}
      options  --lights <name>  --name <label>  --for <min> ${dim('(sunrise fade length / fade-out)')}
               --brightness <n>  --color <c>  --temp <k>  --fav <favorite>  --scene <scene>
      ${dim('lights alarm add 6:45 wake weekdays --for 30')}
      ${dim('lights alarm add 23:30 off daily --for 15 --lights bedroom')}
      ${dim('lights alarm add sunset-30 on --lights desk --fav "cozy"')}
  lights alarm on | off | rm | test ${dim('<number|name>')}

  lights groups                    list groups
  lights group add ${dim('<group> <light> [light…]')}  /  lights group rm ${dim('<group>')}

  lights open                      open the web app in your browser
  lights dev                       open the developer page ${dim('(live traffic, events, API explorer)')}
  lights key ${dim('<api-key>')}               save your Govee API key
  lights location ${dim('<lat> <lon> | off')}  where you are, for alarms at sunrise/sunset ${dim('(e.g. 50.08 14.43)')}
  lights pin ${dim('<digits> | off')}         a PIN other devices need for the web app ${dim('(this computer never does)')}
  lights refresh                   look for lights again
  lights service install           run at login ${dim('(needed for alarms to fire reliably; keeps LIGHTS_* settings)')}
  lights service uninstall | status
  lights start | stop | restart | logs
`;

// ---------- server connection ----------

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(BASE + url, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new CliError(`Can't reach the lights server on port ${PORT}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CliError(data.error || res.statusText);
  return data;
}

async function serverUp() {
  try {
    await fetch(BASE + '/api/state', { signal: AbortSignal.timeout(2500) });
    return true;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverUp()) return;
  if (serviceInstalled()) {
    try { execFileSync('launchctl', ['kickstart', `gui/${process.getuid()}/${LABEL}`], { stdio: 'ignore' }); } catch {}
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const log = fs.openSync(LOG_FILE, 'a');
    spawn(process.execPath, [path.join(ROOT, 'server.js')], { detached: true, stdio: ['ignore', log, log], cwd: ROOT }).unref();
  }
  process.stderr.write(dim('Starting the lights server… '));
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (await serverUp()) { process.stderr.write(dim('ready\n')); return; }
  }
  throw new CliError(`The server didn't start. See ${LOG_FILE}`);
}

// ---------- names ----------

function findByName(items, q, what) {
  const s = q.toLowerCase();
  for (const test of [(n) => n === s, (n) => n.startsWith(s), (n) => n.includes(s)]) {
    const hits = items.filter((x) => test(x.name.toLowerCase()));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new CliError(`"${q}" matches several ${what}: ${hits.map((h) => h.name).join(', ')}`);
  }
  return null;
}

/** Turns a light/group name into a stable reference, so renaming later doesn't break alarms. */
function toRef(S, name) {
  if (!name || name.toLowerCase() === 'all') return 'all';
  const items = [
    ...S.groups.map((g) => ({ name: g.name, ref: `group:${g.id}` })),
    ...S.devices.map((d) => ({ name: d.name, ref: `device:${d.id}` })),
  ];
  const hit = findByName(items, name, 'lights');
  if (!hit) throw new CliError(`No light or group called "${name}". Run "lights" to see them.`);
  return hit.ref;
}

function refName(S, ref) {
  if (ref === 'all') return 'All lights';
  if (ref.startsWith('group:')) return S.groups.find((g) => `group:${g.id}` === ref)?.name || '(deleted group)';
  if (ref.startsWith('device:')) return S.devices.find((d) => `device:${d.id}` === ref)?.name || '(missing light)';
  return ref;
}

// ---------- output ----------

const kelvinName = (k) => (k < 2400 ? 'candle' : k < 3000 ? 'warm' : k < 3600 ? 'soft' : k < 4800 ? 'neutral' : k < 6000 ? 'daylight' : 'cool');
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function relDay(ms) {
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date(ms)) - day(new Date())) / 864e5);
  return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : DAY_NAMES[new Date(ms).getDay()];
}

function lightLine(d, width) {
  const s = d.state;
  const online = d.via !== 'unreachable' && s.online !== false;
  const on = online && s.power === true;
  const hex = on ? (s.kelvin ? kelvinToHex(s.kelvin) : s.color && s.color !== '#000000' ? s.color : null) : null;
  let look = '';
  if (on) {
    if (d.fading) look = d.fading;
    else if (s.scene) look = s.scene;
    else if (s.kelvin) look = `${kelvinName(s.kelvin)} white ${s.kelvin}K`;
    else if (s.color) look = s.color;
  }
  const state = !online ? red('offline') : s.power == null ? dim('unknown') : on ? green('on ') : dim('off');
  const bri = on && s.brightness != null ? `${s.dim || s.brightness}%` : '';
  const via = { 'lan+cloud': 'local', lan: 'local', cloud: 'cloud', unreachable: '' }[d.via];
  return `  ${on ? swatch(hex || '#ffc98a') : '  '} ${pad(d.name, width)}  ${pad(state, 3)}  ${pad(bri, 4)}  ${pad(look, 26)} ${dim(via)}`;
}

function printStatus(S, ids = null) {
  const devs = S.devices.filter((d) => (ids ? ids.includes(d.id) : !d.hidden));
  if (!S.devices.length) {
    console.log(`\n  No lights found yet.\n`);
    if (!S.settings.hasKey) console.log(`  Add your Govee API key:  ${bold('lights key <your-key>')}  ${dim('(Govee app → Profile → ⚙ → Apply for API Key)')}`);
    console.log(`  Or switch on ${bold('LAN Control')} for each light in the Govee app, then run ${bold('lights refresh')}.\n`);
    return;
  }
  const width = Math.max(...devs.map((d) => [...d.name].length), 8);
  console.log();
  for (const d of devs) console.log(lightLine(d, width));
  if (ids) { console.log(); return; }
  if (S.groups.length) console.log(`\n  ${dim('Groups:')} ${S.groups.map((g) => `${g.name} ${dim(`(${g.devices.length})`)}`).join(', ')}`);
  const next = S.upcoming[0];
  const a = next && S.alarms.find((x) => x.id === next.id);
  if (a) {
    const starts = a.type === 'sunrise' ? dim(` (fade starts ${fmtTime(next.start)})`) : '';
    console.log(`  ${dim('Next alarm:')} ${alarmLabel(a)} — ${relDay(next.at)} ${fmtTime(next.at)}${starts}`);
  }
  for (const t of S.timers) console.log(`  ${dim('Sleep timer:')} ${t.label} off at ${fmtTime(t.endsAt)}`);
  if (S.settings.cloudError) console.log(`  ${red('Cloud:')} ${S.settings.cloudError}`);
  if (S.settings.lanError) console.log(`  ${yellow('LAN:')} ${S.settings.lanError}`);
  console.log();
}

async function act(target, action, label) {
  const { results } = await request('POST', '/api/control', { target, action });
  const ok = results.filter((r) => r.ok), bad = results.filter((r) => !r.ok);
  if (ok.length) console.log(`${green('✓')} ${ok.map((r) => r.name).join(', ')} ${dim('→')} ${label}`);
  for (const r of bad) console.log(`${red('✗')} ${r.name}: ${r.error}`);
  if (bad.length) process.exitCode = 1;
}

function alarmLabel(a) {
  const base = a.type === 'sunrise' ? `Sunrise fade ${a.duration} min` : a.type === 'off' ? (a.fade ? `Fade out ${a.fade} min` : 'Off') : 'On';
  return a.name ? `${a.name} (${base})` : base;
}

/** "at 07:00" or "30 min before sunset" */
const whenText = (time) => (parseSunTime(time) ? describeSunTime(time) : `at ${time}`);

// ---------- commands ----------

const COMMANDS = new Set([
  'on', 'off', 'toggle', 'status', 'ls', 'list', 'bright', 'brightness', 'dim', 'color', 'temp', 'scene', 'scenes',
  'music', 'fav', 'favorite', 'favs', 'favorites', 'sleep', 'timer', 'timers', 'alarm', 'alarms', 'group', 'groups',
  'open', 'ui', 'key', 'location', 'pin', 'refresh', 'scan',
]);
/** "lights <value>" shortcuts: brightness, color or white (lib/commands.js, shared with Siri/Shortcuts) */
function valueAction(w) {
  const v = parseValue(w);
  if (!v) throw new CliError(`Don't understand "${w}"`);
  return v;
}

async function main(argv) {
  const args = argv.filter(Boolean);
  const first = (args[0] || '').toLowerCase();
  if (['help', '-h', '--help'].includes(first)) return console.log(HELP);
  if (first === 'service') return service(args[1]);
  if (first === 'stop') return stop();
  if (first === 'logs') return logs(args.includes('-f'));
  if (first === 'restart') { await stop(true); await ensureServer(); return; }
  await ensureServer();
  if (first === 'start') return console.log(`Lights server running on ${BASE.replace('127.0.0.1', 'localhost')}`);
  if (first === 'dev') return openUi('/dev');

  const S = await request('GET', '/api/state');
  if (!args.length) return printStatus(S);

  // Split "[target words…] <command> [args…]"
  let i = args.findIndex((w) => COMMANDS.has(w.toLowerCase()));
  if (i === -1 && isValueWord(args[args.length - 1])) i = args.length - 1;
  if (i === -1) return bare(S, args);
  let target = i > 0 ? toRef(S, args.slice(0, i).join(' ')) : 'all';
  const cmd = args[i].toLowerCase();
  const rest = args.slice(i + 1);
  const restText = rest.join(' ');
  // "lights off bedroom" works too
  if (['on', 'off', 'toggle', 'status', 'ls', 'list', 'scenes', 'sleep', 'timer'].includes(cmd) && i === 0) {
    const words = rest.filter((w) => !/^\d+$/.test(w));
    if (words.length) target = toRef(S, words.join(' '));
  }
  const name = refName(S, target);

  switch (cmd) {
    case 'on': return act(target, { power: true }, 'on');
    case 'off': return act(target, { power: false }, 'off');
    case 'toggle': return act(target, { power: 'toggle' }, 'toggled');
    case 'status': case 'ls': case 'list': {
      const ids = target === 'all' ? null : S.devices.filter((d) => resolveLocal(S, target).includes(d.id)).map((d) => d.id);
      return printStatus(S, ids);
    }
    case 'bright': case 'brightness': case 'dim': {
      const n = parseFloat(rest[0]);
      if (!Number.isFinite(n)) throw new CliError('Usage: lights [name] bright <0-100>  (below 1, like 0.25, is dimmer than 1%)');
      return n === 0 ? act(target, { power: false }, 'off') : act(target, { brightness: n }, `${n < 1 ? n : Math.min(100, Math.round(n))}%`);
    }
    case 'color': {
      const c = parseColor(restText);
      if (!c) throw new CliError(`Unknown color "${restText}". Try a name (${Object.keys(COLORS).join(', ')}) or hex like ff8800`);
      return act(target, { color: c }, COLORS[restText.toLowerCase()] ? restText : c);
    }
    case 'temp': {
      const k = parseKelvin(restText || 'white');
      if (!k) throw new CliError(`Unknown white "${restText}". Use ${Object.keys(TEMPS).join(', ')} or 2000-9000`);
      return act(target, { kelvin: k }, `white ${k}K`);
    }
    case 'scene':
      if (!restText) return listScenes(target);
      return act(target, { scene: restText }, `scene "${restText}"`);
    case 'scenes': return listScenes(target, restText);
    case 'music': return act(target, { music: restText }, `music mode${restText ? ` "${restText}"` : ''}`);
    case 'fav': case 'favorite':
      if (!restText) return listFavs(S);
      return act(target, { favorite: restText }, `★ ${restText}`);
    case 'favs': case 'favorites': return listFavs(S);
    case 'sleep': {
      const min = parseInt(rest.find((w) => /^\d+$/.test(w)) || '30', 10);
      const t = await request('POST', '/api/timers', { target, minutes: min, fade: true });
      return console.log(`${green('✓')} ${name}: fading out, off at ${fmtTime(t.endsAt)} ${dim('(touch the lights or "lights timers cancel" to stop)')}`);
    }
    case 'timer': {
      const min = parseInt(rest.find((w) => /^\d+$/.test(w)), 10);
      if (!Number.isFinite(min)) throw new CliError('Usage: lights [name] timer <minutes>');
      const t = await request('POST', '/api/timers', { target, minutes: min, fade: false });
      return console.log(`${green('✓')} ${name}: off at ${fmtTime(t.endsAt)}`);
    }
    case 'timers': return timers(S, rest[0]);
    case 'alarms': return listAlarms(S);
    case 'alarm': return alarm(S, rest);
    case 'groups': return listGroups(S);
    case 'group': return group(S, rest);
    case 'open': case 'ui': return openUi();
    case 'key': return setKey(rest[0]);
    case 'location': return setLocation(S, rest.join(' '));
    case 'pin': return setPin(S, rest[0]);
    case 'refresh': case 'scan': {
      process.stderr.write(dim('Looking for lights…\n'));
      return printStatus(await request('POST', '/api/refresh', { full: true }));
    }
    default: {
      const [action, label] = valueAction(args[i]);
      return act(target, action, label);
    }
  }
}

function resolveLocal(S, ref) {
  if (ref === 'all') return S.devices.filter((d) => !d.hidden).map((d) => d.id);
  if (ref.startsWith('group:')) return S.groups.find((g) => `group:${g.id}` === ref)?.devices || [];
  return [ref.slice(7)];
}

/** No command word: a favorite, a light/group (show status), or "<light> <favorite|scene>" */
async function bare(S, args) {
  const text = args.join(' ');
  const fav = findByName(S.favorites, text, 'favorites');
  if (fav) return act('all', { favorite: fav.id }, `★ ${fav.name}`);
  let ref = null;
  try { ref = toRef(S, text); } catch {}
  if (ref) return printStatus(S, resolveLocal(S, ref));
  let target = 'all', preset = text;
  if (args.length > 1) {
    try { target = toRef(S, args[0]); preset = args.slice(1).join(' '); } catch {}
  }
  if (!findByName(S.favorites, preset, 'favorites') && !(await sceneExists(target, preset))) {
    throw new CliError(`"${text}" isn't a light, group, favorite or scene. See: lights help`);
  }
  return act(target, { preset }, preset);
}

async function sceneExists(target, name) {
  const data = await request('GET', `/api/scenes?target=${encodeURIComponent(target)}`).catch(() => null);
  const q = name.toLowerCase();
  return !!data && ['lightScene', 'diyScene', 'snapshot'].some((kind) => data[kind].some((o) => o.name.toLowerCase().includes(q)));
}

async function listScenes(target, filter = '') {
  const [data, S] = await Promise.all([request('GET', `/api/scenes?target=${encodeURIComponent(target)}`), request('GET', '/api/state')]);
  const q = filter.toLowerCase();
  // Scenes deleted in the web app stay out of the list
  const hidden = new Set(S.hiddenScenes);
  data.mine = S.myScenes.map((m) => ({ name: m.name }));
  for (const kind of ['lightScene', 'diyScene', 'snapshot']) data[kind] = data[kind].filter((o) => !hidden.has(`${kind}|${o.name.toLowerCase()}`));
  const groups = [['mine', 'My scenes'], ['lightScene', 'Scenes'], ['diyScene', 'DIY scenes'], ['snapshot', 'Snapshots']];
  let any = false;
  for (const [kind, title] of groups) {
    const names = data[kind].map((o) => o.name).filter((n) => !q || n.toLowerCase().includes(q));
    if (!names.length) continue;
    any = true;
    console.log(`\n${bold(title)} ${dim(`(${names.length})`)}`);
    const w = Math.min(28, Math.max(...names.map((n) => n.length)) + 2);
    const cols = Math.max(1, Math.floor((process.stdout.columns || 80) / w));
    for (let r = 0; r < names.length; r += cols) console.log('  ' + names.slice(r, r + cols).map((n) => pad(n, w)).join(''));
  }
  if (!any) console.log(dim('No scenes found. Scenes need a Govee API key: lights key <your-key>'));
  else console.log(dim(`\nUse one with: lights scene <name>`));
}

function listFavs(S) {
  if (!S.favorites.length) return console.log(dim('No favorites yet. Save one in the web app (lights open) with ★ Save as favorite.'));
  for (const f of S.favorites) {
    const a = f.action;
    const hex = a.color || (a.kelvin && kelvinToHex(a.kelvin));
    const what = a.scene ? `scene ${a.scene.name || a.scene}` : a.kelvin ? `white ${a.kelvin}K` : a.color || '';
    const text = f.lights ? `${Object.keys(f.lights).length} lights` : [what, a.brightness && `${a.brightness}%`].filter(Boolean).join(' · ');
    console.log(`  ${swatch(hex || '#ffb347')} ${pad(f.name, 20)} ${dim(text)}`);
  }
}

async function timers(S, sub) {
  if (sub === 'cancel' || sub === 'clear') {
    for (const t of S.timers) await request('DELETE', `/api/timers/${t.id}`);
    return console.log(S.timers.length ? `${green('✓')} Cancelled ${S.timers.length} timer(s)` : dim('No timers running'));
  }
  if (!S.timers.length) return console.log(dim('No sleep timers running. Start one with: lights sleep 30'));
  for (const t of S.timers) console.log(`  ${t.label}: ${t.fade ? 'fading out' : 'switches off'}, off at ${fmtTime(t.endsAt)}`);
}

// ---------- alarms ----------

const sortedAlarms = (S) => [...S.alarms].sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));

function listAlarms(S) {
  const list = sortedAlarms(S);
  if (!list.length) return console.log(dim('No alarms yet. Try: lights alarm add 7:00 wake weekdays'));
  const width = Math.max(...list.map((a) => a.time.length));
  console.log();
  list.forEach((a, n) => {
    const up = S.upcoming.find((u) => u.id === a.id);
    const sunless = a.enabled && !up && parseSunTime(a.time);
    const next = a.enabled && up ? dim(`next ${relDay(up.at)} ${fmtTime(up.at)}`)
      : sunless ? yellow(S.settings.location ? 'no sunrise/sunset here this week' : 'needs your location: lights location <lat> <lon>') : '';
    const dot = a.enabled ? green('●') : dim('○');
    const time = a.enabled ? bold(pad(a.time, width)) : dim(pad(a.time, width));
    console.log(`  ${dim(String(n + 1).padStart(2))}  ${dot} ${time}  ${pad(alarmLabel(a), 24)} ${pad(describeDays(a.days), 14)} ${pad(a.target.map((r) => refName(S, r)).join(', '), 16)} ${next}`);
  });
  console.log(dim(`\n  lights alarm on|off|rm|test <number>`));
  console.log();
}

function findAlarm(S, q) {
  if (!q) throw new CliError('Which alarm? Give its number from "lights alarms" or its name');
  const list = sortedAlarms(S);
  if (/^\d+$/.test(q) && list[+q - 1]) return list[+q - 1];
  const byName = findByName(list.filter((a) => a.name), q, 'alarms');
  const byTime = list.filter((a) => a.time === parseAlarmTime(q));
  const hit = byName || (byTime.length === 1 ? byTime[0] : null);
  if (!hit) throw new CliError(`No alarm "${q}". See: lights alarms`);
  return hit;
}

function parseDays(s) {
  const parts = s.toLowerCase().split(/[,+]/).map((p) => p.trim()).filter(Boolean);
  const days = parts.map((p) => DAY_NAMES.findIndex((n) => n.toLowerCase().startsWith(p.slice(0, 2))));
  return parts.length && days.every((d) => d >= 0) ? days : null;
}

function parseAlarmArgs(S, rest) {
  const opts = {}, pos = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) opts[rest[i].slice(2)] = rest[++i];
    else pos.push(rest[i]);
  }
  // "sunset -30" typed with a space is one time
  if (parseSunTime(pos[0]) && /^[+-]\d+$/.test(pos[1] || '')) pos.splice(0, 2, pos[0] + pos[1]);
  const time = parseAlarmTime(pos.shift());
  if (!time) throw new CliError('Usage: lights alarm add <when> [wake|on|off] [days] — when: 7:00, 6:30am, sunset, sunrise+15, sunset-30');
  let type = 'sunrise';
  let days = [...DAY_SETS.daily];
  for (const w of pos) {
    const l = w.toLowerCase();
    // After the time, "sunrise" still means the sunrise fade, as it always has
    if (['sunrise', 'wake', 'wakeup', 'on', 'off', 'sleep'].includes(l)) type = { wake: 'sunrise', wakeup: 'sunrise', sleep: 'off' }[l] || l;
    else if (l === 'everyday') days = [...DAY_SETS.daily];
    else if (DAY_SETS[l]) days = [...DAY_SETS[l]];
    else if (l === 'once') days = [];
    else if (parseDays(l)) days = parseDays(l);
    else throw new CliError(`Don't understand "${w}"`);
  }
  const a = { type, time, days, name: opts.name || '', target: [toRef(S, opts.lights)] };
  if (type === 'sunrise') Object.assign(a, { duration: +(opts.for || 30), brightness: +(opts.brightness || 100), kelvin: parseKelvin(opts.temp) || 4000 });
  else if (type === 'off') a.fade = +(opts.for || 0);
  else a.action = { brightness: +(opts.brightness || 100), color: opts.color, kelvin: opts.temp, favorite: opts.fav, scene: opts.scene };
  return a;
}

async function alarm(S, rest) {
  const sub = (rest[0] || 'list').toLowerCase();
  if (sub === 'list' || sub === 'ls') return listAlarms(S);
  if (sub === 'add' || sub === 'new') {
    const draft = parseAlarmArgs(S, rest.slice(1));
    if (draft.action?.favorite) {
      const f = findByName(S.favorites, draft.action.favorite, 'favorites');
      if (!f) throw new CliError(`No favorite "${draft.action.favorite}"`);
      draft.action.favorite = f.id;
    }
    const a = await request('POST', '/api/alarms', draft);
    const after = await request('GET', '/api/state');
    const up = after.upcoming.find((u) => u.id === a.id);
    console.log(`${green('✓')} ${alarmLabel(a)} ${whenText(a.time)}, ${describeDays(a.days).toLowerCase()}${up ? dim(` — next ${relDay(up.at)} ${fmtTime(up.at)}`) : ''}`);
    if (!serviceInstalled()) console.log(dim(`  Tip: run "lights service install" so alarms fire even after a restart.`));
    return;
  }
  const a = findAlarm(S, rest.slice(1).join(' '));
  if (sub === 'on' || sub === 'enable' || sub === 'off' || sub === 'disable') {
    const enabled = sub === 'on' || sub === 'enable';
    await request('POST', '/api/alarms', { ...a, enabled });
    return console.log(`${green('✓')} ${alarmLabel(a)} ${whenText(a.time)} ${enabled ? 'on' : 'off'}`);
  }
  if (sub === 'rm' || sub === 'delete' || sub === 'remove') {
    await request('DELETE', `/api/alarms/${a.id}`);
    return console.log(`${green('✓')} Deleted ${alarmLabel(a)} ${whenText(a.time)}`);
  }
  if (sub === 'test' || sub === 'preview') {
    await request('POST', '/api/alarms/preview', a);
    return console.log(`${green('✓')} Previewing ${alarmLabel(a)}${a.type === 'sunrise' ? ' (the whole sunrise in 30 s)' : ''}`);
  }
  throw new CliError(`Unknown: lights alarm ${sub}. See: lights help`);
}

// ---------- groups ----------

function listGroups(S) {
  if (!S.groups.length) return console.log(dim('No groups yet. Try: lights group add Bedroom "strip" "lamp"'));
  for (const g of S.groups) console.log(`  ${pad(g.name, 16)} ${dim(g.devices.map((id) => S.devices.find((d) => d.id === id)?.name || '?').join(', '))}`);
}

async function group(S, rest) {
  const sub = (rest[0] || '').toLowerCase();
  if (sub === 'add' || sub === 'new' || sub === 'set') {
    const [name, ...lights] = rest.slice(1);
    if (!name || !lights.length) throw new CliError('Usage: lights group add <group> <light> [light…]');
    const devices = lights.map((l) => {
      const d = findByName(S.devices, l, 'lights');
      if (!d) throw new CliError(`No light called "${l}"`);
      return d.id;
    });
    const existing = S.groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
    await request('POST', '/api/groups', { id: existing?.id, name, devices });
    return console.log(`${green('✓')} Group ${name}: ${devices.map((id) => S.devices.find((d) => d.id === id).name).join(', ')}`);
  }
  if (sub === 'rm' || sub === 'delete' || sub === 'remove') {
    const g = findByName(S.groups, rest.slice(1).join(' '), 'groups');
    if (!g) throw new CliError('No such group');
    await request('DELETE', `/api/groups/${g.id}`);
    return console.log(`${green('✓')} Deleted group ${g.name}`);
  }
  return listGroups(S);
}

// ---------- setup & service ----------

async function setKey(key) {
  if (!key) throw new CliError('Usage: lights key <api-key>   (Govee app → Profile → ⚙ Settings → Apply for API Key)');
  const r = await request('POST', '/api/settings', { apiKey: key });
  console.log(`${green('✓')} API key saved — found ${r.lights} light(s) in your Govee account`);
  printStatus(await request('GET', '/api/state'));
}

async function setLocation(S, text) {
  const t = text.trim().toLowerCase();
  if (!t) {
    const loc = S.settings.location;
    if (!loc) return console.log(dim('No location set. For alarms at sunrise or sunset: lights location <latitude> <longitude>  (e.g. 50.08 14.43)'));
    return console.log(`  ${loc.lat}, ${loc.lon}  ${dim(sunToday(loc))}`);
  }
  if (['off', 'none', 'remove', 'clear'].includes(t)) {
    await request('POST', '/api/settings', { location: null });
    const sun = S.alarms.filter((a) => a.enabled && parseSunTime(a.time)).length;
    return console.log(`${green('✓')} Location removed${sun ? yellow(` — ${sun} alarm(s) at sunrise/sunset won't run until you set one again`) : ''}`);
  }
  if (!parseLatLon(text)) throw new CliError('Usage: lights location <latitude> <longitude>, like: lights location 50.08 14.43 (south and west are negative)');
  const { location: loc } = await request('POST', '/api/settings', { location: text });
  console.log(`${green('✓')} Location set to ${loc.lat}, ${loc.lon} ${dim(`— ${sunToday(loc)}`)}`);
}

async function setPin(S, value = '') {
  const v = value.toLowerCase();
  if (!v) {
    return console.log(S.settings.pin
      ? `  PIN is ${green('on')}: other devices need it once, then stay logged in. This computer never needs it.\n  ${dim('Change it: lights pin <digits>   Remove it: lights pin off')}`
      : `  No PIN: anyone on your Wi-Fi can use the web app.\n  ${dim('Set one: lights pin <4-12 digits>')}`);
  }
  if (['off', 'none', 'remove', 'clear'].includes(v)) {
    await request('POST', '/api/pin', { pin: null });
    return console.log(`${green('✓')} PIN removed — anyone on your Wi-Fi can use the web app again`);
  }
  if (!/^\d{4,12}$/.test(value)) throw new CliError('The PIN must be 4 to 12 digits, like: lights pin 482193');
  await request('POST', '/api/pin', { pin: value });
  console.log(`${green('✓')} PIN set. Phones and other computers ask for it once${S.settings.pin ? ' (everyone who was logged in has to enter the new one)' : ''}. This computer never does.`);
}

function sunToday(loc) {
  const s = sunTimes(new Date(), loc.lat, loc.lon);
  if (s.polar) return s.polar === 'day' ? 'the sun stays up all day today' : 'the sun stays down all day today';
  return `today: sunrise ${fmtTime(s.sunrise)}, sunset ${fmtTime(s.sunset)}`;
}

function openUi(page = '') {
  const url = `http://localhost:${PORT}${page}`;
  if (process.platform === 'darwin') execFileSync('open', [url]);
  console.log(url);
}

function serviceInstalled() { return process.platform === 'darwin' && fs.existsSync(PLIST); }

function nodePath() {
  // Prefer the stable Homebrew symlink so a `brew upgrade node` doesn't break the service
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) if (fs.existsSync(p)) return p;
  return process.execPath;
}

/** The LIGHTS_* settings saved with the installed service, or null if there's no service */
function savedServiceEnv() {
  if (!serviceInstalled()) return null;
  try {
    return JSON.parse(execFileSync('plutil', ['-extract', 'EnvironmentVariables', 'json', '-o', '-', PLIST], { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
  } catch { return {}; } // installed without any
}

const envLine = (env) => Object.entries(env).map(([k, v]) => `${k}=${v}`).join('  ');

async function service(sub) {
  if (process.platform !== 'darwin') throw new CliError('"lights service" is macOS only. Elsewhere, run "node server.js" from your init system.');
  const domain = `gui/${process.getuid()}`;
  if (sub === 'install') {
    if (await serverUp()) { await request('POST', '/api/shutdown').catch(() => {}); await sleep(800); }
    fs.mkdirSync(path.dirname(PLIST), { recursive: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try { execFileSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' }); } catch {}
    const env = serviceEnv();
    fs.writeFileSync(PLIST, servicePlist({
      label: LABEL, node: nodePath(), server: path.join(ROOT, 'server.js'), root: ROOT, log: LOG_FILE, env,
    }));
    execFileSync('launchctl', ['bootstrap', domain, PLIST]);
    for (let i = 0; i < 40 && !(await serverUp()); i++) await sleep(250);
    console.log(`${green('✓')} Lights server installed — it starts at login and restarts if it crashes.`);
    if (Object.keys(env).length) {
      console.log(`  Saved with it: ${envLine(env)}`);
      if (env.LIGHTS_PORT || env.LIGHTS_DATA_DIR) console.log(yellow(`  Keep LIGHTS_PORT / LIGHTS_DATA_DIR set in your shell profile too, so lights commands find the server.`));
      console.log(dim('  To change them, set them and run "lights service install" again.'));
    }
    console.log(dim(`  ${PLIST}\n  Web app: http://localhost:${PORT}`));
    return;
  }
  if (sub === 'uninstall' || sub === 'remove') {
    try { execFileSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' }); } catch {}
    if (fs.existsSync(PLIST)) fs.unlinkSync(PLIST);
    return console.log(`${green('✓')} Removed. The server no longer starts at login.`);
  }
  const running = await serverUp();
  const env = savedServiceEnv();
  console.log(`  Service:  ${env ? green('installed (starts at login)') : yellow('not installed — run "lights service install"')}`);
  if (env) console.log(`  Settings: ${Object.keys(env).length ? envLine(env) : dim('none saved (LIGHTS_* variables set when installing are kept)')}`);
  console.log(`  Server:   ${running ? green(`running on http://localhost:${PORT}`) : dim('not running')}`);
}

async function stop(quiet = false) {
  if (!(await serverUp())) return quiet || console.log(dim('The lights server is not running.'));
  await request('POST', '/api/shutdown');
  for (let i = 0; i < 20 && (await serverUp()); i++) await sleep(200);
  if (!quiet) console.log(`${green('✓')} Stopped.${serviceInstalled() ? dim(' It starts again at next login, or with "lights start".') : ''} ${yellow('Alarms won\'t fire while it\'s stopped.')}`);
}

function logs(follow) {
  if (!fs.existsSync(LOG_FILE)) return console.log(dim('No logs yet.'));
  spawn('tail', ['-n', '40', ...(follow ? ['-f'] : []), LOG_FILE], { stdio: 'inherit' });
}

main(process.argv.slice(2)).catch((e) => {
  console.error(red(e instanceof CliError ? e.message : e.stack || e.message));
  process.exit(1);
});
