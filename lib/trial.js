const TRY_FOR = 10_000;

/**
 * Trying a scene or color: the lights show it for a few seconds, then go back to how they were unless
 * it's kept. Trying several in a row keeps the looks from before the first one. One trial at a time.
 */
export class Trial {
  constructor(devices) {
    this.devices = devices;
    this.cur = null;
  }

  view() {
    const t = this.cur;
    return t && { target: t.target, label: t.label, endsAt: t.endsAt };
  }

  covers(ids) { return !!this.cur && ids.some((id) => this.cur.ids.includes(id)); }

  async start(target, ids, action, label) {
    // Moved on to other lights without keeping the last one
    if (this.cur && this.cur.target !== target) await this.undo();
    // Remember how the lights look before the first try
    if (!this.cur) this.cur = { target, ids, before: this.devices.capture(ids) };
    const t = this.cur;
    const attempt = (t.attempt = {});
    t.label = label;
    t.hits = [];
    this.schedule(t);
    await t.before;
    const results = await this.devices.apply(ids, action, {
      saveScene: (hit, d) => { if (t.attempt === attempt) t.hits.push([hit, d.sku]); },
    });
    // Count the seconds from when the lights show it: cloud lights take a moment
    if (this.cur === t && t.attempt === attempt) this.schedule(t);
    return results;
  }

  schedule(t) {
    clearTimeout(t.timer);
    t.endsAt = Date.now() + TRY_FOR;
    t.timer = setTimeout(() => this.undo(), TRY_FOR);
    this.devices.changed();
  }

  /** Keep it: the lights stay, and a scene goes into My scenes like any scene turned on here. */
  keep() {
    const t = this.cur;
    if (!t) return;
    this.cur = null;
    clearTimeout(t.timer);
    for (const [hit, sku] of t.hits) this.devices.saveScene(hit, sku);
    this.devices.changed();
  }

  async undo() {
    const t = this.cur;
    if (!t) return;
    this.cur = null;
    clearTimeout(t.timer);
    this.devices.changed();
    const before = await t.before;
    const each = Object.fromEntries(Object.entries(before).map(([id, look]) => [id, this.devices.normalizeAction(look, 1)]));
    await this.devices.apply(Object.keys(each), { each }).catch((e) => console.warn('[try] going back:', e.message));
  }
}
