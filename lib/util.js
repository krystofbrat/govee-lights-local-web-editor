// Shared helpers. Also served to the browser at /shared/util.js, so keep this free of Node imports.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const lerp = (a, b, t) => a + (b - a) * t;

export const COLORS = {
  red: '#ff0000', crimson: '#ff0a3c', orange: '#ff5a00', amber: '#ff9500', gold: '#ffbf00',
  yellow: '#ffe100', lime: '#9cff00', green: '#00ff3c', mint: '#00ff9d', teal: '#00ffd5',
  cyan: '#00d5ff', sky: '#0088ff', blue: '#0022ff', indigo: '#4400ff', purple: '#8800ff',
  violet: '#bb00ff', magenta: '#ff00cc', pink: '#ff2d8a', rose: '#ff5577',
};

export const TEMPS = {
  candle: 2000, warm: 2700, soft: 3200, neutral: 4000, white: 4500, daylight: 5500, cool: 6500, cold: 8000,
};

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_SETS = { daily: [0, 1, 2, 3, 4, 5, 6], weekdays: [1, 2, 3, 4, 5], weekends: [0, 6] };

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const hexToInt = (hex) => parseInt(hex.slice(1), 16);
export const intToHex = (n) => '#' + ((n >>> 0) & 0xffffff).toString(16).padStart(6, '0');

export function mixHex(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex(lerp(x.r, y.r, t), lerp(x.g, y.g, t), lerp(x.b, y.b, t));
}

/** Accepts a color name, #rgb, #rrggbb or "r,g,b". Returns #rrggbb or null. */
export function parseColor(input) {
  if (input == null) return null;
  let s = String(input).trim().toLowerCase();
  if (COLORS[s]) return COLORS[s];
  if (/^#?[0-9a-f]{6}$/.test(s)) return '#' + s.replace('#', '');
  if (/^#?[0-9a-f]{3}$/.test(s)) {
    s = s.replace('#', '');
    return '#' + [...s].map((c) => c + c).join('');
  }
  const m = s.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (m) return rgbToHex(+m[1], +m[2], +m[3]);
  return null;
}

/** Accepts a temperature name ("warm") or a number ("2700", "2700k"). Returns Kelvin or null. */
export function parseKelvin(input) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase();
  if (TEMPS[s]) return TEMPS[s];
  if (!/^\d{4}k?$/.test(s)) return null;
  return clamp(parseInt(s, 10), 2000, 9000);
}

/** Approximate RGB of a black-body at the given Kelvin (Tanner Helland). */
export function kelvinToRgb(k) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  return { r: Math.round(clamp(r, 0, 255)), g: Math.round(clamp(g, 0, 255)), b: Math.round(clamp(b, 0, 255)) };
}

export const kelvinToHex = (k) => { const { r, g, b } = kelvinToRgb(k); return rgbToHex(r, g, b); };

/** The same color at `factor` (0-1) of its strength. Its brightest channel stays at least 1, so it isn't black. */
export function scaleHex(hex, factor) {
  const { r, g, b } = hexToRgb(hex);
  const k = Math.max(factor, 1 / (Math.max(r, g, b) || 1));
  return rgbToHex(r * k, g * k, b * k);
}

export function hsvToHex(h, s, v = 1) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
}

export function hexToHsv(hex) {
  const { r, g, b } = hexToRgb(hex);
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function parseTime(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = +m[1];
  const min = +(m[2] ?? 0);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function describeDays(days) {
  if (!days?.length) return 'Once';
  const set = [...days].sort((a, b) => a - b).join(',');
  if (set === '0,1,2,3,4,5,6') return 'Every day';
  if (set === '1,2,3,4,5') return 'Weekdays';
  if (set === '0,6') return 'Weekends';
  // Monday-first ordering reads more naturally
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => DAY_NAMES[d]).join(', ');
}

/** An alarm's days grouped by the time it runs on them (`times` gives some days their own), Monday first: [{ time, days }] */
export function dayTimeGroups({ days, time, times }) {
  const groups = new Map();
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    if (!days.includes(d)) continue;
    const t = times?.[d] || time;
    groups.set(t, [...(groups.get(t) || []), d]);
  }
  return [...groups].map(([t, ds]) => ({ time: t, days: ds }));
}

