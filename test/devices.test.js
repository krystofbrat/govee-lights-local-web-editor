import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Devices, UserError } from '../lib/devices.js';

const LAMP = 'AA:BB:CC:DD:EE:FF:00:01';
const STRIP = 'AA:BB:CC:DD:EE:FF:00:02';
const DESK = 'AA:BB:CC:DD:EE:FF:00:03';
const KITCHEN = 'AA:BB:CC:DD:EE:FF:00:04';

/** Devices with four known lights and no LAN or cloud behind them */
function makeDevices(data = {}) {
  const store = {
    data: { favorites: [], groups: [], hidden: [], names: {}, ...data },
    save() {},
  };
  const devices = new Devices({ store, cloud: null, lan: null });
  for (const [id, cloudName] of [[LAMP, 'H6008 lamp'], [STRIP, 'Bedside strip'], [DESK, 'Desk'], [KITCHEN, 'Kitchen']]) {
    devices.ensure(id).cloudName = cloudName;
  }
  return devices;
}

// ---------- normalizeAction ----------

test('brightness 0 means off, and brightness is clamped', () => {
  const d = makeDevices();
  assert.deepEqual(d.normalizeAction({ brightness: 0 }), { power: false });
  assert.deepEqual(d.normalizeAction({ brightness: 150 }), { brightness: 100 });
  assert.deepEqual(d.normalizeAction({ brightness: '40' }), { brightness: 40 });
  assert.throws(() => d.normalizeAction({ brightness: 'abc' }), UserError);
});

test('power, colors and whites are validated', () => {
  const d = makeDevices();
  assert.deepEqual(d.normalizeAction({ power: 'toggle' }), { power: 'toggle' });
  assert.deepEqual(d.normalizeAction({ power: 0 }), { power: false });
  assert.deepEqual(d.normalizeAction({ color: 'red' }), { color: '#ff0000' });
  // White wins over a color in the same action
  assert.deepEqual(d.normalizeAction({ color: 'red', kelvin: 'warm' }), { kelvin: 2700 });
  assert.throws(() => d.normalizeAction({ color: 'blurple' }), UserError);
  assert.throws(() => d.normalizeAction({ kelvin: 'hot' }), UserError);
});

test('scenes by name become scene objects', () => {
  const d = makeDevices();
  assert.deepEqual(d.normalizeAction({ scene: 'Aurora' }), { scene: { name: 'Aurora' } });
  assert.deepEqual(d.normalizeAction({ preset: 'Aurora' }), { scene: { name: 'Aurora' } });
});

test('favorites expand to their look, by id or by name', () => {
  const d = makeDevices({
    favorites: [
      { id: 'f1', name: 'Cozy evening', action: { color: '#ff8800', brightness: 40 } },
      { id: 'f2', name: 'Movie night', action: { power: false }, lights: { [LAMP]: { power: false }, [STRIP]: { kelvin: 2700, brightness: 50 } } },
    ],
  });
  assert.deepEqual(d.normalizeAction({ favorite: 'f1' }), { color: '#ff8800', brightness: 40 });
  assert.deepEqual(d.normalizeAction({ favorite: 'cozy' }), { color: '#ff8800', brightness: 40 });
  assert.deepEqual(d.normalizeAction({ preset: 'cozy' }), { color: '#ff8800', brightness: 40 });
  // Saved with "what's on now": each light gets its own look
  assert.deepEqual(d.normalizeAction({ favorite: 'movie' }), {
    each: { [LAMP]: { power: false }, [STRIP]: { kelvin: 2700, brightness: 50 } },
  });
  assert.throws(() => d.normalizeAction({ favorite: 'missing' }), (e) => e instanceof UserError && e.status === 404);
});

// ---------- resolve ----------

const rooms = {
  groups: [{ id: 'g1', name: 'Bedroom', devices: [LAMP, STRIP] }],
  hidden: [DESK],
  names: { [LAMP]: 'Bed lamp' },
};

test('"all" leaves out hidden lights, but they can still be named directly', () => {
  const d = makeDevices(rooms);
  assert.deepEqual(d.resolve('all'), [LAMP, STRIP, KITCHEN]);
  assert.deepEqual(d.resolve(`device:${DESK}`), [DESK]);
  assert.deepEqual(d.resolve(DESK.toLowerCase()), [DESK]);
});

