import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostname, parseHostList, hostAllowed } from '../lib/hosts.js';

const allowed = (host, opts = { me: 'Krystofs-Mac.local' }) => hostAllowed(host, opts);

test('hostname strips the port, brackets and a trailing dot', () => {
  assert.equal(hostname('Mac.Local:8420'), 'mac.local');
  assert.equal(hostname('[::1]:8420'), '::1');
  assert.equal(hostname('mymac.tail1234.ts.net.'), 'mymac.tail1234.ts.net');
  assert.equal(hostname('evil.com:abc'), null);
  assert.equal(hostname('evil.com:8420:1'), null);
  assert.equal(hostname('::1'), null); // IPv6 in a Host header always has brackets
  assert.equal(hostname(''), null);
  assert.equal(hostname(undefined), null);
});

test('this computer, local names and raw addresses are allowed', () => {
  for (const host of ['localhost', 'localhost:8420', '127.0.0.1:8420', '192.168.1.20:8420', '[::1]:8420', '[fe80::1]:8420',
    'krystofs-mac.local:8420', 'KRYSTOFS-MAC', 'krystofs-mac:8420', 'printer.local']) {
    assert.ok(allowed(host), host);
  }
});

test('Tailscale MagicDNS names are allowed, look-alikes are not', () => {
  assert.ok(allowed('mymac.tail1234.ts.net'));
  assert.ok(allowed('MyMac.tail1234.ts.net:8420'));
  assert.ok(allowed('100.101.102.103:8420'));
  assert.ok(!allowed('ts.net'));
  assert.ok(!allowed('evilts.net'));
  assert.ok(!allowed('mymac.tail1234.ts.net.evil.com'));
});

test('other names are blocked, so DNS rebinding still fails', () => {
  for (const host of ['evil.com', 'evil.com:8420', 'localhost.evil.com', 'krystofs-mac.evil.com', 'evil.com:abc', '', undefined]) {
    assert.ok(!allowed(host), String(host));
  }
  // No computer name known: only the generic rules apply
  assert.ok(!hostAllowed('krystofs-mac', {}));
});

test('LIGHTS_ALLOWED_HOSTS adds exact names', () => {
  const extra = parseHostList(' Lights.Example.com , other.lan:8420 ,, ');
  assert.deepEqual(extra, ['lights.example.com', 'other.lan']);
  assert.deepEqual(parseHostList(undefined), []);
  assert.ok(hostAllowed('lights.example.com:8420', { extra }));
  assert.ok(hostAllowed('OTHER.LAN', { extra }));
  assert.ok(!hostAllowed('sub.lights.example.com', { extra }));
  assert.ok(!hostAllowed('example.com', { extra }));
});
