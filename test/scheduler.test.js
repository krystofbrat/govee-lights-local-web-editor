import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../lib/scheduler.js';
import { UserError } from '../lib/devices.js';

const MIN = 60_000;
const DAILY = [0, 1, 2, 3, 4, 5, 6];

/**
 * A scheduler wired to fakes that record what it would do to the lights, and what it told the user.
 * results: what turning the lights on/off returns; down: lights that don't answer; battery: the Mac is on battery.
 */
function setup(alarms = [], location = null, { results = [], down = [], battery = false } = {}) {
  const store = { data: { alarms, fired: {}, timers: [], groups: [], location }, save() {} };
  const fadesStarted = [], applied = [], notes = [];
  const devices = {
    resolve: () => ['LAMP'],
    normalizeAction: (a) => a,
    apply: async (ids, action) => { applied.push({ ids, action }); return results; },
    changed() {},
    get: (id) => ({ id }),
    nameOf: (d) => (d.id === 'LAMP' ? 'Lamp' : d.id),
    reachable: (d) => !down.includes(d.id),
    lanActive: () => false,
    cloudOffline: false,
  };
  const fades = { start: (job) => fadesStarted.push(job), cancel() {} };
  const notify = (msg, { important = false } = {}) => notes.push({ msg, important });
  const scheduler = new Scheduler({ store, devices, fades, notify, system: { onBattery: async () => battery } });
  return { scheduler, store, fadesStarted, applied, notes };
}

const settle = () => new Promise((r) => setImmediate(r));
const important = (notes) => notes.filter((n) => n.important).map((n) => n.msg);

const alarm = (props) => ({
  id: 'a1', name: '', enabled: true, type: 'sunrise', time: '07:00', days: DAILY, target: ['all'],
  duration: 30, brightness: 100, kelvin: 4000, updatedAt: 0, ...props,
});

