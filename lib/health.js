// How the connections to the lights have been doing lately, for the developer page: cloud requests that worked
// or failed and how long they took, and Wi-Fi scans and who answered them. Kept in memory for 24 hours.

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export class Health {
  constructor() {
    this.cloud = [];   // { t, ok, ms, error }
    this.scans = [];   // { t, interfaces }: scans sent
    this.answers = []; // { t, ip }: lights answering a scan
  }

  prune(now = Date.now()) {
    for (const list of [this.cloud, this.scans, this.answers]) {
      let i = 0;
      while (i < list.length && now - list[i].t > DAY) i++;
      if (i) list.splice(0, i);
    }
  }

  /** A cloud request and Govee's answer, as CloudApi's onTraffic reports it */
  cloudRequest({ status, ms, error }, now = Date.now()) {
    this.cloud.push({ t: now, ok: !error && status >= 200 && status < 300, ms, error: error || null });
    this.prune(now);
  }

  /** A LAN message, as Lan's 'traffic' event reports it. Only scans and their answers count. */
  lan({ dir, cmd, ip, data }, now = Date.now()) {
    if (cmd !== 'scan') return;
    if (dir === 'out') this.scans.push({ t: now, interfaces: data?.interfaces || [] });
    else this.answers.push({ t: now, ip });
    this.prune(now);
  }

  view(now = Date.now()) {
    const recent = (list, ms) => list.filter((x) => now - x.t <= ms);
    const cloud = (ms) => {
      const all = recent(this.cloud, ms);
      const times = all.filter((x) => x.ok).map((x) => x.ms).sort((a, b) => a - b);
      const failed = all.filter((x) => !x.ok);
      return {
        requests: all.length,
        failed: failed.length,
        median: times.length ? times[Math.floor(times.length / 2)] : null,
        slowest: times.length ? times.at(-1) : null,
        lastFailure: failed.length ? { t: failed.at(-1).t, error: failed.at(-1).error } : null,
      };
    };
    const lan = (ms) => {
      const answers = recent(this.answers, ms);
      return { scans: recent(this.scans, ms).length, answers: answers.length, from: [...new Set(answers.map((x) => x.ip))] };
    };
    return {
      hour: { cloud: cloud(HOUR), lan: lan(HOUR) },
      day: { cloud: cloud(DAY), lan: lan(DAY) },
      lastScan: this.scans.at(-1) || null,
      lastAnswer: this.answers.at(-1) || null,
    };
  }
}
