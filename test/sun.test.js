import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunTimes, parseSunTime, parseAlarmTime, describeSunTime, parseLatLon } from '../lib/util.js';

const PRAGUE = [50.0755, 14.4378];
const MIN = 60_000;

/** Within 2 minutes of the expected UTC time */
function near(actual, [h, m, s], label) {
  const expected = new Date(actual);
  expected.setUTCHours(h, m, s, 0);
  assert.ok(Math.abs(actual - expected) <= 2 * MIN, `${label}: ${new Date(actual).toISOString()}, expected ${expected.toISOString()}`);
}

// Reference times from the astral library (NOAA's method), in UTC; they match timeanddate.com to the minute
test('sunrise and sunset in Prague on known dates', () => {
  const days = [
    [new Date(2024, 2, 20), [5, 4, 32], [17, 15, 30]],   // spring equinox
    [new Date(2024, 5, 21), [2, 52, 57], [19, 15, 20]],  // longest day: 4:52 and 21:15 summer time
    [new Date(2024, 8, 22), [4, 49, 23], [16, 59, 19]],  // autumn equinox
    [new Date(2024, 11, 21), [6, 59, 3], [15, 2, 2]],    // shortest day: 7:59 and 16:02 winter time
  ];
  for (const [date, rise, set] of days) {
    const s = sunTimes(date, ...PRAGUE);
    assert.equal(s.polar, null);
    near(s.sunrise, rise, `sunrise ${date.toDateString()}`);
    near(s.sunset, set, `sunset ${date.toDateString()}`);
  }
});

test('west of Greenwich, sunset can be on the next UTC day', () => {
  const s = sunTimes(new Date(2024, 5, 21), 21.31, -157.86); // Honolulu: 5:50 and 19:16 local
  assert.equal(new Date(s.sunrise).toISOString().slice(0, 16), '2024-06-21T15:50');
  assert.equal(new Date(s.sunset).toISOString().slice(0, 16), '2024-06-22T05:16');
});

test('no sunrise or sunset during polar day and night', () => {
  assert.deepEqual(sunTimes(new Date(2024, 5, 21), 69.65, 18.96), { sunrise: null, sunset: null, polar: 'day' });
  assert.deepEqual(sunTimes(new Date(2024, 11, 21), 69.65, 18.96), { sunrise: null, sunset: null, polar: 'night' });
  assert.equal(sunTimes(new Date(2024, 5, 21), -69.65, 18.96).polar, 'night'); // the other way round down south
});

test('sun times with offsets are parsed and normalized', () => {
  assert.deepEqual(parseSunTime('sunset'), { event: 'sunset', offset: 0 });
  assert.deepEqual(parseSunTime('Sunset - 30'), { event: 'sunset', offset: -30 });
  assert.deepEqual(parseSunTime('sunrise+15min'), { event: 'sunrise', offset: 15 });
  assert.equal(parseSunTime('sunset-241'), null); // more than 4 hours
  assert.equal(parseSunTime('sundown'), null);
  assert.equal(parseAlarmTime('SUNSET -30'), 'sunset-30');
  assert.equal(parseAlarmTime('sunrise+0'), 'sunrise');
  assert.equal(parseAlarmTime('6:30am'), '06:30');
  assert.equal(parseAlarmTime('soon'), null);
});

test('sun times are described in words', () => {
  assert.equal(describeSunTime('sunset'), 'at sunset');
  assert.equal(describeSunTime('sunset-30'), '30 min before sunset');
  assert.equal(describeSunTime('sunrise+60'), '1 h after sunrise');
  assert.equal(describeSunTime('sunrise+90'), '1 h 30 min after sunrise');
  assert.equal(describeSunTime('07:00'), '07:00');
});

test('locations are parsed, checked and rounded to about 1 km', () => {
  assert.deepEqual(parseLatLon('50.0755, 14.4378'), { lat: 50.08, lon: 14.44 });
  assert.deepEqual(parseLatLon('50,0755 14,4378'), { lat: 50.08, lon: 14.44 }); // decimal commas
  assert.deepEqual(parseLatLon('-33.87 151.21'), { lat: -33.87, lon: 151.21 });
  assert.deepEqual(parseLatLon({ lat: 40.7128, lon: -74.006 }), { lat: 40.71, lon: -74.01 });
  assert.equal(parseLatLon('91, 10'), null);
  assert.equal(parseLatLon('50.08'), null);
  assert.equal(parseLatLon('Prague'), null);
  assert.equal(parseLatLon({ lat: 'x', lon: 1 }), null);
});