/** "HH:MM" of a moment `ms` from now, for alarms that should be due right now */
function hm(ms) {
  const d = new Date(Date.now() + ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------- saving alarms ----------

test('saving an alarm cleans up its fields', () => {
  const { scheduler } = setup();
  const a = scheduler.upsert({ type: 'sunrise', time: '6:30am', days: [1, 1, 9, -1, '3'], duration: 500, brightness: 150, kelvin: 1000, target: 'group:g1' });
  assert.equal(a.time, '06:30');
  assert.deepEqual(a.days, [1, 3]);
  assert.deepEqual(a.target, ['group:g1']);
  assert.equal(a.duration, 120);
  assert.equal(a.brightness, 100);
  assert.equal(a.kelvin, 2000);
  assert.equal(a.enabled, true);
});

test('saving an alarm again updates it in place', () => {
  const { scheduler, store } = setup();
  const a = scheduler.upsert({ type: 'off', time: '23:00', days: DAILY, fade: 15 });
  scheduler.upsert({ id: a.id, enabled: false });
  assert.equal(store.data.alarms.length, 1);
  assert.equal(store.data.alarms[0].enabled, false);
  assert.equal(store.data.alarms[0].fade, 15);
});

test('an alarm needs a valid time', () => {
  const { scheduler } = setup();
  assert.throws(() => scheduler.upsert({ type: 'on', time: 'soon' }), UserError);
});

test('some days can have their own time', () => {
  const { scheduler } = setup();
  const a = scheduler.upsert({ type: 'sunrise', time: '6:30', days: [1, 2, 3, 4, 5], times: { 1: '5:30am', 3: '05:30', 4: '06:30', 6: '09:00' } });
  // Thursday is the usual time anyway, and the alarm doesn't run on Saturday
  assert.deepEqual(a.times, { 1: '05:30', 3: '05:30' });
  assert.deepEqual(scheduler.upsert({ id: a.id, enabled: false }).times, { 1: '05:30', 3: '05:30' });
  assert.equal(scheduler.upsert({ id: a.id, times: {} }).times, undefined);
  assert.throws(() => scheduler.upsert({ type: 'on', time: '07:00', days: [1], times: { 1: 'early' } }), /Mon/);
});

test('only repeating clock alarms have a time per day', () => {
  const { scheduler } = setup([], { lat: 50.08, lon: 14.44 });
  assert.equal(scheduler.upsert({ type: 'on', time: '07:00', days: [], times: { 1: '05:30' } }).times, undefined);
  assert.equal(scheduler.upsert({ type: 'on', time: 'sunset', days: DAILY, times: { 1: '05:30' } }).times, undefined);
});

// ---------- upcoming ----------

test('upcoming lists enabled alarms by when their lights start', () => {
  const now = new Date(2026, 0, 14, 6, 0).getTime(); // a Wednesday, 6:00
  const { scheduler } = setup([
    alarm({ id: 'sunrise', time: '07:00', days: [1, 2, 3, 4, 5], duration: 30 }),
    alarm({ id: 'weekend', type: 'on', time: '06:45', days: [0, 6] }),
    alarm({ id: 'past', type: 'off', time: '05:00', days: DAILY }),
    alarm({ id: 'once', type: 'on', time: '05:30', days: [] }),
    alarm({ id: 'disabled', enabled: false, time: '06:30' }),
  ]);
  assert.deepEqual(scheduler.upcoming(now), [
    { id: 'sunrise', at: new Date(2026, 0, 14, 7, 0).getTime(), start: new Date(2026, 0, 14, 6, 30).getTime() },
    { id: 'past', at: new Date(2026, 0, 15, 5, 0).getTime(), start: new Date(2026, 0, 15, 5, 0).getTime() },
    { id: 'once', at: new Date(2026, 0, 15, 5, 30).getTime(), start: new Date(2026, 0, 15, 5, 30).getTime() },
    { id: 'weekend', at: new Date(2026, 0, 17, 6, 45).getTime(), start: new Date(2026, 0, 17, 6, 45).getTime() },
  ]);
});

test('upcoming uses the time of the day the alarm runs next', () => {
  const now = new Date(2026, 0, 14, 6, 0).getTime(); // a Wednesday, 6:00
  const { scheduler } = setup([
    alarm({ id: 'later-today', type: 'on', time: '05:30', days: [1, 2, 3, 4, 5], times: { 3: '06:30' } }),
    alarm({ id: 'early-tomorrow', type: 'on', time: '06:30', days: [1, 2, 3, 4, 5], times: { 3: '05:30', 4: '05:30' } }),
  ]);
  assert.deepEqual(scheduler.upcoming(now), [
    { id: 'later-today', at: new Date(2026, 0, 14, 6, 30).getTime(), start: new Date(2026, 0, 14, 6, 30).getTime() },
    { id: 'early-tomorrow', at: new Date(2026, 0, 15, 5, 30).getTime(), start: new Date(2026, 0, 15, 5, 30).getTime() },
  ]);
});

// ---------- firing ----------

test('a sunrise starts its fade ahead of the alarm time, once', () => {
  const { scheduler, fadesStarted } = setup([alarm({ time: hm(10 * MIN), duration: 30 })]);
  scheduler.tick();
  scheduler.tick();
  assert.equal(fadesStarted.length, 1);
  assert.equal(fadesStarted[0].label, 'Sunrise');
  assert.deepEqual(fadesStarted[0].ids, ['LAMP']);
  assert.equal(fadesStarted[0].durationMs, 30 * MIN);
});

test('a one-time alarm switches itself off after it fires', () => {
  const { scheduler, store, fadesStarted } = setup([alarm({ time: hm(10 * MIN), days: [] })]);
  scheduler.tick();
  assert.equal(fadesStarted.length, 1);
  assert.equal(store.data.alarms[0].enabled, false);
});

test('a turn-off alarm a minute late still switches the lights off', () => {
  const { scheduler, applied } = setup([alarm({ type: 'off', time: hm(-1 * MIN), fade: 0 })]);
  scheduler.tick();
  assert.deepEqual(applied, [{ ids: ['LAMP'], action: { power: false } }]);
});

test('on a day with its own time, the alarm fires then instead of at the usual time', () => {
  const wednesday6 = new Date(2026, 0, 14, 6, 0).getTime();
  const { scheduler, applied } = setup([alarm({ type: 'off', fade: 0, time: '06:00', times: { 3: '06:30' } })]);
  scheduler.tick(wednesday6);
  assert.equal(applied.length, 0);
  scheduler.tick(wednesday6 + 30 * MIN);
  assert.deepEqual(applied, [{ ids: ['LAMP'], action: { power: false } }]);
});

test('alarms that are not due yet do nothing', () => {
  const { scheduler, fadesStarted, applied } = setup([
    alarm({ time: hm(2 * 3600_000), duration: 30 }),
    alarm({ id: 'a2', type: 'off', time: hm(30 * MIN), fade: 0 }),
  ]);
  scheduler.tick();
  assert.equal(fadesStarted.length + applied.length, 0);
});

// ---------- times at sunrise and sunset ----------

const PRAGUE = { lat: 50.08, lon: 14.44 };
// On 14 Jan 2026 the sun sets in Prague at 15:27 UTC
const SUNSET_JAN_14 = Date.UTC(2026, 0, 14, 15, 27);

test('a sun time needs a location, except to switch the alarm off', () => {
  const { scheduler } = setup();
  assert.throws(() => scheduler.upsert({ type: 'on', time: 'sunset' }), /location/);
  assert.equal(scheduler.upsert({ type: 'on', time: 'sunset', enabled: false }).time, 'sunset');
});

test('sun times are saved in a standard form', () => {
  const { scheduler } = setup([], PRAGUE);
  assert.equal(scheduler.upsert({ type: 'on', time: 'Sunset - 30' }).time, 'sunset-30');
  assert.equal(scheduler.upsert({ type: 'off', time: 'sunrise+15' }).time, 'sunrise+15');
  assert.throws(() => scheduler.upsert({ type: 'on', time: 'sunset-600' }), UserError);
});

test('upcoming shows the real time of a sun alarm', () => {
  const now = Date.UTC(2026, 0, 14, 6, 0);
  const { scheduler } = setup([
    alarm({ id: 'before', type: 'on', time: 'sunset-30' }),
    alarm({ id: 'fade', type: 'sunrise', time: 'sunset', duration: 20 }),
  ], PRAGUE);
  assert.deepEqual(scheduler.upcoming(now), [
    { id: 'before', at: SUNSET_JAN_14 - 30 * MIN, start: SUNSET_JAN_14 - 30 * MIN },
    { id: 'fade', at: SUNSET_JAN_14, start: SUNSET_JAN_14 - 20 * MIN },
  ]);
});

test('a sun alarm fires when its time comes, once', () => {
  const { scheduler, applied } = setup([alarm({ type: 'off', time: 'sunset-30', fade: 0 })], PRAGUE);
  scheduler.tick(SUNSET_JAN_14 - 31 * MIN);
  assert.equal(applied.length, 0);
  scheduler.tick(SUNSET_JAN_14 - 29 * MIN);
  scheduler.tick(SUNSET_JAN_14 - 28 * MIN);
  assert.deepEqual(applied, [{ ids: ['LAMP'], action: { power: false } }]);
});

test('days without a sunset are skipped and logged once', (t) => {
  const logged = t.mock.method(console, 'log', () => {});
  const a = alarm({ type: 'on', time: 'sunset' });
  const { scheduler } = setup([a], { lat: 69.65, lon: 18.96 }); // Tromsø, polar night
  const now = Date.UTC(2024, 11, 21, 12, 0);
  assert.equal(scheduler.at(a, now, 0, { log: true }), null);
  assert.equal(scheduler.at(a, now, 0, { log: true }), null);
  assert.deepEqual(scheduler.upcoming(now), []);
  assert.equal(logged.mock.callCount(), 1);
  assert.match(logged.mock.calls[0].arguments[0], /polar night/);
});

test('without a location, sun alarms just don\'t come up', () => {
  const { scheduler } = setup([alarm({ type: 'on', time: 'sunset' })]);
  assert.deepEqual(scheduler.upcoming(Date.UTC(2026, 0, 14, 6, 0)), []);
});

// ---------- how alarms went, and why they may not run ----------

const NO_INTERNET = "Can't reach Govee's cloud — is this Mac online?";
const SAVED = () => ({ updatedAt: Date.now() - 3600_000 }); // saved an hour ago, so yesterday's run doesn't count

test('how a turn-off alarm went is kept, and a light it did not reach is reported', async () => {
  const fine = setup([alarm({ type: 'off', time: hm(-1 * MIN), fade: 0, ...SAVED() })], null, { results: [{ id: 'LAMP', ok: true }] });
  fine.scheduler.tick();
  await settle();
  assert.equal(fine.store.data.runs.a1.ok, true);
  assert.equal(fine.store.data.runs.a1.lights, 1);
  assert.deepEqual(important(fine.notes), []);

  const bad = setup([alarm({ type: 'off', time: hm(-1 * MIN), fade: 0, ...SAVED() })], null, { results: [{ id: 'LAMP', ok: false, error: NO_INTERNET }] });
  bad.scheduler.tick();
  await settle();
  assert.equal(bad.store.data.runs.a1.ok, false);
  assert.deepEqual(bad.store.data.runs.a1.failed, [{ name: 'Lamp', error: NO_INTERNET }]);
  assert.equal(important(bad.notes).length, 1);
  assert.match(important(bad.notes)[0], /didn't reach your lights: Can't reach Govee's cloud/);
});

test('a sunrise is "running" until its fade ends, then says how it went; a preview is not kept', () => {
  const { scheduler, store, fadesStarted, notes } = setup([alarm({ time: hm(10 * MIN), duration: 30, ...SAVED() })]);
  scheduler.tick();
  assert.equal(store.data.runs.a1.running, true);
  fadesStarted[0].onEnd(false, { errors: new Map([['LAMP', NO_INTERNET]]) });
  assert.equal(store.data.runs.a1.running, undefined);
  assert.equal(store.data.runs.a1.ok, false);
  assert.equal(important(notes).length, 1);

  scheduler.preview({ type: 'sunrise', time: '07:00', days: DAILY });
  assert.equal(fadesStarted[1].onEnd, undefined);
});

test('an alarm missed while the Mac was asleep is reported once', () => {
  const at = new Date(2026, 0, 14, 7, 0).getTime();
  const { scheduler, store, notes, fadesStarted } = setup([alarm({ time: '07:00', duration: 30 })]);
  store.data.fired.a1 = new Date(2026, 0, 13, 7, 0).toISOString(); // yesterday's ran
  scheduler.startedAt = at - 10 * 3600_000; // running since last night
  scheduler.tick(at + 20 * MIN); // the Mac wakes up at 7:20, after the sunrise would have ended
  assert.equal(fadesStarted.length, 0);
  assert.deepEqual(store.data.runs.a1, { at, ranAt: store.data.runs.a1.ranAt, ok: false, missed: 'asleep', error: 'Your Mac was asleep (on battery or with the lid closed)' });
  scheduler.tick(at + 25 * MIN);
  assert.equal(important(notes).length, 1);
  assert.match(important(notes)[0], /^Missed: Sunrise today at /);
});

test('an alarm missed before the server started says so', () => {
  const at = new Date(2026, 0, 14, 7, 0).getTime();
  const { scheduler, store } = setup([alarm({ time: '07:00', duration: 30 })]);
  store.data.fired.a1 = new Date(2026, 0, 13, 7, 0).toISOString();
  scheduler.startedAt = at + 10 * MIN;
  scheduler.tick(at + 20 * MIN);
  assert.equal(store.data.runs.a1.missed, 'server');
});

test('an alarm that ran is not reported as missed afterwards', () => {
  const at = new Date(2026, 0, 14, 7, 0).getTime();
  const { scheduler, store, notes } = setup([alarm({ time: '07:00', duration: 30 })]);
  store.data.fired.a1 = new Date(2026, 0, 13, 7, 0).toISOString();
  scheduler.startedAt = at - 10 * 3600_000;
  scheduler.tick(at - 29 * MIN); // the sunrise starts
  scheduler.tick(at + 3 * 3600_000);
  assert.equal(store.data.runs.a1.running, true);
  assert.deepEqual(important(notes), []);
});

test('an alarm coming up warns while the Mac is on battery, and notifies once that has lasted', async () => {
  const now = Date.now();
  const { scheduler, notes } = setup([alarm({ time: hm(3 * 3600_000), duration: 30 })], null, { battery: true });
  await scheduler.check(now);
  assert.equal(scheduler.risks.a1[0].reason, 'battery');
  assert.deepEqual(important(notes), []); // a quick unplug doesn't send anything
  await scheduler.check(now + 6 * MIN);
  await scheduler.check(now + 12 * MIN);
  assert.equal(important(notes).length, 1);
  assert.match(important(notes)[0], /may not run\. Your Mac is on battery/);
});

test('lights that do not answer are a warning, but only for alarms in the next 10 hours', async () => {
  const { scheduler } = setup([
    alarm({ time: hm(3 * 3600_000), duration: 30 }),
    alarm({ id: 'a2', time: hm(14 * 3600_000), duration: 30 }),
  ], null, { down: ['LAMP'] });
  await scheduler.check();
  assert.equal(scheduler.risks.a1[0].reason, 'lights');
  assert.match(scheduler.risks.a1[0].text, /None of its lights are answering/);
  assert.equal(scheduler.risks.a2, undefined);
});

test('no warnings when the Mac is plugged in and the lights answer', async () => {
  const { scheduler } = setup([alarm({ time: hm(3 * 3600_000), duration: 30 })]);
  await scheduler.check();
  assert.deepEqual(scheduler.risks, {});
});

test('after a long sleep only the latest missed run is reported', () => {
  const at = new Date(2026, 0, 14, 7, 0).getTime();
  const { scheduler, store, notes } = setup([alarm({ time: '07:00', duration: 30 })]);
  store.data.fired.a1 = new Date(2026, 0, 11, 7, 0).toISOString(); // last ran three days ago
  scheduler.startedAt = at - 5 * 24 * 3600_000;
  scheduler.tick(at + 20 * MIN);
  assert.equal(store.data.runs.a1.at, at);
  assert.equal(important(notes).length, 1);
});

test('an alarm whose lights are gone is a warning', async () => {
  const { scheduler } = setup([alarm({ time: hm(3 * 3600_000), duration: 30, target: ['group:gone'] })]);
  scheduler.devices.resolve = () => [];
  await scheduler.check();
  assert.equal(scheduler.risks.a1[0].reason, 'nolights');
});
