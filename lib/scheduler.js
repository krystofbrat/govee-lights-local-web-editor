import { randomUUID } from 'node:crypto';
import { clamp, parseTime } from './util.js';
import { sunrise, fadeOut } from './fades.js';
import { UserError } from './devices.js';

const MIN = 60_000;
const GRACE = 5 * MIN; // fire alarms that were missed by up to this much (e.g. the Mac just woke up)
const TYPES = ['sunrise', 'on', 'off'];

/*
 * Alarm:
 *   { id, name, enabled, type: 'sunrise'|'on'|'off', time: 'HH:MM', days: [0-6] (empty = once),
 *     target: ['all' | 'group:ID' | 'device:ID'],
 *     duration, brightness, kelvin   // sunrise: full brightness is reached AT `time`
 *     action                         // on: what to turn on to
 *     fade                           // off: minutes of dimming that START at `time`
 *     updatedAt }
 */
export class Scheduler {
  constructor({ store, devices, fades, notify }) {
    Object.assign(this, { store, devices, fades, notify });
  }

  start() {
    this.resumeTimers();
    this.tick();
    setInterval(() => this.tick(), 5000);
  }

  get alarms() { return this.store.data.alarms; }

  // ---------- alarms ----------

  sanitize(input, existing = {}) {
    const a = { ...existing, ...input };
    const out = {
      id: existing.id || randomUUID().slice(0, 8),
      name: String(a.name || '').slice(0, 60),
      enabled: a.enabled !== false,
      type: TYPES.includes(a.type) ? a.type : 'sunrise',
      time: parseTime(a.time),
      days: [...new Set((a.days || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort(),
      target: (Array.isArray(a.target) ? a.target : [a.target || 'all']).map(String),
      updatedAt: Date.now(),
    };
    if (!out.time) throw new UserError('Time must look like 07:30');
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
    this.store.save();
  }

  lead(a) { return a.type === 'sunrise' ? a.duration * MIN : 0; }
  window(a) {
    if (a.type === 'sunrise') return a.duration * MIN + GRACE;
    if (a.type === 'off' && a.fade) return a.fade * MIN;
    return GRACE;
  }

  /** The alarm time on the day `dayOffset` days from `now`, or null if it doesn't run that day. */
  at(a, now, dayOffset) {
    const [h, m] = a.time.split(':').map(Number);
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    if (a.days.length && !a.days.includes(d.getDay())) return null;
    return d;
  }

  tick() {
    const now = Date.now();
    for (const a of this.alarms) {
      if (!a.enabled) continue;
      for (const off of [-1, 0, 1]) {
        const at = this.at(a, now, off);
        if (!at || at.getTime() <= (a.updatedAt || 0)) continue;
        const start = at.getTime() - this.lead(a);
        if (now < start || now >= start + this.window(a)) continue;
        const key = at.toISOString();
        if (this.store.data.fired[a.id] === key) continue;
        this.store.data.fired[a.id] = key;
        if (!a.days.length) a.enabled = false; // one-time alarm
        this.store.save();
        try {
          this.run(a, at.getTime());
        } catch (e) {
          console.warn(`[alarm] ${a.name || a.type} ${a.time} failed: ${e.message}`);
          this.notify?.(`Alarm failed: ${e.message}`);
        }
      }
    }
    this.tickTimers(now);
  }

  run(a, at, { preview = false } = {}) {
    const ids = this.devices.resolve(a.target);
    const name = a.name || { sunrise: 'Sunrise', on: 'Lights on', off: 'Lights off' }[a.type];
    console.log(`[alarm] ${name} (${a.time}) → ${ids.length} light(s)${preview ? ' [preview]' : ''}`);
    if (!ids.length) return;
    if (a.type === 'sunrise') {
      const durationMs = preview ? 30_000 : a.duration * MIN;
      this.fades.start({
        ids, startAt: preview ? Date.now() : at - durationMs, durationMs,
        frame: sunrise(a.brightness, a.kelvin), label: preview ? 'Sunrise preview' : 'Sunrise',
      });
    } else if (a.type === 'off' && a.fade) {
      const durationMs = preview ? 15_000 : a.fade * MIN;
      this.fades.start({
        ids, startAt: preview ? Date.now() : at, durationMs,
        frame: fadeOut(), end: { power: false }, label: 'Fading out',
      });
    } else {
      const action = a.type === 'off' ? { power: false } : this.devices.normalizeAction({ ...a.action, power: true });
      this.devices.apply(ids, action).catch((e) => console.warn('[alarm]', e.message));
    }
    if (!preview) this.notify?.(`⏰ ${name}`);
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