/** The light state at progress t (0..1) of a sunrise: deep red → orange → warm white → endKelvin. */
export function sunriseFrame(t, endBrightness = 100, endKelvin = 4000) {
  const eased = t * t; // perceived brightness is non-linear, so start very slowly
  const brightness = Math.max(1, Math.round(1 + (endBrightness - 1) * eased));
  if (t < 0.3) return { brightness, color: mixHex('#ff1e00', '#ff7a1a', t / 0.3) };
  const u = (t - 0.3) / 0.7;
  return { brightness, kelvin: Math.round(lerp(2000, endKelvin, u) / 50) * 50 };
}

// ---------- the sun ----------

const RAD = Math.PI / 180;
export const SUN_OFFSET_MAX = 240; // minutes before/after sunrise or sunset an alarm may be

/** Sun position on a Julian day (NOAA's formulas): declination in degrees, equation of time in minutes */
function solar(jd) {
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime = (4 / RAD) * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) +
    4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) -
    1.25 * e * e * Math.sin(2 * M * RAD));
  return { decl, eqTime };
}

/**
 * Sunrise and sunset (ms timestamps) on the calendar day of `date` (local time) at lat/lon, from NOAA's
 * solar calculator. Both are null when the sun stays up (polar: 'day') or down (polar: 'night') all day.
 */
export function sunTimes(date, lat, lon) {
  const day0 = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const jd0 = day0 / 864e5 + 2440587.5;
  const event = (sign) => {
    let t = 720 - 4 * lon; // minutes after midnight UTC; start from solar noon, then refine at the event itself
    for (let i = 0; i < 3; i++) {
      const { decl, eqTime } = solar(jd0 + t / 1440);
      const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl * RAD)) - Math.tan(lat * RAD) * Math.tan(decl * RAD);
      if (cosH > 1) return 'night';
      if (cosH < -1) return 'day';
      t = 720 - 4 * lon - eqTime + sign * 4 * (Math.acos(cosH) / RAD);
    }
    return Math.round(day0 + t * 60_000);
  };
  const rise = event(-1), set = event(1);
  const polar = typeof rise === 'string' ? rise : typeof set === 'string' ? set : null;
  return { sunrise: polar ? null : rise, sunset: polar ? null : set, polar };
}

/** "sunset", "sunset-30", "Sunrise + 15 min" → { event, offset } (offset in minutes); null if not a sun time */
export function parseSunTime(input) {
  const m = String(input ?? '').trim().toLowerCase().match(/^(sunrise|sunset)\s*(?:([+-])\s*(\d{1,3})\s*(?:m|mins?|minutes?)?)?$/);
  if (!m) return null;
  const offset = m[2] ? (m[2] === '-' ? -1 : 1) * +m[3] : 0;
  return Math.abs(offset) <= SUN_OFFSET_MAX ? { event: m[1], offset } : null;
}

export const sunTimeText = ({ event, offset }) => event + (offset ? (offset > 0 ? '+' : '-') + Math.abs(offset) : '');

/** An alarm time: "07:30" (any form parseTime takes) or a sun time ("sunset-30"), normalized; null if neither */
export function parseAlarmTime(input) {
  const sun = parseSunTime(input);
  return sun ? sunTimeText(sun) : parseTime(input);
}

/** "sunset-30" → "30 min before sunset", "sunrise" → "at sunrise" */
export function describeSunTime(time) {
  const sun = parseSunTime(time);
  if (!sun) return time;
  if (!sun.offset) return `at ${sun.event}`;
  const n = Math.abs(sun.offset), len = n % 60 ? (n > 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n} min`) : `${n / 60} h`;
  return `${len} ${sun.offset < 0 ? 'before' : 'after'} ${sun.event}`;
}

/** "50.08, 14.43", "50,08 14,43" or { lat, lon } → { lat, lon } rounded to ~1 km; null if not a valid place */
export function parseLatLon(input) {
  let lat, lon;
  if (input && typeof input === 'object') ({ lat, lon } = input);
  else {
    const m = String(input ?? '').trim().match(/^(-?\d+(?:[.,]\d+)?)°?\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)°?$/);
    if (!m) return null;
    [lat, lon] = [m[1], m[2]].map((s) => s.replace(',', '.'));
  }
  lat = Number(lat);
  lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // Sun times barely change over a kilometer, so there's no need to keep an exact home address
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
}
