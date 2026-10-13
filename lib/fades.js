import { clamp, sunriseFrame } from './util.js';

const TICK = 2000;          // LAN lights get a new step every tick
const CLOUD_STEP = 20_000;  // cloud lights only every 20s, to save API quota

/**
 * Gradual transitions (sunrise, fade-out). Each job drives a set of lights from a frame function
 * frame(t, startState) -> { brightness, color | kelvin } | null, for t going 0 → 1.
 * Any manual command to a light removes it from its job.
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

  cancel(ids) {
    for (const j of [...this.jobs]) {
      for (const id of ids) j.ids.delete(id);
      if (!j.ids.size) { this.jobs.delete(j); j.onEnd?.(true); }
    }
  }

  start({ ids, startAt = Date.now(), durationMs, frame, end = null, label, onEnd }) {
    if (!ids.length) return null;
    this.cancel(ids);
    const job = {
      ids: new Set(ids), startAt, durationMs: Math.max(1000, durationMs), frame, end, label, onEnd,
      init: new Map(ids.map((id) => [id, { ...this.devices.get(id)?.state }])),
      sent: new Map(),
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
        // Switched off some other way (button, Govee app) while dimming: leave it off
        if (prev && job.end?.power === false && d.state.power === false) { job.ids.delete(id); return; }
        if (!done && prev && !this.devices.lanActive(d) && Date.now() - prev.at < CLOUD_STEP) return;
        const f = job.frame(t, job.init.get(id));
        if (!f) return;
        const delta = {};
        if (f.brightness != null && f.brightness !== prev?.brightness) delta.brightness = f.brightness;
        if (f.color && f.color !== prev?.color) delta.color = f.color;
        if (f.kelvin && f.kelvin !== prev?.kelvin) delta.kelvin = f.kelvin;
        if (!Object.keys(delta).length) return;
        try {
          await this.devices.applyOne(d, delta);
        } catch (e) {
          console.warn(`[fade] ${this.devices.nameOf(d)}: ${e.message}`);
        }
        job.sent.set(id, { ...prev, ...f, at: Date.now() });
      }));
      if (done && this.jobs.has(job)) {
        this.jobs.delete(job);
        if (job.end && job.ids.size) await this.devices.apply([...job.ids], job.end, { manual: false });
        job.onEnd?.(false);
        this.devices.changed();
      }
    } finally {
      job.busy = false;
    }
  }
}

export const sunrise = (endBrightness, endKelvin) => (t) => sunriseFrame(t, endBrightness, endKelvin);

/** Dim from wherever each light was down to 1%. Lights that were already off are left alone. */
export const fadeOut = () => (t, init) => {
  if (init?.power === false) return null;
  const from = init?.brightness || 100;
  return { brightness: Math.max(1, Math.round(from + (1 - from) * t)) };
};
