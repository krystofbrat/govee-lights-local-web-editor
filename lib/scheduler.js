import { randomUUID } from 'node:crypto';
import { DAY_NAMES, clamp, parseAlarmTime, parseSunTime, parseTime, sunTimes } from './util.js';
import { sunrise, fadeOut } from './fades.js';
import { UserError } from './devices.js';

const MIN = 60_000;
const GRACE = 5 * MIN; // fire alarms that were missed by up to this much (e.g. the Mac just woke up)
const TYPES = ['sunrise', 'on', 'off'];
const WARN_AHEAD = 10 * 60 * MIN; // look for problems with alarms whose lights start in the next 10 hours...
const WARN_AFTER = 5 * MIN;       // ...and send a notification once one has lasted this long (a quick unplug is fine)
const CHECK_EVERY = MIN;
const NAMES = { sunrise: 'Sunrise', on: 'Lights on', off: 'Lights off' };
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "today", "tomorrow", "yesterday" or the weekday of `ms`, seen from `now` */
function dayWord(ms, now = Date.now()) {
  const day = (x) => { const d = new Date(x); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const diff = Math.round((day(ms) - day(now)) / 864e5);
  return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff === -1 ? 'yesterday' : DAY_NAMES[new Date(ms).getDay()];
}
export const NEED_LOCATION = 'Times at sunrise or sunset need your location: set it in Settings → Location, or run "lights location <latitude> <longitude>"';

/*
 * Alarm:
 *   { id, name, enabled, type: 'sunrise'|'on'|'off', days: [0-6] (empty = once),
 *     time: 'HH:MM', or the real sun: 'sunrise' | 'sunset' with an offset in minutes, like 'sunset-30'
 *       (type 'sunrise' is the wake-up fade; it can run at any time, including at sunrise),
 *     times: { [day]: 'HH:MM' }      // optional: days that run at another clock time than `time` (repeating clock alarms only)
 *     target: ['all' | 'group:ID' | 'device:ID'],
 *     duration, brightness, kelvin   // sunrise: full brightness is reached AT `time`
 *     action                         // on: what to turn on to
 *     fade                           // off: minutes of dimming that START at `time`
 *     updatedAt }
 *
 * Last run of each alarm, in store.data.runs[id]:
 *   { at, ranAt, running }                                   // a fade still going
 *   { at, ranAt, ok, lights, failed: [{ name, error }], error? }
 *   { at, ranAt, ok: false, missed: 'asleep' | 'server', error }  // it never ran
 *
 * notify(text, { important }): important ones also go to a Mac notification (see server.js).
 * system.onBattery(): true when the Mac is on battery, so it may sleep through an alarm (see mac.js).
 */
export class Scheduler {
  constructor({ store, devices, fades, notify, system }) {
    Object.assign(this, { store, devices, fades, notify, system });
    this.noSunLogged = new Set();
    this.startedAt = Date.now();
    this.risks = {};             // alarmId -> [{ reason, text, at }]: why its next run may not work
    this.riskSince = new Map();  // 'id|at|reason' -> when the problem was first seen
    this.riskTold = new Set();   // ...and the ones a notification already went out for
  }

  start() {
    // A fade that was still going when the server stopped never finished
    for (const r of Object.values(this.runs)) {
      if (r.running) Object.assign(r, { running: false, ok: false, failed: [], error: 'The lights server stopped while it was running' });
    }
    this.resumeTimers();
    this.tick();
    this.check();
    setInterval(() => this.tick(), 5000);
    setInterval(() => this.check(), CHECK_EVERY);
  }

  get alarms() { return this.store.data.alarms; }
  get runs() { return (this.store.data.runs ||= {}); }

  // ---------- alarms ----------

  sanitize(input, existing = {}) {
    const a = { ...existing, ...input };
    const out = {
      id: existing.id || randomUUID().slice(0, 8),
      name: String(a.name || '').slice(0, 60),
      enabled: a.enabled !== false,
      type: TYPES.includes(a.type) ? a.type : 'sunrise',
      time: parseAlarmTime(a.time),
      days: [...new Set((a.days || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort(),
      target: (Array.isArray(a.target) ? a.target : [a.target || 'all']).map(String),
      updatedAt: Date.now(),
    };
    if (!out.time) throw new UserError('Time must look like 07:30, or sunset, sunrise+15, sunset-30');
    const times = {};
    for (const d of parseSunTime(out.time) ? [] : out.days) {
      const t = a.times?.[d] ? parseTime(a.times[d]) : out.time;
      if (!t) throw new UserError(`${DAY_NAMES[d]}: time must look like 07:30`);
      if (t !== out.time) times[d] = t;
    }
    if (Object.keys(times).length) out.times = times;
    // Switching one off still works without a location
    if (parseSunTime(out.time) && out.enabled && !this.store.data.location) throw new UserError(NEED_LOCATION);
    if (!out.target.length) out.target = ['all'];
    if (out.type === 'sunrise') {
      out.duration = clamp(Math.round(+a.duration || 30), 1, 120);
      out.brightness = clamp(Math.round(+a.brightness || 100), 1, 100);
      out.kelvin = clamp(Math.round(+a.kelvin || 4000), 2000, 9000);
    } else if (out.type === 'on') {
      // Validate now, but keep favorites by reference so later edits to the favorite apply
      const raw = a.action || {};
      const norm = this.devices.normalizeAction(raw);
      out.action = {};
      if (norm.brightness) out.action.brightness = norm.brightness;
      if (raw.favorite) out.action.favorite = String(raw.favorite);
      else if (norm.scene) out.action.scene = norm.scene.name;
      else if (norm.color) out.action.color = norm.color;
      else if (norm.kelvin) out.action.kelvin = norm.kelvin;
    } else {
      out.fade = clamp(Math.round(+a.fade || 0), 0, 120);
    }
    return out;
  }

  upsert(input) {
    const i = this.alarms.findIndex((x) => x.id === input.id);
    const alarm = this.sanitize(input, i >= 0 ? this.alarms[i] : {});
    if (i >= 0) this.alarms[i] = alarm;
    else this.alarms.push(alarm);
    this.store.save();
    return alarm;
  }

  remove(id) {
    this.store.data.alarms = this.alarms.filter((a) => a.id !== id);
    delete this.store.data.fired[id];
    delete this.runs[id];
    delete this.risks[id];
    this.store.save();
  }

  lead(a) { return a.type === 'sunrise' ? a.duration * MIN : 0; }
  window(a) {
    if (a.type === 'sunrise') return a.duration * MIN + GRACE;
    if (a.type === 'off' && a.fade) return a.fade * MIN;
    return GRACE;
  }

  /**
   * The alarm time on the day `dayOffset` days from `now`, or null if it doesn't run that day. Sun times are
   * that day's real sunrise/sunset plus the offset, to the minute; a day without one (polar day or night) is skipped.
   */
  at(a, now, dayOffset, { log = false } = {}) {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    if (a.days.length && !a.days.includes(d.getDay())) return null;
    const time = a.times?.[d.getDay()] || a.time;
    const sun = parseSunTime(time);
    if (!sun) {
      const [h, m] = time.split(':').map(Number);
      d.setHours(h, m, 0, 0);
      return d;
    }
    const loc = this.store.data.location;
    if (!loc) return null;
    const times = sunTimes(d, loc.lat, loc.lon);
    const t = times[sun.event];
    if (t == null) {
      const key = `${a.id}|${d.toDateString()}`;
      if (log && !this.noSunLogged.has(key)) {
        this.noSunLogged.add(key);
        console.log(`[alarm] ${a.name || a.time}: the sun doesn't ${sun.event === 'sunrise' ? 'rise' : 'set'} on ${d.toDateString()} here (${times.polar === 'day' ? 'polar day' : 'polar night'}), skipped`);
      }
      return null;
    }
    return new Date(Math.round(t / MIN) * MIN + sun.offset * MIN);
  }

  tick(now = Date.now()) {
    for (const a of this.alarms) {
      if (!a.enabled) continue;
      let passed = null; // the latest run whose time has gone by
      for (const off of [-1, 0, 1]) {
        const at = this.at(a, now, off, { log: off === 0 });
        if (!at || at.getTime() <= (a.updatedAt || 0)) continue;
        const start = at.getTime() - this.lead(a);
        if (now >= start + this.window(a)) { passed = { at: at.getTime(), start }; continue; }
        if (now < start) continue;
        const key = at.toISOString();
        if (this.store.data.fired[a.id] === key) continue;
        this.store.data.fired[a.id] = key;
        if (!a.days.length) a.enabled = false; // one-time alarm
        this.store.save();
        try {
          this.run(a, at.getTime());
        } catch (e) {
          console.warn(`[alarm] ${a.name || a.type} ${a.time} failed: ${e.message}`);
          this.record(a, at.getTime(), { ok: false, failed: [], error: e.message });
          this.notify?.(`Alarm failed: ${e.message}`, { important: true });
        }
      }
      if (passed) this.checkMissed(a, passed.at, passed.start, now);
    }
    this.tickTimers(now);
  }

  /**
   * An alarm whose time has passed without it running: the Mac was asleep (on battery or with the lid closed),
   * or the server wasn't running yet. Only the latest run counts, only if none after the last one that fired,
   * and each is reported once.
   */
  checkMissed(a, at, start, now = Date.now()) {
    if (Date.parse(this.store.data.fired[a.id] || 0) >= at) return;
    if ((this.runs[a.id]?.at || 0) >= at) return;
    const missed = this.startedAt > start ? 'server' : 'asleep';
    const error = missed === 'server' ? "The lights server wasn't running" : 'Your Mac was asleep (on battery or with the lid closed)';
    const name = a.name || NAMES[a.type];
    console.warn(`[alarm] ${name} (${a.time}) at ${new Date(at).toLocaleString()} was missed: ${error}`);
    this.record(a, at, { ok: false, missed, error });
    this.notify?.(`Missed: ${name} ${dayWord(at, now)} at ${clock(at)}. ${error}, so the lights didn't change.`, { important: true });
  }

  record(a, at, result) {
    this.runs[a.id] = { at, ranAt: Date.now(), ...result };
    this.store.save();
    this.devices.changed?.();
  }

  /** Records how a run went, and tells the user if it didn't reach some lights */
  finish(a, at, ids, { errors = new Map(), error = null } = {}) {
    const nameOf = (id) => { const d = this.devices.get(id); return d ? this.devices.nameOf(d) : id; };
    const failed = [...errors].map(([id, err]) => ({ name: nameOf(id), error: err }));
    const ok = !error && !failed.length;
    this.record(a, at, { ok, lights: ids.length, failed, ...(error && { error }) });
    if (ok) return;
    const which = (error || failed.length === ids.length) ? 'your lights' : [...new Set(failed.map((f) => f.name))].join(', ');
    this.notify?.(`${a.name || NAMES[a.type]} ${dayWord(at)} at ${clock(at)} didn't reach ${which}: ${error || failed[0].error}`, { important: true });
  }

  run(a, at, { preview = false } = {}) {
    const ids = this.devices.resolve(a.target);
    const name = a.name || NAMES[a.type];
    console.log(`[alarm] ${name} (${a.time}) → ${ids.length} light(s)${preview ? ' [preview]' : ''}`);
    if (!ids.length) {
      if (!preview) this.finish(a, at, ids, { error: 'No lights to control' });
      return;
    }
    // A fade reports at its end, when it's known which lights it reached
    const fading = a.type === 'sunrise' || (a.type === 'off' && a.fade);
    const onEnd = preview ? undefined : (cancelled, job) => this.finish(a, at, ids, { errors: job.errors });
    if (fading && !preview) this.record(a, at, { running: true, lights: ids.length });
    if (a.type === 'sunrise') {
      const durationMs = preview ? 30_000 : a.duration * MIN;
      this.fades.start({
        ids, startAt: preview ? Date.now() : at - durationMs, durationMs,
        frame: sunrise(a.brightness, a.kelvin), label: preview ? 'Sunrise preview' : 'Sunrise', onEnd,
      });
    } else if (a.type === 'off' && a.fade) {
      const durationMs = preview ? 15_000 : a.fade * MIN;
      this.fades.start({
        ids, startAt: preview ? Date.now() : at, durationMs,
        frame: fadeOut(), end: { power: false }, label: 'Fading out', onEnd,
      });
    } else {
      const action = a.type === 'off' ? { power: false } : this.devices.normalizeAction({ ...a.action, power: true });
      this.devices.apply(ids, action)
        .then((results) => {
          if (!preview) this.finish(a, at, ids, { errors: new Map(results.filter((r) => !r.ok).map((r) => [r.id, r.error])) });
        })
        .catch((e) => {
          console.warn('[alarm]', e.message);
          if (!preview) this.finish(a, at, ids, { error: e.message });
        });
    }
    if (!preview) this.notify?.(`⏰ ${name}`);
  }

  /**
   * Looks for reasons the alarms coming up soon may not work: the Mac is on battery (so it may fall asleep), or
   * their lights don't answer. They show on the alarm right away; a notification goes out once one has lasted a while.
   */
  async check(now = Date.now()) {
    let battery = null;
    try { battery = await this.system?.onBattery?.(); } catch {}
    const risks = {}, current = new Set();
    for (const u of this.upcoming(now)) {
      if (u.start - now > WARN_AHEAD) continue;
      const a = this.alarms.find((x) => x.id === u.id);
      const list = [];
      if (battery) list.push({ reason: 'battery', text: 'Your Mac is on battery, so it may fall asleep before then. Plug it in and keep the lid open.' });
      let ids = [];
      try { ids = this.devices.resolve(a.target); } catch {}
      const down = ids.map((id) => this.devices.get(id)).filter((d) => d && !this.devices.reachable(d));
      if (!ids.length) list.push({ reason: 'nolights', text: 'It has no lights to control: its group or lights were removed. Edit the alarm to pick some.' });
      else if (down.length) {
        const names = [...new Set(down.map((d) => this.devices.nameOf(d)))].join(', ');
        list.push({
          reason: 'lights',
          text: this.devices.cloudOffline && down.every((d) => !this.devices.lanActive(d))
            ? "Your Mac can't reach Govee's cloud right now (no internet?), so the lights won't get the alarm."
            : down.length === ids.length ? "None of its lights are answering right now." : `${names} ${down.length > 1 ? "aren't" : "isn't"} answering right now.`,
        });
      }
      if (!list.length) continue;
      risks[a.id] = list.map((r) => ({ ...r, at: u.at }));
      for (const r of list) {
        const key = `${a.id}|${u.at}|${r.reason}`;
        current.add(key);
        if (!this.riskSince.has(key)) this.riskSince.set(key, now);
        if (now - this.riskSince.get(key) < WARN_AFTER || this.riskTold.has(key)) continue;
        this.riskTold.add(key);
        const when = `${dayWord(u.at, now)} at ${clock(u.at)}`;
        console.warn(`[alarm] ${a.name || NAMES[a.type]} ${when} may not run: ${r.text}`);
        this.notify?.(`${a.name || NAMES[a.type]} ${when} may not run. ${r.text}`, { important: true });
      }
    }
    // A problem that went away is timed afresh if it comes back
    for (const key of this.riskSince.keys()) if (!current.has(key)) this.riskSince.delete(key);
    for (const key of this.riskTold) if (+key.split('|')[1] < now) this.riskTold.delete(key);
    if (JSON.stringify(risks) !== JSON.stringify(this.risks)) {
      this.risks = risks;
      this.devices.changed?.();
    }
  }

  preview(input) {
    const a = this.sanitize({ ...input, enabled: true });
    this.run(a, Date.now(), { preview: true });
  }

  /** The next time each enabled alarm will start, soonest first. */
  upcoming(now = Date.now()) {
    const out = [];
    for (const a of this.alarms) {
      if (!a.enabled) continue;
      for (let off = 0; off <= 7; off++) {
        const at = this.at(a, now, off);
        if (!at) continue;
        const t = at.getTime();
        if (t <= now || t <= (a.updatedAt || 0)) continue;
        out.push({ id: a.id, at: t, start: t - this.lead(a) });
        break;
      }
    }
    return out.sort((x, y) => x.start - y.start);
  }

  // ---------- sleep timers ----------

  get timers() { return this.store.data.timers; }

  addTimer({ target = 'all', minutes = 30, fade = true }) {
    const ids = this.devices.resolve(target);
    if (!ids.length) throw new UserError('No lights to put to sleep', 404);
    const mins = clamp(+minutes || 30, 1, 600);
    const now = Date.now();
    const timer = {
      id: randomUUID().slice(0, 8), target: ids, fade: !!fade,
      label: Array.isArray(target) ? 'Selected lights' : this.labelFor(target, ids),
      startAt: now, endsAt: now + mins * MIN,
    };
    this.timers.push(timer);
    this.store.save();
    if (timer.fade) this.startTimerFade(timer);
    this.devices.changed();
    return timer;
  }

  labelFor(target, ids) {
    const s = String(target);
    if (s === 'all') return 'All lights';
    if (s.startsWith('group:')) return this.store.data.groups.find((g) => g.id === s.slice(6))?.name || 'Group';
    if (ids.length === 1) return this.devices.nameOf(this.devices.get(ids[0]));
    return s;
  }

  startTimerFade(timer) {
    this.fades.start({
      ids: timer.target, startAt: timer.startAt, durationMs: timer.endsAt - timer.startAt,
      frame: fadeOut(), end: { power: false }, label: 'Sleep timer',
      // Touching the lights mid-fade cancels the timer
      onEnd: (cancelled) => { if (cancelled) this.removeTimer(timer.id); },
    });
  }

  removeTimer(id) {
    const t = this.timers.find((x) => x.id === id);
    if (!t) return;
    this.store.data.timers = this.timers.filter((x) => x.id !== id);
    if (t.fade) this.fades.cancel(t.target);
    this.store.save();
    this.devices.changed();
  }

  resumeTimers() {
    const now = Date.now();
    for (const t of [...this.timers]) {
      if (t.endsAt <= now - GRACE) this.removeTimer(t.id);
      else if (t.fade) this.startTimerFade(t);
    }
  }

  tickTimers(now) {
    for (const t of [...this.timers]) {
      if (now < t.endsAt) continue;
      this.store.data.timers = this.timers.filter((x) => x.id !== t.id);
      this.store.save();
      // Fading timers turn off at the end of their fade; plain ones turn off here
      if (!t.fade) this.devices.apply(t.target, { power: false }, { manual: false }).catch(() => {});
      this.devices.changed();
    }
  }
}
