// Which names the server answers to, and whether a request comes from this computer. A website can point its
// own domain at this computer's address (DNS rebinding), but the browser still sends that domain in the Host
// header, so checking it blocks the trick.

/** The name in a Host header, lowercased, without port or trailing dot ("[::1]:8420" → "::1"); null if malformed */
export function hostname(host) {
  const m = String(host ?? '').trim().toLowerCase().match(/^(?:\[([0-9a-f:.]+)\]|([^:[\]\s]+))(?::\d+)?$/);
  return m ? (m[1] ?? m[2]).replace(/\.$/, '') : null;
}

/** LIGHTS_ALLOWED_HOSTS: "lights.example.com, mac.lan:8420" → ['lights.example.com', 'mac.lan'] */
export function parseHostList(list = '') {
  return String(list).split(',').map(hostname).filter(Boolean);
}

/**
 * me: this computer's name (os.hostname()). extra: exact names from LIGHTS_ALLOWED_HOSTS.
 * Raw IPs are fine: a rebinding site can't make the browser send an IP as the Host.
 */
export function hostAllowed(host, { me = '', extra = [] } = {}) {
  const name = hostname(host);
  if (!name) return false;
  const self = hostname(me)?.replace(/\.local$/, '');
  return name === 'localhost' || name.endsWith('.local') || name === self ||
    // Tailscale MagicDNS. Tailscale controls ts.net, so other sites can't point those names at this computer
    name.endsWith('.ts.net') ||
    /^[\d.]+$/.test(name) || name.includes(':') || extra.includes(name);
}

// ---------- where a request comes from ----------

export const isLoopback = (addr = '') => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

/**
 * Made on this computer itself. A proxy running here (like `tailscale serve`) also connects from 127.0.0.1,
 * but adds a forwarding header, and what it passes on may come from anywhere.
 */
export function fromThisComputer(req) {
  const h = req.headers || {};
  return isLoopback(req.socket?.remoteAddress) && !h['x-forwarded-for'] && !h.forwarded && !h['x-real-ip'];
}
