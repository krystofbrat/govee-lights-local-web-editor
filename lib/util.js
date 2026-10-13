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

/** The light state at progress t (0..1) of a sunrise: deep red → orange → warm white → endKelvin. */
export function sunriseFrame(t, endBrightness = 100, endKelvin = 4000) {
  const eased = t * t; // perceived brightness is non-linear, so start very slowly
  const brightness = Math.max(1, Math.round(1 + (endBrightness - 1) * eased));
  if (t < 0.3) return { brightness, color: mixHex('#ff1e00', '#ff7a1a', t / 0.3) };
  const u = (t - 0.3) / 0.7;
  return { brightness, kelvin: Math.round(lerp(2000, endKelvin, u) / 50) * 50 };
}
