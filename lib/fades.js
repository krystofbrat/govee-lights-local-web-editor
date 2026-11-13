import { clamp, sunriseFrame } from './util.js';

const TICK = 2000;          // LAN lights get a new step every tick
const CLOUD_STEP = 20_000;  // cloud lights only every 20s, to save API quota...
const CLOUD_MIN_STEPS = 15; // ...but short fades (a 30s preview) still get this many, so they look gradual

/**
 * Gradual transitions (sunrise, fade-out). Each job drives a set of lights from a frame function
 * frame(t, startState, caps) -> { brightness, color | kelvin } | null, for t going 0 → 1.
 * Any manual command to a light removes it from its job, and so does switching it off some other way.
 */
export class Fades {
  constructor(devices) {
    this.devices = devices;
    this.jobs = new Set();
    devices.fades = this;
    setInterval(() => this.tick(), TICK);
  }

  labelFor(id) {
    for (const j of this.jobs) if (j.ids.has(id)) return j.label;
    return null;
  }

  /** onEnd(cancelled, job) is called when a job finishes; job.errors has the last error of each light whose last try failed */
  cancel(ids) {
    for (const j of [...this.jobs]) {
      for (const id of ids) j.ids.delete(id);
      if (!j.ids.size) { this.jobs.delete(j); j.onEnd?.(true, j); }
    }
  }

  start({ ids, startAt = Date.now(), durationMs, frame, end = null, label, onEnd }) {
    if (!ids.length) return null;
    this.cancel(ids);
    const job = {
      ids: new Set(ids), startAt, durationMs: Math.max(1000, durationMs), frame, end, label, onEnd,
      init: new Map(ids.map((id) => [id, { ...this.devices.get(id)?.state }])),
      sent: new Map(),
      errors: new Map(),
    };
    this.jobs.add(job);
    this.step(job);
    this.devices.changed();
    return job;
  }

  tick() { for (const j of this.jobs) this.step(j); }

  async step(job) {
    if (job.busy) return;
    job.busy = true;
    try {
      const t = clamp((Date.now() - job.startAt) / job.durationMs, 0, 1);
      const done = t >= 1;
      await Promise.all([...job.ids].map(async (id) => {
        const d = this.devices.get(id);
        if (!d) return;
        const prev = job.sent.get(id);
        // Switched off some other way (button, Govee app) during the fade: leave it off, a sunrise too
        if (prev && d.state.power === false) { job.ids.delete(id); return; }
        const cloudStep = Math.min(CLOUD_STEP, job.durationMs / CLOUD_MIN_STEPS);
        if (!done && prev && !this.devices.lanActive(d) && Date.now() - prev.at < cloudStep) return;
        const f = job.frame(t, job.init.get(id), this.devices.capsOf(d));
        if (!f) return;
        const delta = {};
        if (f.brightness != null && f.brightness !== prev?.brightness) delta.brightness = f.brightness;
        if (f.color && f.color !== prev?.color) delta.color = f.color;
        if (f.kelvin && f.kelvin !== prev?.kelvin) delta.kelvin = f.kelvin;
        // Dimmer than 1% is 1% with a darker color: a new level means sending the look again, and so does
        // coming back up to 1%. While dim, everything sent says how dim, or the light would jump to full color.
        if ((f.dim || prev?.dim) && f.dim !== prev?.dim) {
          Object.assign(delta, { brightness: f.brightness ?? 1 }, f.color ? { color: f.color } : f.kelvin ? { kelvin: f.kelvin } : {});
        }
        if (f.dim && Object.keys(delta).length) delta.dim = f.dim;
        if (!Object.keys(delta).length) return;
        try {
          await this.devices.applyOne(d, delta);
          job.errors.delete(id);
        } catch (e) {
          job.errors.set(id, e.message);
          console.warn(`[fade] ${this.devices.nameOf(d)}: ${e.message}`);
        }
        job.sent.set(id, { ...prev, ...f, dim: f.dim ?? null, at: Date.now() });
      }));
      if (done && this.jobs.has(job)) {
        this.jobs.delete(job);
        if (job.end && job.ids.size) {
          const results = await this.devices.apply([...job.ids], job.end, { manual: false }).catch(() => []);
          for (const r of results) if (!r.ok) job.errors.set(r.id, r.error);
        }
        job.onEnd?.(false, job);
        this.devices.changed();
      }
    } finally {
      job.busy = false;
    }
  }
}

/** Lights with color LEDs start the sunrise below Govee's 1%, as a darker red (see withDim in devices.js) */
export const SUNRISE_FROM = 0.1;

export const sunrise = (endBrightness, endKelvin) => (t, init, caps) =>
  sunriseFrame(t, endBrightness, endKelvin, { minKelvin: caps?.kelvin?.min, from: caps?.color ? SUNRISE_FROM : 1 });

/** Dim from wherever each light was down to 1%. Lights that were already off are left alone. */
export const fadeOut = () => (t, init) => {
  if (init?.power === false) return null;
  const from = init?.brightness || 100;
  return { brightness: Math.max(1, Math.round(from + (1 - from) * t)) };
};
