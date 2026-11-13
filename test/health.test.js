import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Health } from '../lib/health.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

test('cloud requests: how many failed, and how long the ones that worked took', () => {
  const h = new Health();
  const t0 = Date.now();
  for (const ms of [800, 200, 3000]) h.cloudRequest({ status: 200, ms }, t0);
  h.cloudRequest({ status: 0, ms: 6, error: 'No answer' }, t0 + MIN);
  const { cloud } = h.view(t0 + 2 * MIN).hour;
  assert.deepEqual(cloud, { requests: 4, failed: 1, median: 800, slowest: 3000, lastFailure: { t: t0 + MIN, error: 'No answer' } });
});

test('an error from Govee counts as failed, even with an answer', () => {
  const h = new Health();
  h.cloudRequest({ status: 429, ms: 300, error: 'Govee rate limit reached' });
  assert.equal(h.view().hour.cloud.failed, 1);
  assert.equal(h.view().hour.cloud.median, null); // only requests that worked are timed
});

test('wi-fi scans and the lights that answered them', () => {
  const h = new Health();
  const t0 = Date.now();
  h.lan({ dir: 'out', cmd: 'scan', data: { interfaces: ['192.168.0.145'] } }, t0);
  h.lan({ dir: 'in', cmd: 'scan', ip: '192.168.0.50' }, t0 + 100);
  h.lan({ dir: 'in', cmd: 'scan', ip: '192.168.0.51' }, t0 + 120);
  h.lan({ dir: 'out', cmd: 'devStatus', ip: '192.168.0.50' }, t0 + 200); // not a scan
  const v = h.view(t0 + MIN);
  assert.deepEqual(v.hour.lan, { scans: 1, answers: 2, from: ['192.168.0.50', '192.168.0.51'] });
  assert.deepEqual(v.lastScan.interfaces, ['192.168.0.145']);
  assert.equal(v.lastAnswer.ip, '192.168.0.51');
});

test('the last hour and the last day are counted apart, and older ones are dropped', () => {
  const h = new Health();
  const t0 = Date.now();
  h.cloudRequest({ status: 200, ms: 500 }, t0);
  h.cloudRequest({ status: 200, ms: 500 }, t0 + 3 * HOUR);
  let v = h.view(t0 + 3 * HOUR + MIN);
  assert.equal(v.hour.cloud.requests, 1);
  assert.equal(v.day.cloud.requests, 2);
  h.cloudRequest({ status: 200, ms: 500 }, t0 + 25 * HOUR);
  assert.equal(h.cloud.length, 2, 'the first one is over 24 h old');
});
