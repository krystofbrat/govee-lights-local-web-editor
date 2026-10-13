import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColor, parseKelvin, parseTime, describeDays, kelvinToRgb, hsvToHex, hexToHsv, mixHex, sunriseFrame,
} from '../lib/util.js';

test('parseColor accepts names, hex and r,g,b', () => {
  assert.equal(parseColor('red'), '#ff0000');
  assert.equal(parseColor(' Amber '), '#ff9500');
  assert.equal(parseColor('FF8800'), '#ff8800');
  assert.equal(parseColor('#f80'), '#ff8800');
  assert.equal(parseColor('255, 136, 0'), '#ff8800');
  assert.equal(parseColor('300,0,0'), '#ff0000');
  assert.equal(parseColor('blurple'), null);
  assert.equal(parseColor(null), null);
});

test('parseKelvin accepts names and 4-digit numbers, clamped to 2000-9000', () => {
  assert.equal(parseKelvin('warm'), 2700);
  assert.equal(parseKelvin('2700'), 2700);
  assert.equal(parseKelvin('2700K'), 2700);
  assert.equal(parseKelvin('1500'), 2000);
  assert.equal(parseKelvin('9999'), 9000);
  assert.equal(parseKelvin('500'), null);
  assert.equal(parseKelvin('hot'), null);
});

test('parseTime understands 24-hour and am/pm times', () => {
  assert.equal(parseTime('7:00'), '07:00');
  assert.equal(parseTime('6.45'), '06:45');
  assert.equal(parseTime('0645'), '06:45');
  assert.equal(parseTime('6:30am'), '06:30');
  assert.equal(parseTime('6:30 PM'), '18:30');
  assert.equal(parseTime('12am'), '00:00');
  assert.equal(parseTime('12pm'), '12:00');
  for (const bad of ['13pm', '25:00', '7:60', '', 'soon']) assert.equal(parseTime(bad), null, bad);
});

test('describeDays names common sets and lists the rest Monday first', () => {
  assert.equal(describeDays([]), 'Once');
  assert.equal(describeDays([0, 1, 2, 3, 4, 5, 6]), 'Every day');
  assert.equal(describeDays([5, 1, 2, 3, 4]), 'Weekdays');
  assert.equal(describeDays([6, 0]), 'Weekends');
  assert.equal(describeDays([0, 1, 3]), 'Mon, Wed, Sun');
});

test('kelvinToRgb goes from orange to bluish white', () => {
  const warm = kelvinToRgb(2000), cool = kelvinToRgb(9000);
  assert.equal(warm.r, 255);
  assert.ok(warm.b < 50);
  assert.equal(cool.b, 255);
  assert.ok(cool.r < 255);
});

test('hsvToHex and hexToHsv round-trip', () => {
  assert.equal(hsvToHex(0, 1), '#ff0000');
  assert.equal(hsvToHex(120, 1), '#00ff00');
  assert.deepEqual(hexToHsv('#0000ff'), { h: 240, s: 1, v: 1 });
  for (const hex of ['#ff8800', '#3b30ff', '#00d5ff']) {
    const { h, s, v } = hexToHsv(hex);
    assert.equal(hsvToHex(h, s, v), hex);
  }
});

test('mixHex blends two colors', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0), '#000000');
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHex('#000000', '#ffffff', 1), '#ffffff');
});

test('sunriseFrame starts dim deep red and ends at the chosen brightness and white', () => {
  assert.deepEqual(sunriseFrame(0), { brightness: 1, color: '#ff1e00' });
  assert.deepEqual(sunriseFrame(1), { brightness: 100, kelvin: 4000 });
  assert.deepEqual(sunriseFrame(1, 60, 3000), { brightness: 60, kelvin: 3000 });
  // Brightness never goes down during a sunrise
  let last = 0;
  for (let t = 0; t <= 1; t += 0.05) {
    const { brightness } = sunriseFrame(t);
    assert.ok(brightness >= last, `t=${t.toFixed(2)}`);
    last = brightness;
  }
});
