// Govee LAN API — https://app-h5.govee.com/user-manual/wlan-guide
// Devices must have "LAN Control" switched on in the Govee Home app.
import dgram from 'node:dgram';
import os from 'node:os';
import { EventEmitter } from 'node:events';

const MULTICAST = '239.255.255.250';
const SCAN_PORT = 4001;   // devices listen for scans here
const LISTEN_PORT = 4002; // devices answer here
const CMD_PORT = 4003;    // devices accept commands here

export class Lan extends EventEmitter {
  constructor() {
    super();
    this.ready = false;
    this.error = null;
    this.byIp = new Map(); // ip -> deviceId, devStatus replies only carry the sender address
  }

  start() {
    return new Promise((resolve) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.sock = sock;
      sock.on('message', (buf, rinfo) => this.onMessage(buf, rinfo));
      sock.on('error', (err) => {
        this.error = err.code === 'EADDRINUSE'
          ? `UDP port ${LISTEN_PORT} is busy (another Govee app/Homebridge running?)`
          : err.message;
        this.ready = false;
        resolve(false);
      });
      sock.bind(LISTEN_PORT, () => {
        try { sock.addMembership(MULTICAST); } catch {}
        this.ready = true;
        this.error = null;
        resolve(true);
      });
    });
  }

  onMessage(buf, rinfo) {
    let msg;
    try { msg = JSON.parse(buf.toString()).msg; } catch { return; }
    if (!msg?.cmd) return;
    // Anything on the network can send these, so only accept well-formed values
    if (msg.cmd === 'scan' && msg.data?.device) {
      const d = msg.data;
      const id = String(d.device).toUpperCase();
      if (!/^[0-9A-F:]{8,40}$/.test(id)) return;
      const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(d.ip) ? d.ip : rinfo.address;
      this.byIp.set(ip, id);
      this.emit('device', { id, ip, sku: /^[\w-]{1,20}$/.test(d.sku) ? d.sku : '' });
    } else if (msg.cmd === 'devStatus' && msg.data) {
      const id = this.byIp.get(rinfo.address);
      if (!id) return;
      const s = msg.data;
      const kelvin = Math.round(+s.colorTemInKelvin) || 0;
      const brightness = Math.round(+s.brightness);
      this.emit('status', id, {
        power: s.onOff === 1 || s.onOff === true,
        brightness: Number.isFinite(brightness) ? brightness : null,
        color: s.color && !kelvin ? hex(s.color) : null,
        kelvin: kelvin > 0 ? kelvin : null,
      });
    }
  }

  async scan() {
    if (!this.ready) return;
    const payload = Buffer.from(JSON.stringify({ msg: { cmd: 'scan', data: { account_topic: 'reserve' } } }));
    // Send on every interface so it works with Ethernet + Wi-Fi or a VPN active
    const addrs = Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    for (const addr of addrs.length ? addrs : [null]) {
      try {
        if (addr) this.sock.setMulticastInterface(addr);
        await new Promise((r) => this.sock.send(payload, SCAN_PORT, MULTICAST, () => r()));
      } catch {}
    }
  }

  send(ip, cmd, data) {
    if (!this.ready) throw new Error(this.error || 'LAN not ready');
    const payload = Buffer.from(JSON.stringify({ msg: { cmd, data } }));
    return new Promise((resolve, reject) => {
      this.sock.send(payload, CMD_PORT, ip, (err) => (err ? reject(err) : resolve()));
    });
  }

  turn(ip, on) { return this.send(ip, 'turn', { value: on ? 1 : 0 }); }
  brightness(ip, value) { return this.send(ip, 'brightness', { value }); }
  color(ip, { r, g, b }, kelvin = 0) { return this.send(ip, 'colorwc', { color: { r, g, b }, colorTemInKelvin: kelvin }); }
  status(ip) { return this.send(ip, 'devStatus', {}).catch(() => {}); }
}

const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.min(255, Math.max(0, Math.round(+v) || 0)).toString(16).padStart(2, '0')).join('');
