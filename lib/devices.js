import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  clamp, sleep, hexToRgb, hexToInt, intToHex, kelvinToRgb, kelvinToHex, scaleHex, parseColor, parseKelvin,
} from './util.js';

const CLOUD_SPACING = 450;           // Govee allows ~2 control requests/second per device
const LAN_SCAN_EVERY = 60_000;
const LAN_STATUS_EVERY = 10_000;
const LAN_STALE = 3 * 60_000;        // no LAN reply for this long → fall back to cloud
const CLOUD_POLL_EVERY = 5 * 60_000; // only for devices without LAN, to save the 10k/day quota
const CLOUD_MIN_REFRESH = 30_000;
const SCENES_TTL = 6 * 3600_000;
const SEEN_GRANULARITY = 3600_000;   // "last seen" is saved at most hourly, to avoid rewriting the file on every poll
const MY_SCENES_MAX = 24;

const T = {
  online: 'devices.capabilities.online',
  onOff: 'devices.capabilities.on_off',
  range: 'devices.capabilities.range',
  color: 'devices.capabilities.color_setting',
  scene: 'devices.capabilities.dynamic_scene',
  music: 'devices.capabilities.music_setting',
  segment: 'devices.capabilities.segment_color_setting',
  toggle: 'devices.capabilities.toggle',
  mode: 'devices.capabilities.mode',
};

export const SCENE_KINDS = ['lightScene', 'diyScene', 'snapshot'];

export class UserError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

export class Devices extends EventEmitter {
  constructor({ store, cloud, lan }) {
    super();
    this.store = store;
    this.cloud = cloud;
    this.lan = lan;
    this.map = new Map();
    this.queues = new Map();
    this.cloudError = null;
    this.fades = null; // attached by Fades
    this.lastRefresh = 0;
  }

  get(id) { return this.map.get(id); }
  list() { return [...this.map.values()]; }
  get hasKey() { return !!this.store.data.apiKey; }

  ensure(id) {
    let d = this.map.get(id);
    if (!d) {
      d = {
        id, sku: '', cloudName: '', caps: [], inCloud: false, lan: null,
        state: { online: null, power: null, brightness: null, color: null, kelvin: null, scene: null, dim: null },
        dim: null, // { factor, look } while dimmer than 1%, see withDim
        stateAt: 0, scenes: null, scenesAt: 0,
      };
      this.map.set(id, d);
    }
    return d;
  }

