import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pin, validPin, cookieValue, COOKIE } from '../lib/auth.js';
import { fromThisComputer } from '../lib/hosts.js';
import { UserError } from '../lib/devices.js';

function makePin(data = {}) {
  const store = { data: { pin: null, ...data }, save() {} };
  return { pin: new Pin(store), store };
}

/** A request as the server sees it */
const req = (remoteAddress = '192.168.1.30', headers = {}) => ({ socket: { remoteAddress }, headers });

test('PINs are 4 to 12 digits', () => {
  assert.ok(validPin('1234'));
  assert.ok(validPin('123456789012'));
  assert.ok(!validPin('123'));
  assert.ok(!validPin('1234567890123'));
  assert.ok(!validPin('12a4'));
  assert.ok(!validPin(undefined));
});

test('no PIN by default: everyone is allowed', async () => {
  const { pin } = makePin();
  assert.equal(pin.enabled, false);
  assert.equal(await pin.allowed(req()), true);
});

test('only a salted hash is stored, never the PIN', async () => {
  const { pin, store } = makePin();
  await pin.set('482193');
  const saved = JSON.stringify(store.data);
  assert.ok(!saved.includes('482193'));
  assert.match(store.data.pin.hash, /^[0-9a-f]{128}$/);
  assert.match(store.data.pin.salt, /^[0-9a-f]{32}$/);
  assert.equal(await pin.check('482193'), true);
  assert.equal(await pin.check('000000'), false);
  // The same PIN set again gets a different salt and hash
  const first = store.data.pin.hash;
  await pin.set('482193');
  assert.notEqual(store.data.pin.hash, first);
  await assert.rejects(pin.set('12'), UserError);
});

test('after 5 wrong tries, each try waits 30 seconds', async () => {
  const { pin } = makePin();
  await pin.set('4821');
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(await pin.check('0000', t0), false);
  await assert.rejects(pin.check('4821', t0 + 1000), (e) => e.status === 429 && /29 s/.test(e.message));
  assert.equal(await pin.check('0000', t0 + 30_000), false); // allowed again, still wrong
  await assert.rejects(pin.check('4821', t0 + 50_000), (e) => e.status === 429); // waits 30 s from that one
  assert.equal(await pin.check('4821', t0 + 60_000), true);
  assert.equal(await pin.check('0000', t0 + 60_001), false); // right PIN reset the count
});

test('many tries sent at once still count', async () => {
  const { pin } = makePin();
  await pin.set('4821');
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => pin.check('0000', 5000)));
  assert.equal(results.filter((r) => r.status === 'rejected' && r.reason.status === 429).length, 5);
});

test('session cookies are signed, expire after a year, and die when the PIN changes', async () => {
  const { pin } = makePin();
  await pin.set('4821');
  const now = Date.UTC(2026, 0, 1);
  const token = pin.token(now);
  assert.ok(pin.validToken(token, now + 1000));
  assert.ok(pin.validToken(token, now + 364 * 864e5));
  assert.ok(!pin.validToken(token, now + 366 * 864e5));
  assert.ok(!pin.validToken(token.slice(0, -2) + 'xx', now));
  assert.ok(!pin.validToken(`${(now + 1).toString(36)}.${token.split('.')[1]}`, now)); // can't move the date
  assert.ok(!pin.validToken('nonsense', now));
  assert.ok(!pin.validToken(undefined, now));
  await pin.set('4821');
  assert.ok(!pin.validToken(token, now + 1000));
  assert.match(pin.cookie(token), /HttpOnly; SameSite=Strict; Path=\/; Max-Age=31536000$/);
});

test('who may use the API once a PIN is set', async () => {
  const { pin } = makePin();
  await pin.set('4821');
  const cookie = `theme=dark; ${COOKIE}=${pin.token()}`;
  assert.equal(await pin.allowed(req('127.0.0.1')), true);
  assert.equal(await pin.allowed(req('::1')), true);
  assert.equal(await pin.allowed(req('192.168.1.30')), false);
  assert.equal(await pin.allowed(req('192.168.1.30', { cookie })), true);
  assert.equal(await pin.allowed(req('192.168.1.30', { authorization: 'Bearer 4821' })), true);
  assert.equal(await pin.allowed(req('192.168.1.30', { 'x-lights-pin': '4821' })), true);
  assert.equal(await pin.allowed(req('192.168.1.30', { 'x-lights-pin': '1111' })), false);
  // A proxy on this computer (like `tailscale serve`) passes on requests from elsewhere
  assert.equal(await pin.allowed(req('127.0.0.1', { 'x-forwarded-for': '100.64.0.7' })), false);
});

test('reading cookies and where requests come from', () => {
  assert.equal(cookieValue('a=1; lights_session=x.y=; b=2', 'lights_session'), 'x.y=');
  assert.equal(cookieValue(undefined, 'lights_session'), null);
  assert.ok(fromThisComputer(req('::ffff:127.0.0.1')));
  assert.ok(!fromThisComputer(req('127.0.0.1', { forwarded: 'for=1.2.3.4' })));
  assert.ok(!fromThisComputer(req('10.0.0.2')));
});
