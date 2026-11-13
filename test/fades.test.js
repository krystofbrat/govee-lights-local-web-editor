import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fades, sunrise } from '../lib/fades.js';

const MIN = 60_000;

/** Date.now() under the test's control, put back when the test ends */
function fakeClock(t) {
  const real = Date.now;
  let now = real();
  Date.now = () => now;
  t.after(() => { Date.now = real; });
  return { advance: (ms) => { now += ms; } };
}

/** Fades driving one fake light (on LAN or cloud only), with what the light was sent */
function setup({ lan = false, color = false, fail = null } = {}) {
  const light = { id: 'LAMP', state: { power: false, brightness: 50 } };
  const sent = [];
  let tries = 0;
  const devices = {
    get: (id) => (id === light.id ? light : null),
    lanActive: () => lan,
    capsOf: () => ({ color, kelvin: { min: 2700, max: 6500 } }),
    async applyOne(d, a) {
      if (fail?.(++tries)) throw new Error("Can't reach Govee's cloud");
      sent.push(a);
      d.state.power = true;
    },
    async apply() {},
    nameOf: () => 'Lamp',
    changed() {},
  };
  const realInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0; // the tests step the fades themselves
  try {
    return { fades: new Fades(devices), light, sent };
  } finally {
    globalThis.setInterval = realInterval;
  }
}

const settle = () => new Promise((r) => setImmediate(r));

async function runToEnd(fades, job, clock) {
  await settle();
  while (fades.jobs.has(job)) {
    clock.advance(2000);
    await fades.step(job);
  }
}

test('a light switched off some other way during a sunrise stays off', async (t) => {
  const clock = fakeClock(t);
  const { fades, light, sent } = setup({ lan: true });
  const job = fades.start({ ids: ['LAMP'], durationMs: 30 * MIN, frame: sunrise(100, 4000), label: 'Sunrise' });
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(light.state.power, true);

  light.state.power = false; // the Govee app or the button, seen in the next status poll
  clock.advance(5 * MIN);
  await fades.step(job);
  assert.equal(sent.length, 1, 'it was not switched back on');
  assert.equal(fades.labelFor('LAMP'), null);
});

test('a short sunrise on a cloud light (the preview) still goes up in many small steps', async (t) => {
  const clock = fakeClock(t);
  const { fades, sent } = setup();
  const job = fades.start({ ids: ['LAMP'], durationMs: 30_000, frame: sunrise(100, 4000), label: 'Sunrise preview' });
  await runToEnd(fades, job, clock);
  assert.ok(sent.length >= 12, `only ${sent.length} steps`);
});

test('a long sunrise on a cloud light steps every 20 seconds, to save API quota', async (t) => {
  const clock = fakeClock(t);
  const { fades, sent } = setup();
  const job = fades.start({ ids: ['LAMP'], durationMs: 30 * MIN, frame: sunrise(100, 4000), label: 'Sunrise' });
  await runToEnd(fades, job, clock);
  assert.ok(sent.length <= (30 * MIN) / 20_000 + 2, `${sent.length} steps`);
  // and asks only for whites this light can do
  assert.ok(sent.every((a) => !a.kelvin || a.kelvin >= 2700));
  // Only what changed is sent; it ends at full brightness and the chosen white
  assert.equal(sent.findLast((a) => a.brightness != null).brightness, 100);
  assert.equal(sent.findLast((a) => a.kelvin).kelvin, 4000);
});

test('on a light with color LEDs a sunrise starts below 1%, and comes up to 1% without a jump', async (t) => {
  const clock = fakeClock(t);
  const { fades, sent } = setup({ lan: true, color: true });
  const job = fades.start({ ids: ['LAMP'], durationMs: 20 * MIN, frame: sunrise(20, 3000), label: 'Sunrise' });
  await runToEnd(fades, job, clock);
  assert.deepEqual(sent[0], { brightness: 1, color: '#ff1e00', dim: 0.1 });
  // While dim, every step says how dim, along with the color it darkens (the light sets 1% for it, see withDim)
  const dimSteps = sent.filter((a) => a.dim);
  assert.ok(dimSteps.length > 10, `${dimSteps.length} steps below 1%`);
  assert.ok(dimSteps.every((a) => a.color && (a.brightness ?? 1) === 1));
  // The first step at 1% or more sends the real color again, without dim
  const back = sent[sent.indexOf(dimSteps.at(-1)) + 1];
  assert.equal(back.dim, undefined);
  assert.ok(back.color && back.brightness >= 1);
  assert.equal(sent.findLast((a) => a.brightness != null).brightness, 20);
});

test('a light that stopped answering is reported when the fade ends, and one that came back is not', async (t) => {
  const clock = fakeClock(t);
  for (const [fail, expected] of [[(n) => n > 3, ["Can't reach Govee's cloud"]], [(n) => n >= 2 && n <= 4, []]]) {
    const { fades } = setup({ lan: true, fail });
    let ended = null;
    const job = fades.start({ ids: ['LAMP'], durationMs: MIN, frame: sunrise(100, 4000), label: 'Sunrise', onEnd: (cancelled, j) => { ended = { cancelled, errors: [...j.errors.values()] }; } });
    await runToEnd(fades, job, clock);
    assert.deepEqual(ended, { cancelled: false, errors: expected });
  }
});