test('groups and names resolve: exact, then prefix, then contains', () => {
  const d = makeDevices(rooms);
  assert.deepEqual(d.resolve('group:g1'), [LAMP, STRIP]);
  assert.deepEqual(d.resolve('bedroom'), [LAMP, STRIP]);
  assert.deepEqual(d.resolve('kit'), [KITCHEN]);
  assert.deepEqual(d.resolve('lamp'), [LAMP]); // custom name, not the Govee one
  assert.deepEqual(d.resolve(['kitchen', 'group:g1']), [KITCHEN, LAMP, STRIP]);
});

test('ambiguous and unknown names are errors', () => {
  const d = makeDevices(rooms);
  assert.throws(() => d.resolve('bed'), /matches several: Bedroom, Bed lamp, Bedside strip/);
  assert.throws(() => d.resolve('garage'), (e) => e instanceof UserError && e.status === 404);
});

// ---------- dimmer than 1% ----------

test('brightness below 1 means 1% with a darker color', () => {
  const d = makeDevices();
  assert.deepEqual(d.normalizeAction({ brightness: 0.25 }), { brightness: 1, dim: 0.25 });
  assert.deepEqual(d.normalizeAction({ brightness: '0.001' }), { brightness: 1, dim: 0.01 });
  assert.deepEqual(d.normalizeAction({ brightness: 1, dim: 0.5 }), { brightness: 1, dim: 0.5 }); // a saved look
  assert.deepEqual(d.normalizeAction({ brightness: 40, dim: 0.5 }), { brightness: 40 });
  assert.deepEqual(d.normalizeAction({ brightness: 0, dim: 0.5 }), { power: false });
});

/** One light on Local Wi-Fi, with what it was sent */
function lanLight() {
  const sent = [];
  const lan = {
    ready: true, byIp: new Map(), status() {},
    turn: async (ip, on) => sent.push({ turn: on }),
    brightness: async (ip, value) => sent.push({ brightness: value }),
    color: async (ip, { r, g, b }, kelvin) => sent.push({ rgb: [r, g, b], kelvin }),
  };
  const store = { data: { favorites: [], groups: [], hidden: [], names: {}, known: {} }, save() {} };
  const devices = new Devices({ store, cloud: null, lan });
  const d = devices.ensure(LAMP);
  d.lan = { ip: '10.0.0.5', lastSeen: Date.now() };
  Object.assign(d.state, { power: true, brightness: 30, color: '#ff8800' });
  return { devices, d, sent };
}

test('going below 1% sends 1% and a darker color, and coming back brings the color back', async () => {
  const { devices, d, sent } = lanLight();
  await devices.apply([LAMP], devices.normalizeAction({ brightness: 0.25 }));
  assert.deepEqual(sent, [{ rgb: [64, 34, 0], kelvin: 0 }, { brightness: 1 }]);
  const view = devices.view(d).state;
  assert.equal(view.dim, 0.25);
  assert.equal(view.color, '#ff8800'); // the real color, not the darkened one
  assert.deepEqual(await devices.capture([LAMP]), { [LAMP]: { brightness: 0.25, color: '#ff8800' } });

  sent.length = 0;
  await devices.apply([LAMP], devices.normalizeAction({ brightness: 0.1 }));
  assert.deepEqual(sent[0], { rgb: [26, 14, 0], kelvin: 0 }); // from the real color, not the dark one

  sent.length = 0;
  await devices.apply([LAMP], devices.normalizeAction({ brightness: 40 }));
  assert.deepEqual(sent, [{ rgb: [255, 136, 0], kelvin: 0 }, { brightness: 40 }]);
  assert.equal(devices.view(d).state.dim, null);
});

test('a white goes dim as its color, and a new color ends it', async () => {
  const { devices, d, sent } = lanLight();
  await devices.apply([LAMP], devices.normalizeAction({ kelvin: 'warm', brightness: 0.5 }));
  assert.deepEqual(sent[0].rgb, [128, 84, 44]);
  assert.deepEqual(devices.view(d).state.kelvin, 2700);
  sent.length = 0;
  await devices.apply([LAMP], devices.normalizeAction({ color: 'red' }));
  assert.deepEqual(sent, [{ rgb: [255, 0, 0], kelvin: 0 }]);
  assert.equal(devices.view(d).state.dim, null);
});

test('a light without color LEDs says it can\'t go below 1%', async () => {
  const d = makeDevices({ apiKey: 'k' });
  const lamp = d.get(LAMP);
  Object.assign(lamp, { inCloud: true, caps: [{ type: 'devices.capabilities.range', instance: 'brightness' }] });
  const [r] = await d.apply([LAMP], d.normalizeAction({ brightness: 0.25 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /below 1%/);
});