  changed() {
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => this.emit('change'), 120);
  }

  async start() {
    this.restoreKnown();
    this.lan.on('device', ({ id, ip, sku }) => {
      const d = this.ensure(id);
      const fresh = !d.lan || d.lan.ip !== ip || !d.lan.lastSeen;
      d.sku ||= sku;
      d.lan = { ip, lastSeen: Date.now() };
      this.remember(d, true);
      if (fresh) { this.lan.status(ip); this.changed(); }
    });
    this.lan.on('status', (id, s) => {
      const d = this.map.get(id);
      if (!d) return;
      if (d.lan) d.lan.lastSeen = Date.now();
      this.remember(d, true);
      // Scenes aren't reported over LAN, so keep the one we last set until the light goes off
      Object.assign(d.state, s, { online: true, scene: s.power ? d.state.scene : null });
      if (d.dim && s.brightness > 1) this.undim(d); // turned up some other way (Govee app, button)
      d.stateAt = Date.now();
      this.changed();
    });
    await this.lan.start();
    await this.refresh({ full: true });
    setInterval(() => this.lan.scan(), LAN_SCAN_EVERY);
    setInterval(() => this.pollLan(), LAN_STATUS_EVERY);
    setInterval(() => this.pollCloud(false), CLOUD_POLL_EVERY);
    // While Govee's cloud is unreachable (no internet), keep trying so lights come back by themselves
    setInterval(() => { if (this.cloudOffline) this.refresh({ full: true }); }, 60_000);
  }

  /** full: re-list devices from the cloud + LAN scan. Otherwise just refresh states. */
  async refresh({ full = false } = {}) {
    if (full && Date.now() - this.lastRefresh > 15_000) {
      this.lastRefresh = Date.now();
      this.lan.scan();
      await this.loadCloud();
      await sleep(700); // let LAN scan replies arrive
    }
    this.pollLan();
    await this.pollCloud(true);
    this.changed();
  }

  async loadCloud() {
    if (!this.hasKey) { this.cloudError = null; return; }
    try {
      const list = await this.cloud.devices();
      const listed = new Set();
      for (const item of list) {
        const caps = item.capabilities || [];
        const isLight = String(item.type || '').includes('light') ||
          caps.some((c) => c.instance === 'colorRgb' || c.instance === 'brightness');
        const id = String(item.device).toUpperCase();
        if (!isLight || !/^[0-9A-F:]{8,40}$/.test(id)) continue;
        const d = this.ensure(id);
        d.sku = item.sku;
        d.cloudName = item.deviceName || '';
        d.caps = caps;
        d.inCloud = true;
        listed.add(id);
        this.remember(d, true);
      }
      // Removed from the Govee account: keep it only as a LAN light (or as offline until forgotten)
      for (const d of this.map.values()) {
        if (d.inCloud && !listed.has(d.id)) { d.inCloud = false; this.remember(d); }
      }
      this.cloudError = null;
      this.cloudOffline = false;
    } catch (e) {
      this.cloudError = e.message;
      this.cloudOffline = !e.status;
    }
  }

  lanActive(d) { return !!(d.lan && this.lan.ready && Date.now() - d.lan.lastSeen < LAN_STALE); }

  pollLan() {
    for (const d of this.map.values()) {
      if (!d.lan) continue;
      if (!this.lanActive(d) && !d.inCloud) d.state.online = false;
      this.lan.status(d.lan.ip);
    }
  }

  async pollCloud(onDemand) {
    if (!this.hasKey) return;
    const due = this.list().filter((d) => d.inCloud && !this.lanActive(d) &&
      Date.now() - d.stateAt > (onDemand ? CLOUD_MIN_REFRESH : CLOUD_POLL_EVERY / 2));
    await Promise.all(due.map(async (d) => {
      try {
        const caps = await this.cloudQ(d, 'state', () => this.cloud.state(d.sku, d.id));
        this.applyCloudState(d, caps);
      } catch (e) {
        if (e.status === 401) this.cloudError = e.message;
        if (!e.status) d.state.online = false; // no answer at all: no internet, or Govee is down
      }
    }));
    this.changed();
  }

  applyCloudState(d, caps) {
    const s = d.state;
    for (const c of caps) {
      const v = c.state?.value;
      if (c.instance === 'online') s.online = v === true || v === 'true' || v === 1;
      else if (c.instance === 'powerSwitch') s.power = v === 1;
      else if (c.instance === 'brightness' && Number.isFinite(+v) && v !== '' && v != null) s.brightness = Math.round(+v);
    }
    if (d.dim && s.brightness > 1) this.undim(d);
    // Govee keeps reporting the last plain color while a scene plays, so only a *change* in what it
    // reports means the color was set (here or in the Govee app), and any scene stopped
    const val = (inst) => caps.find((c) => c.instance === inst)?.state?.value;
    const k = +val('colorTemperatureK') || 0, rgb = val('colorRgb');
    const seen = `${k}|${rgb ?? ''}`;
    if (seen !== d.cloudColor) {
      if (k > 0) Object.assign(s, { kelvin: k, color: null });
      else if (rgb !== '' && rgb != null) Object.assign(s, { color: intToHex(+rgb), kelvin: null });
      if (d.cloudColor !== undefined) s.scene = null;
      d.cloudColor = seen;
    }
    d.stateAt = Date.now();
  }

  // ---------- remembering lights across restarts ----------

  /** Lights seen before show up right away, before Govee's cloud or the Wi-Fi scan answers */
  restoreKnown() {
    for (const [id, k] of Object.entries(this.store.data.known)) {
      if (!/^[0-9A-F:]{8,40}$/.test(id) || !k) continue;
      const d = this.ensure(id);
      d.sku = String(k.sku || '');
      d.cloudName = String(k.cloudName || '');
      d.caps = Array.isArray(k.caps) ? k.caps : [];
      d.inCloud = !!k.inCloud;
      if (k.ip) {
        // Ask it at its last address straight away; until it answers it isn't used over LAN
        d.lan = { ip: k.ip, lastSeen: 0 };
        this.lan.byIp.set(k.ip, id);
      }
    }
  }

  remember(d, seen = false) {
    const known = this.store.data.known;
    const prev = known[d.id] || {};
    const seenAt = seen && Date.now() - (prev.seenAt || 0) > SEEN_GRANULARITY ? Date.now() : prev.seenAt || null;
    const next = { sku: d.sku, cloudName: d.cloudName, caps: d.caps, inCloud: d.inCloud, ip: d.lan?.ip || prev.ip || null, seenAt };
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    known[d.id] = next;
    this.store.save();
  }

  /** Drops a light that's gone for good, along with its name and group memberships */
  forget(id) {
    const data = this.store.data;
    const d = this.map.get(id);
    if (d?.lan) this.lan.byIp.delete(d.lan.ip);
    this.map.delete(id);
    delete data.known[id];
    delete data.names[id];
    data.hidden = data.hidden.filter((x) => x !== id);
    for (const g of data.groups) g.devices = g.devices.filter((x) => x !== id);
    this.fades?.cancel([id]);
    this.store.save();
    this.changed();
  }

  // ---------- naming & targets ----------

  nameOf(d) {
    return this.store.data.names[d.id] || d.cloudName || `${d.sku || 'Govee'} ${d.id.replace(/:/g, '').slice(-4)}`;
  }

  visibleIds() {
    const hidden = this.store.data.hidden;
    return this.list().filter((d) => !hidden.includes(d.id)).map((d) => d.id);
  }

  /** target: 'all' | 'group:ID' | 'device:ID' | a device/group name | an array of those */
  resolve(target) {
    const refs = Array.isArray(target) ? target : [target ?? 'all'];
    const out = new Set();
    for (const ref of refs) for (const id of this.resolveOne(ref)) out.add(id);
    return [...out];
  }

  resolveOne(ref) {
    const s = String(ref ?? '').trim();
    const { groups } = this.store.data;
    if (!s || ['all', 'everything', 'everywhere'].includes(s.toLowerCase())) return this.visibleIds();
    if (s.startsWith('device:')) return this.map.has(s.slice(7)) ? [s.slice(7)] : [];
    if (s.startsWith('group:')) {
      const g = groups.find((x) => x.id === s.slice(6));
      return g ? g.devices.filter((id) => this.map.has(id)) : [];
    }
    if (this.map.has(s.toUpperCase())) return [s.toUpperCase()];
    const q = s.toLowerCase();
    const candidates = [
      ...groups.map((g) => ({ name: g.name, ids: g.devices.filter((id) => this.map.has(id)) })),
      ...this.list().map((d) => ({ name: this.nameOf(d), ids: [d.id] })),
    ];
    const norm = (n) => n.toLowerCase();
    for (const test of [(n) => n === q, (n) => n.startsWith(q), (n) => n.includes(q)]) {
      const hits = candidates.filter((c) => test(norm(c.name)));
      if (hits.length === 1) return hits[0].ids;
      if (hits.length > 1) throw new UserError(`"${s}" matches several: ${hits.map((h) => h.name).join(', ')}`);
    }
    throw new UserError(`No light or group called "${s}"`, 404);
  }

  // ---------- capabilities ----------

  findCap(d, type, instance) { return d.caps.find((c) => c.type === type && (!instance || c.instance === instance)); }

  capsOf(d) {
    if (!d.caps.length) {
      // LAN-only device (no API key): the LAN API covers exactly these
      return {
        power: true, brightness: { min: 1, max: 100 }, color: true, kelvin: { min: 2000, max: 9000 },
        scenes: false, diy: false, snapshots: false, music: null, segments: null, toggles: [], modes: [],
      };
    }
    const f = (t, i) => this.findCap(d, t, i);
    const range = (c, lo, hi) => ({ min: c.parameters?.range?.min ?? lo, max: c.parameters?.range?.max ?? hi });
    const br = f(T.range, 'brightness');
    const kel = f(T.color, 'colorTemperatureK');
    const music = f(T.music, 'musicMode');
    const seg = f(T.segment, 'segmentedColorRgb');
    const field = (c, name) => c?.parameters?.fields?.find((x) => x.fieldName === name);
    return {
      power: !!f(T.onOff, 'powerSwitch'),
      brightness: br ? range(br, 1, 100) : null,
      color: !!f(T.color, 'colorRgb'),
      kelvin: kel ? range(kel, 2000, 9000) : null,
      scenes: !!f(T.scene, 'lightScene'),
      diy: !!f(T.scene, 'diyScene'),
      snapshots: !!f(T.scene, 'snapshot'),
      music: music ? {
        modes: (field(music, 'musicMode')?.options || []).map((o) => ({ name: o.name, value: o.value })),
        sensitivity: !!field(music, 'sensitivity'),
        autoColor: !!field(music, 'autoColor'),
        rgb: !!field(music, 'rgb'),
      } : null,
      segments: seg ? {
        count: field(seg, 'segment')?.options?.length || 0,
        brightness: !!f(T.segment, 'segmentedBrightness'),
      } : null,
      toggles: d.caps.filter((c) => c.type === T.toggle)
        .map((c) => ({ instance: c.instance, name: pretty(c.instance.replace(/Toggle$/, '')) })),
      modes: d.caps.filter((c) => c.type === T.mode)
        .map((c) => ({ instance: c.instance, name: pretty(c.instance), options: c.parameters?.options || [] })),
    };
  }

  view(d) {
    const lan = this.lanActive(d);
    return {
      id: d.id,
      sku: d.sku,
      name: this.nameOf(d),
      customName: this.store.data.names[d.id] || '',
      hidden: this.store.data.hidden.includes(d.id),
      via: lan ? (d.inCloud && this.hasKey ? 'lan+cloud' : 'lan') : d.inCloud && this.hasKey ? 'cloud' : 'unreachable',
      seenAt: this.store.data.known[d.id]?.seenAt || null,
      ip: d.lan?.ip || null,
      // While dimmer than 1%, the light shows a darkened color; report the real one, and how dim it is
      state: { ...d.state, online: lan ? true : d.state.online, ...(d.dim && { color: d.dim.look.color ?? null, kelvin: d.dim.look.kelvin ?? null }) },
      caps: this.capsOf(d),
      fading: this.fades?.labelFor(d.id) || null,
    };
  }

  // ---------- scenes ----------

  async scenesOf(d, force = false) {
    const empty = { lightScene: [], diyScene: [], snapshot: [] };
    if (!d.inCloud || !this.hasKey) return empty;
    if (d.scenes && !force && Date.now() - d.scenesAt < SCENES_TTL) return d.scenes;
    const out = structuredClone(empty);
    const absorb = (caps) => {
      for (const c of caps || []) {
        if (c.type !== T.scene || !out[c.instance]) continue;
        for (const o of c.parameters?.options || []) {
          if (o?.name && !out[c.instance].some((x) => x.name === o.name)) out[c.instance].push({ name: o.name, value: o.value });
        }
      }
    };
    absorb(d.caps);
    let failed = false;
    if (this.findCap(d, T.scene)) {
      absorb(await this.cloudQ(d, 'scenes', () => this.cloud.scenes(d.sku, d.id)).catch(() => { failed = true; }));
    }
    if (this.findCap(d, T.scene, 'diyScene')) {
      absorb(await this.cloudQ(d, 'diy', () => this.cloud.diyScenes(d.sku, d.id)).catch(() => { failed = true; }));
    }
    d.scenes = out;
    d.scenesAt = failed ? Date.now() - SCENES_TTL + 60_000 : Date.now(); // retry soon if something failed
    return out;
  }

  // ---------- control ----------

  /** Validates and expands an action coming from the UI, CLI or an alarm. */
  findFavorite(q) {
    const favs = this.store.data.favorites;
    const s = String(q).toLowerCase();
    return favs.find((f) => f.id === q) || favs.find((f) => f.name.toLowerCase() === s) ||
      favs.find((f) => f.name.toLowerCase().startsWith(s));
  }

  normalizeAction(raw = {}, depth = 0) {
    const a = {};
    const findFav = (q) => this.findFavorite(q);
    const expand = (f) => {
      if (f.lights) a.each = Object.fromEntries(Object.entries(f.lights).map(([id, look]) => [id, this.normalizeAction(look, 1)]));
      else Object.assign(a, this.normalizeAction(f.action, 1));
    };
    if (raw.favorite != null && depth === 0) {
      const f = findFav(raw.favorite);
      if (!f) throw new UserError(`No favorite called "${raw.favorite}"`, 404);
      expand(f);
    }
    if (raw.preset != null && depth === 0) {
      // From the CLI: a favorite if one matches, otherwise a Govee scene
      const f = findFav(raw.preset);
      if (f) expand(f);
      else a.scene = { name: String(raw.preset) };
    }
    if (raw.power != null) a.power = raw.power === 'toggle' ? 'toggle' : !!raw.power;
    if (raw.brightness != null && raw.brightness !== '') {
      const n = Number(raw.brightness);
      if (!Number.isFinite(n)) throw new UserError(`Brightness must be a number 0-100`);
      if (n <= 0) a.power = false;
      else if (n < 1) Object.assign(a, { brightness: 1, dim: dimLevel(n) }); // dimmer than 1%, see withDim
      else a.brightness = clamp(Math.round(n), 1, 100);
    }
    // A saved look that's dimmer than 1%: { brightness: 1, dim: 0.25 }
    if (+raw.dim > 0 && +raw.dim < 1 && a.power !== false && !(a.brightness > 1)) Object.assign(a, { brightness: 1, dim: dimLevel(+raw.dim) });
    if (raw.color) {
      const c = parseColor(raw.color);
      if (!c) throw new UserError(`Unknown color "${raw.color}"`);
      a.color = c;
    }
    if (raw.kelvin) {
      const k = parseKelvin(raw.kelvin);
      if (!k) throw new UserError(`Unknown white temperature "${raw.kelvin}" (use 2000-9000 or warm/neutral/cool)`);
      a.kelvin = k;
      delete a.color;
    }
    if (raw.scene) {
      a.scene = typeof raw.scene === 'string' ? { name: raw.scene }
        : { name: String(raw.scene.name || ''), instance: raw.scene.instance, value: raw.scene.value, sku: raw.scene.sku };
    }
    if (raw.music != null) {
      a.music = typeof raw.music === 'string' ? { name: raw.music } : {
        name: raw.music.name, value: raw.music.value,
        sensitivity: raw.music.sensitivity != null ? clamp(+raw.music.sensitivity, 0, 100) : undefined,
        color: raw.music.color ? parseColor(raw.music.color) : undefined,
      };
    }
    if (raw.segments) {
      const s = raw.segments;
      a.segments = {
        segments: Array.isArray(s.segments) && s.segments.length ? s.segments.map(Number).filter(Number.isInteger) : 'all',
        color: s.color ? parseColor(s.color) : undefined,
        brightness: s.brightness != null ? clamp(+s.brightness, 0, 100) : undefined,
      };
    }
    if (raw.toggle?.instance) a.toggle = { instance: String(raw.toggle.instance), on: !!raw.toggle.on };
    if (raw.mode?.instance) a.mode = { instance: String(raw.mode.instance), value: raw.mode.value };
    return a;
  }

  /**
   * manual: a person did this, so stop any running fade/sunrise on those lights.
   * saveScene: keep the scene in "My scenes" once it's on (or a function that gets (scene, device)).
   * action.each: { deviceId: action } from a favorite saved with "what's on now". Each light gets its own
   * look (anything else in the action, like an alarm's brightness, goes on top); lights it doesn't name are left alone.
   */
  async apply(ids, action, { manual = true, saveScene = false } = {}) {
    let devs = ids.map((id) => this.map.get(id)).filter(Boolean);
    const { each, ...rest } = action;
    if (each) devs = devs.filter((d) => each[d.id]);
    if (!devs.length) throw new UserError(each ? 'That favorite has none of these lights' : 'No lights to control', 404);
    if (manual) this.fades?.cancel(devs.map((d) => d.id));
    if (rest.power === 'toggle') rest.power = !devs.some((d) => d.state.power);
    const results = await Promise.all(devs.map((d) => this.applyOne(d, each ? { ...each[d.id], ...rest } : rest, { recheck: true })
      .then((scene) => {
        if (scene && typeof saveScene === 'function') saveScene(scene, d);
        else if (scene && saveScene) this.saveScene(scene, d.sku);
      })
      .then(() => ({ id: d.id, name: this.nameOf(d), ok: true }))
      .catch((e) => ({ id: d.id, name: this.nameOf(d), ok: false, error: e.message }))));
    this.changed();
    return results;
  }

  /**
   * Each light's look right now, as an action that brings it back. Asks Govee first, because the
   * look may have been set in the Govee app since the last poll.
   */
  async capture(ids) {
    const devs = ids.map((id) => this.map.get(id)).filter(Boolean);
    await Promise.all(devs.filter((d) => d.inCloud && !this.lanActive(d)).map((d) =>
      this.cloudQ(d, 'state', () => this.cloud.state(d.sku, d.id)).then((caps) => this.applyCloudState(d, caps)).catch(() => {})));
    this.changed();
    const looks = {};
    for (const d of devs) {
      const s = d.state;
      if (s.power === false) { looks[d.id] = { power: false }; continue; }
      if (d.dim) { looks[d.id] = { brightness: d.dim.factor, ...d.dim.look }; continue; }
      const look = { brightness: s.brightness ?? 100 };
      if (s.scene && !s.scene.startsWith('Music') && s.scene !== 'Segments') look.scene = { name: s.scene };
      else if (s.kelvin) look.kelvin = s.kelvin;
      else if (s.color) look.color = s.color;
      looks[d.id] = look;
    }
    return looks;
  }

  /**
   * Returns the scene it turned on, if any.
   * recheck: a cloud light may have been switched off in the Govee app since we last asked, so send "on"
   * even if we think it's on (unless we turned it on ourselves just now). Fades leave this off, so they
   * never switch back on a light someone turned off.
   */
  async applyOne(d, a, { recheck = false } = {}) {
    const ip = this.lanActive(d) ? d.lan.ip : null;
    if (!ip && !d.inCloud) {
      if (d.lan) throw new Error('Not answering on LAN (is it powered and on Wi-Fi?)');
      throw new Error('Not reachable');
    }
    if (a.power === false) {
      await this.setPower(d, false, ip);
      return;
    }
    a = this.withDim(d, a);
    const lights = a.power === true || a.brightness != null || a.color || a.kelvin || a.scene || a.music || a.segments;
    const unsure = recheck && !ip && Date.now() - (d.poweredAt || 0) > 10_000;
    if (lights && (d.state.power !== true || unsure)) await this.setPower(d, true, ip);
    const scene = a.scene ? await this.setScene(d, a.scene) : null;
    if (a.music) await this.setMusic(d, a.music);
    if (a.color) await this.setColor(d, a.color, ip);
    else if (a.kelvin) await this.setKelvin(d, a.kelvin, ip);
    if (a.segments) await this.setSegments(d, a.segments);
    if (a.brightness != null) await this.setBrightness(d, a.brightness, ip);
    if (a.toggle) await this.control(d, T.toggle, a.toggle.instance, a.toggle.on ? 1 : 0);
    if (a.mode) await this.control(d, T.mode, a.mode.instance, a.mode.value);
    if (ip) setTimeout(() => this.lan.status(ip), 600);
    return scene;
  }

  /**
   * Dimmer than 1%. Govee's lowest brightness is 1%, so this goes to 1% with a darker version of the look:
   * a.dim of its color's strength (0.25 → about 0.25%). The real look is remembered and comes back with the
   * next brightness of 1% or more. How well it works depends on the model: some may show dark colors brighter.
   */
  withDim(d, a) {
    const newLook = a.color || a.kelvin || a.scene || a.music || a.segments;
    if (a.dim) {
      if (!this.capsOf(d).color) throw new Error("Can't go below 1%: this light has no color LEDs");
      const look = a.color ? { color: a.color } : a.kelvin ? { kelvin: a.kelvin } : d.dim?.look || lookOf(d.state);
      d.dim = { factor: a.dim, look };
      d.state.dim = a.dim;
      const { kelvin, dim, ...rest } = a;
      return { ...rest, brightness: 1, color: scaleHex(look.color || kelvinToHex(look.kelvin), a.dim) };
    }
    const was = d.dim;
    if (!was || !(newLook || a.brightness != null)) return a;
    this.undim(d);
    // Back to 1% or more without a new look: the real color comes back
    return newLook ? a : { ...was.look, ...a };
  }

  undim(d) {
    d.dim = null;
    d.state.dim = null;
  }

  async setPower(d, on, ip) {
    if (ip) await this.lan.turn(ip, on);
    else await this.control(d, T.onOff, 'powerSwitch', on ? 1 : 0, 'power');
    d.state.power = on;
    d.poweredAt = on ? Date.now() : 0;
  }

  async setBrightness(d, value, ip) {
    const r = this.capsOf(d).brightness || { min: 1, max: 100 };
    const v = clamp(Math.round(value), Math.max(1, r.min), r.max);
    if (ip) await this.lan.brightness(ip, v);
    else await this.control(d, T.range, 'brightness', v);
    d.state.brightness = v;
  }

  async setColor(d, hex, ip) {
    if (ip) await this.lan.color(ip, hexToRgb(hex), 0);
    else await this.control(d, T.color, 'colorRgb', hexToInt(hex), 'color');
    Object.assign(d.state, { color: hex, kelvin: null, scene: null });
  }

  async setKelvin(d, k, ip) {
    const r = this.capsOf(d).kelvin || { min: 2000, max: 9000 };
    const v = clamp(k, r.min, r.max);
    if (ip) await this.lan.color(ip, kelvinToRgb(v), v);
    else await this.control(d, T.color, 'colorTemperatureK', v, 'color');
    Object.assign(d.state, { kelvin: v, color: null, scene: null });
  }

  async setScene(d, scene) {
    this.needCloud(d, 'Scenes');
    const all = await this.scenesOf(d);
    const kinds = scene.instance && all[scene.instance] ? [scene.instance] : SCENE_KINDS;
    const q = scene.name.toLowerCase();
    let hit = null;
    for (const test of [(n) => n === q, (n) => n.startsWith(q), (n) => n.includes(q)]) {
      for (const kind of kinds) {
        const o = all[kind].find((x) => test(x.name.toLowerCase()));
        if (o) { hit = { kind, ...o }; break; }
      }
      if (hit) break;
    }
    if (!hit && scene.value != null && scene.sku === d.sku) hit = { kind: scene.instance, name: scene.name, value: scene.value };
    if (!hit) throw new Error(`Scene "${scene.name}" isn't available on this light`);
    await this.control(d, T.scene, hit.kind, hit.value, 'color');
    Object.assign(d.state, { scene: hit.name, color: null, kelvin: null });
    return hit;
  }

  /** New scenes go to the front; using one again only updates usedAt, so the list doesn't jump around. */
  saveScene({ kind, name }, sku) {
    const list = this.store.data.myScenes;
    let s = list.find((x) => x.kind === kind && x.name === name);
    if (!s) list.unshift((s = { id: randomUUID().slice(0, 8), kind, name, skus: [] }));
    if (!s.skus.includes(sku)) s.skus.push(sku);
    s.usedAt = Date.now();
    const info = this.library?.peek(sku, name);
    if (info?.pic) Object.assign(s, { pic: info.pic, picDark: info.picDark });
    while (list.length > MY_SCENES_MAX) {
      const oldest = list.reduce((a, b) => (b.usedAt < a.usedAt ? b : a));
      list.splice(list.indexOf(oldest), 1);
    }
    this.store.save();
  }

  async setMusic(d, m) {
    this.needCloud(d, 'Music mode');
    const caps = this.capsOf(d).music;
    if (!caps?.modes.length) throw new Error('No music mode on this light');
    const q = String(m.name ?? '').toLowerCase();
    const mode = caps.modes.find((o) => o.value === m.value) || caps.modes.find((o) => o.name.toLowerCase() === q) ||
      caps.modes.find((o) => o.name.toLowerCase().includes(q)) || (q ? null : caps.modes[0]);
    if (!mode) throw new Error(`Music mode "${m.name}" not found (${caps.modes.map((o) => o.name).join(', ')})`);
    const value = { musicMode: mode.value };
    if (caps.sensitivity) value.sensitivity = m.sensitivity ?? 100;
    if (caps.autoColor) value.autoColor = m.color ? 0 : 1;
    if (caps.rgb && m.color) value.rgb = hexToInt(m.color);
    await this.control(d, T.music, 'musicMode', value, 'color');
    Object.assign(d.state, { scene: `Music: ${mode.name}`, color: null, kelvin: null });
  }

  async setSegments(d, s) {
    this.needCloud(d, 'Segments');
    const caps = this.capsOf(d).segments;
    if (!caps?.count) throw new Error('This light has no segments');
    const segment = s.segments === 'all' ? [...Array(caps.count).keys()] : s.segments.filter((i) => i >= 0 && i < caps.count);
    const key = `seg:${segment.join(',')}`;
    if (s.color) await this.control(d, T.segment, 'segmentedColorRgb', { segment, rgb: hexToInt(s.color) }, key + ':c');
    if (s.brightness != null && caps.brightness) {
      await this.control(d, T.segment, 'segmentedBrightness', { segment, brightness: s.brightness }, key + ':b');
    }
    d.state.scene = 'Segments';
  }

  needCloud(d, what) {
    if (!this.hasKey) throw new Error(`${what} need a Govee API key (Settings)`);
    if (!d.inCloud) throw new Error(`${what} need this light in your Govee account`);
  }

  control(d, type, instance, value, key = instance) {
    this.needCloud(d, 'This');
    return this.cloudQ(d, key, () => this.cloud.control(d.sku, d.id, { type, instance, value }));
  }

  /**
   * Per-device cloud queue that respects Govee's per-device rate limit. Requests with the same key
   * are coalesced (only the newest one is sent), so dragging a slider doesn't build up a backlog.
   */
  cloudQ(d, key, fn) {
    let q = this.queues.get(d.id);
    if (!q) { q = { jobs: new Map(), running: false, last: 0 }; this.queues.set(d.id, q); }
    return new Promise((resolve, reject) => {
      const job = q.jobs.get(key);
      if (job) { job.fn = fn; job.waiters.push({ resolve, reject }); }
      else q.jobs.set(key, { fn, waiters: [{ resolve, reject }] });
      if (!q.running) this.runQueue(q);
    });
  }

  async runQueue(q) {
    q.running = true;
    while (q.jobs.size) {
      const [key, job] = q.jobs.entries().next().value;
      q.jobs.delete(key);
      const wait = q.last + CLOUD_SPACING - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        const r = await job.fn();
        job.waiters.forEach((w) => w.resolve(r));
      } catch (e) {
        job.waiters.forEach((w) => w.reject(e));
      }
      q.last = Date.now();
    }
    q.running = false;
  }
}

const dimLevel = (n) => clamp(Math.round(n * 100) / 100, 0.01, 0.99);
/** A light's color or white as a look; warm white if it shows neither */
const lookOf = (s) => (s.kelvin ? { kelvin: s.kelvin } : s.color && s.color !== '#000000' ? { color: s.color } : { kelvin: 2700 });

const pretty = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
