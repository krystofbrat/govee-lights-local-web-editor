// What the words in `lights [light] <words>` and in POST /api/shortcut mean, shared by the CLI and the server.
import { COLORS, TEMPS, parseColor, parseKelvin } from './util.js';

export const isValueWord = (w) => /^\d{1,4}%?k?$/i.test(w) || /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(w) ||
  !!COLORS[w.toLowerCase()] || !!TEMPS[w.toLowerCase()];

/** A brightness ("40", "0" = off), white ("warm", "2700") or color ("red", "#ff8800") → [action, label]; null if not */
export function valueAction(w) {
  const l = w.toLowerCase().replace(/%$/, '');
  if (/^\d{1,3}$/.test(l)) {
    const n = +l;
    return n === 0 ? [{ power: false }, 'off'] : [{ brightness: Math.min(100, n) }, `${Math.min(100, n)}%`];
  }
  const k = parseKelvin(l);
  if (k) return [{ kelvin: k }, `${TEMPS[l] ? l + ' white' : 'white'} ${k}K`];
  const c = parseColor(l);
  if (c) return [{ color: c }, COLORS[l] ? l : c];
  return null;
}

/**
 * "off", "on", "toggle", "40", "warm", "red", "warm 40", "scene aurora", "fav cozy", "music [mode]",
 * "bright 30", "color blue", "temp cool" → { action, label }. Any other text ("movie") is a favorite, or else
 * a Govee scene, like `lights movie` (action.preset). null for empty text.
 */
export function parseDo(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const cmd = words[0].toLowerCase();
  const rest = words.slice(1).join(' ');
  const simple = { on: [{ power: true }, 'on'], off: [{ power: false }, 'off'], toggle: [{ power: 'toggle' }, 'toggled'] };
  if (simple[cmd] && !rest) return { action: simple[cmd][0], label: simple[cmd][1] };
  if (rest) {
    if (cmd === 'scene') return { action: { scene: rest }, label: `scene ${rest}` };
    if (cmd === 'fav' || cmd === 'favorite') return { action: { favorite: rest }, label: `★ ${rest}` };
    if (cmd === 'color' || cmd === 'temp' || cmd === 'bright' || cmd === 'brightness' || cmd === 'dim') {
      const v = valueAction(rest);
      if (v) return { action: v[0], label: v[1] };
    }
  }
  if (cmd === 'music') return { action: { music: rest }, label: `music${rest ? ` ${rest}` : ''}` };
  // "on 40", "warm 40", "red 10": every word a value, all applied together
  const values = (simple[cmd] && cmd !== 'off' ? words.slice(1) : words);
  if (values.length && values.every(isValueWord)) {
    const parts = values.map(valueAction);
    if (parts.every(Boolean)) return { action: Object.assign(cmd === 'on' ? { power: true } : {}, ...parts.map((p) => p[0])), label: parts.map((p) => p[1]).join(', ') };
  }
  return { action: { preset: words.join(' ') }, label: words.join(' ') };
}
