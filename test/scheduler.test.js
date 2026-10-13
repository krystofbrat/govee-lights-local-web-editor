import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../lib/scheduler.js';
import { UserError } from '../lib/devices.js';

const MIN = 60_000;
const DAILY = [0, 1, 2, 3, 4, 5, 6];

/** A scheduler wired to fakes that record what it would do to the lights */
function setup(alarms = [], location = null) {
  const store = { data: { alarms, fired: {}, timers: [], groups: [], location }, save() {} };
  const fadesStarted = [], applied = [];
  const devices = {
    resolve: () => ['LAMP'],
    normalizeAction: (a) => a,
    apply: async (ids, action) => { applied.push({ ids, action }); return []; },
    changed() {},
  };
  const fades = { start: (job) => fadesStarted.push(job), cancel() {} };
  const scheduler = new Scheduler({ store, devices, fades, notify() {} });
  return { scheduler, store, fadesStarted, applied };
}

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
