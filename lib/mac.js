// The bits of macOS the alarms care about: is the Mac on battery (so it may sleep), and showing a notification.
import { execFile } from 'node:child_process';

const isMac = process.platform === 'darwin';

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 5000 }, (err, out) => resolve(err ? null : String(out)));
});

/** true on battery, false on power, null if unknown (not a Mac, or no battery) */
export async function onBattery() {
  if (!isMac) return null;
  const out = await run('/usr/bin/pmset', ['-g', 'batt']);
  if (!out) return null;
  if (out.includes("'Battery Power'")) return true;
  if (out.includes("'AC Power'")) return false;
  return null;
}

/** A macOS notification. The text goes in as arguments, never into the script itself. */
export function notifyMac(title, text) {
  if (!isMac || process.env.LIGHTS_NO_NOTIFY) return;
  execFile('/usr/bin/osascript', [
    '-e', 'on run argv',
    '-e', 'display notification (item 2 of argv) with title (item 1 of argv)',
    '-e', 'end run',
    String(title), String(text),
  ], { timeout: 5000 }, () => {});
}
