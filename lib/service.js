// The macOS launchd service that starts the server at login (`lights service install`).

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The LIGHTS_* settings in an environment, saved with the service so they still apply at login and after
 * `lights restart`. Not GOVEE_API_KEY: the service file is readable by other users, and the key is in data/.
 */
export function serviceEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env)
    .filter(([k, v]) => /^LIGHTS_[A-Z0-9_]+$/.test(k) && v != null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b)));
}

/** The service file (launchd plist) */
export function servicePlist({ label, node, server, root, log, env = {} }) {
  const vars = Object.entries(env);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(server)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
${vars.length ? `  <key>EnvironmentVariables</key>
  <dict>
${vars.map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>`).join('\n')}
  </dict>
` : ''}  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}
