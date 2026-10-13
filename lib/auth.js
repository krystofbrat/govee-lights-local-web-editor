// The optional PIN. Only a salted scrypt hash is stored. A device that enters the right PIN gets a cookie
// signed with a secret that changes with the PIN, so changing the PIN logs every device out.
import { scrypt, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { UserError } from './devices.js';
import { fromThisComputer } from './hosts.js';

export const COOKIE = 'lights_session';
export const SESSION_DAYS = 365;
const FREE_TRIES = 5;    // wrong PINs in a row before each new try has to wait
const WAIT = 30_000;

const hashOf = (pin, salt) => new Promise((resolve, reject) =>
  scrypt(pin, salt, 64, (err, key) => (err ? reject(err) : resolve(key))));
const sameBytes = (a, b) => a.length === b.length && timingSafeEqual(a, b);

export const validPin = (pin) => /^\d{4,12}$/.test(String(pin ?? ''));

export class Pin {
  constructor(store) {
    this.store = store;
    this.fails = 0;     // wrong tries in a row, from anywhere: an attacker could use many addresses
    this.lastFail = 0;
  }

  get enabled() { return !!this.store.data.pin?.hash; }

  async set(pin) {
    if (!validPin(pin)) throw new UserError('The PIN must be 4 to 12 digits');
    const salt = randomBytes(16);
    this.store.data.pin = {
      salt: salt.toString('hex'),
      hash: (await hashOf(String(pin), salt)).toString('hex'),
      secret: randomBytes(32).toString('hex'),
    };
    this.fails = 0;
    this.store.save();
  }

  remove() {
    this.store.data.pin = null;
    this.store.save();
  }

  /** Is this the PIN? After 5 wrong tries, each try must wait 30 s after the last wrong one (429 until then). */
  async check(pin, now = Date.now()) {
    if (!this.enabled) return true;
    if (this.fails >= FREE_TRIES) {
      const wait = this.lastFail + WAIT - now;
      if (wait > 0) throw new UserError(`Too many wrong PINs. Try again in ${Math.ceil(wait / 1000)} s`, 429);
    }
    // Count it as wrong until proven right, so many tries sent at once can't all get in before the wait
    this.fails++;
    this.lastFail = now;
    const { salt, hash } = this.store.data.pin;
    const ok = validPin(pin) && sameBytes(await hashOf(String(pin), Buffer.from(salt, 'hex')), Buffer.from(hash, 'hex'));
    if (ok) this.fails = 0;
    return ok;
  }

  // ---------- sessions ----------

  sign(issued) { return createHmac('sha256', this.store.data.pin.secret).update(issued).digest('base64url'); }

  /** A cookie value for a device that just gave the right PIN */
  token(now = Date.now()) {
    const issued = now.toString(36);
    return `${issued}.${this.sign(issued)}`;
  }

  validToken(token, now = Date.now()) {
    if (!this.enabled || typeof token !== 'string') return false;
    const [issued, mac] = token.split('.');
    const at = parseInt(issued, 36);
    if (!mac || !Number.isFinite(at) || now - at > SESSION_DAYS * 864e5 || at > now + 60_000) return false;
    return sameBytes(Buffer.from(mac), Buffer.from(this.sign(issued)));
  }

  cookie(token) {
    return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
  }

  /**
   * May this request use the API? Yes without a PIN, from this computer, with a session cookie, or with the
   * PIN in a header (Authorization: Bearer <pin>, or X-Lights-Pin) for Shortcuts and curl. Wrong header PINs
   * count as wrong tries.
   */
  async allowed(req) {
    if (!this.enabled || fromThisComputer(req)) return true;
    if (this.validToken(cookieValue(req.headers.cookie, COOKIE))) return true;
    const header = req.headers['x-lights-pin'] ?? String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1];
    return header != null && this.check(String(header));
  }
}

export function cookieValue(header = '', name) {
  for (const part of String(header).split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
