// Which names the server answers to. A website can point its own domain at this computer's address
// (DNS rebinding), but the browser still sends that domain in the Host header, so checking it blocks the trick.

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
