# Lights

[![CI](https://github.com/krystofbrat/govee-lights-local-web-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/krystofbrat/govee-lights-local-web-editor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A web app and `lights` terminal command for Govee lights, with sunrise alarms, sleep timers, groups, favorites and Siri. It runs on your own computer and has **no dependencies** besides Node.js: no `npm install`, no database, no account besides your Govee one.

> Not affiliated with or endorsed by Govee. It uses Govee's public developer API and the LAN protocol their lights speak.

## Screenshots

<p align="center">
  <img src="docs/screenshots/lights.png" width="240" alt="The Lights tab on a phone: each light with its color, brightness and power switch, and one-tap looks">
  <img src="docs/screenshots/color-wheel.png" width="240" alt="One light's controls: a color wheel to drag on, with brightness and white sliders">
  <img src="docs/screenshots/alarms.png" width="240" alt="The Alarms tab: a sunrise fade on weekdays, and lights that come on 30 minutes before sunset">
</p>
<p align="center">
  <img src="docs/screenshots/try-scene.gif" width="300" alt="Trying a Govee scene: the lights show it for 10 seconds, then go back unless you tap Keep">
</p>

## What it does

- **Local Wi-Fi (LAN) control**: on/off, brightness, color and white respond instantly and work without internet.
- **Govee cloud API**: Govee scenes, DIY scenes and snapshots, music mode, per-segment colors, and lights that don't have LAN Control.
- **Alarms**: sunrise fade to wake up (deep red → warm → bright white), turn on, turn off with a fade-out, per weekday. At a clock time, or with the real sun: “30 minutes before sunset”, “at sunrise”.
- **One-tap looks** (Bright, Relax, Focus, Movie, Night light) next to your own favorites, and a drag-to-pick **color wheel**.
- **Try before you keep**: trying a scene or color shows it for 10 seconds, then goes back unless you keep it.
- **My scenes**: every scene you turn on is saved, so it's one tap away next time. *Edit* in the scene list deletes scenes you don't want, including Govee's own ones (only from this app; Govee keeps them, so they can be brought back).
- **Save what's on now**: keeps every light's own color and brightness as one favorite, including looks set in the Govee app (Govee's API doesn't share the scenes you make in their app, so this is how to bring them over).
- **Siri and Shortcuts**: "Hey Siri, movie mode" turns on a favorite, with the same words as the terminal command.
- **Sleep timers**, **groups/rooms**, **favorites**, and a phone-friendly UI (open it on your phone, then *Add to Home Screen*). Open pages reload by themselves after an update.

## Requirements

- **Node.js 20 or newer** (`node -v` to check). Get it from [nodejs.org](https://nodejs.org) or `brew install node`.
- **Govee Wi-Fi lights.** Bluetooth-only models can't be controlled.
- **macOS** for the full experience. The server itself runs anywhere Node does (Linux, a Raspberry Pi, Windows), but `lights service` (start at login) and keeping the computer awake for alarms are macOS only. Elsewhere, run `node server.js` from systemd or your init system of choice.
- At least one of:
  - a **Govee API key** (free, needed for scenes and for lights without LAN Control), or
  - **LAN Control** switched on for your lights (works with no key and no internet).

## Install

```sh
git clone https://github.com/krystofbrat/govee-lights-local-web-editor.git
cd govee-lights-local-web-editor
npm link                    # puts the `lights` command on your PATH
```

Then:

1. **Get an API key**: Govee Home app → Profile → ⚙ Settings → *Apply for API Key*. It arrives by email, usually within minutes.
2. **Turn on LAN Control** (optional but faster): Govee Home app → each light → ⚙ → *LAN Control*. Not every model has it; those still work through the cloud.
3. Run:

   ```sh
   lights service install      # macOS: starts the server at login, so alarms always fire
   lights key <your-api-key>   # checks the key, then saves it
   lights open                 # opens http://localhost:8420
   ```

Not on macOS, or don't want it running at login? `npm start` (or `node server.js`) runs the server in the foreground. Any `lights` command also starts it in the background if it isn't running.

To use it from your phone, open the address the server prints at startup (like `http://192.168.1.20:8420`) on the same Wi-Fi.

## Terminal

```sh
lights                         # status of every light
lights off                     # everything off
lights bedroom on              # a light or group, partial names work
lights desk 40                 # brightness
lights red | lights warm       # color / white (also "#ff8800", 2700)
lights scene aurora            # Govee scene
lights fav cozy                # apply a favorite
lights sleep 30                # fade out over 30 min, then off
lights alarm add 6:45 wake weekdays --for 30   # sunrise fade, done at 6:45
lights alarm add 23:30 off daily --for 15 --lights bedroom
lights alarm add sunset-30 on --fav cozy       # 30 min before the sun sets
lights location 50.08 14.43    # where you are, for sunrise/sunset times
lights pin 482193              # other devices need this PIN (lights pin off)
lights alarms                  # list; lights alarm off|on|rm|test <n>
lights group add bedroom lamp strip
lights restart | logs          # server control
lights dev                     # developer page: see how it works
lights help                    # everything else
```

## Siri and Shortcuts

Anything the `lights` command can do, an Apple Shortcut can do too, so Siri can. For example, **"Hey Siri, movie mode"**:

1. In the web app, set your lights the way you like them for a movie. On the Lights tab, tap **★ Save what's on now** and name it **Movie**.
2. Find your computer's name: on the Mac, *System Settings → General → Sharing*, at the bottom (like `My-Mac.local`). The address under *Settings → On your phone* in the web app works too, but it can change when your router restarts.
3. On your iPhone, open **Shortcuts**, tap **+**, then **Add Action** and choose **Get Contents of URL**.
4. Tap **URL** and type `http://My-Mac.local:8420/api/shortcut`, with your computer's name.
5. Tap **›** next to it to show more options:
   - **Method**: `POST`
   - **Headers** (only if you set a PIN): add `X-Lights-Pin` with your PIN as the value
   - **Request Body**: `JSON`. Add two **Text** fields: `target` = `all`, and `do` = `movie`
6. Optional, so Siri tells you how it went: add **Get Dictionary Value** (key `message`), then **Speak Text**.
7. Rename the shortcut to **Movie mode** (tap its name at the top). Now say *"Hey Siri, movie mode"*.

The phone has to be on the same Wi-Fi as the computer, or connected to it with Tailscale.

**`target`** is a light or group, by name (`bedroom`; part of a name works) or `all`. **`do`** takes the same words as the terminal command:

| `do` | What happens |
| --- | --- |
| `on`, `off`, `toggle` | Power |
| `40` | Brightness 40% (`0` is off) |
| `warm`, `cool`, `2700` | White |
| `red`, `#ff8800` | Color |
| `warm 40`, `red 10` | Both at once |
| `movie`, `fav movie` | A favorite (with no favorite by that name: a Govee scene) |
| `scene aurora` | A Govee scene |
| `music` | Music mode |

The answer is JSON, with a sentence in `message` (like `Desk and Lamp: ★ Movie`) and how each light did in `results`. From a terminal on another computer:

```sh
curl -X POST http://My-Mac.local:8420/api/shortcut \
  -H 'Content-Type: application/json' -H 'X-Lights-Pin: 482193' \
  -d '{"target": "bedroom", "do": "off"}'
```

It only takes POST with a JSON body, so other websites can't trigger it. `POST /api/control` works from Shortcuts too, if you'd rather build the full action yourself (see the API tab of the developer page).

## Things to know

**Alarms run on your computer, not on the lights.** Govee doesn't let other apps write the timers stored on the light, so the server has to be running when an alarm is due. On macOS it keeps the Mac from sleeping on its own **while it's plugged in** (`caffeinate -s`). On battery or with the lid closed, a MacBook sleeps and alarms won't fire. To let the Mac sleep anyway, set `LIGHTS_ALLOW_SLEEP=1`.

**Anyone on your Wi-Fi can use it, unless you set a PIN.** The server listens on your local network so your phone can reach it, so without a PIN anyone on the same network can open the web app and control your lights. To keep them out, set one in *Settings → PIN* or with `lights pin <4-12 digits>`:

- Phones and other computers ask for it once, then stay unlocked for a year. Changing the PIN logs them all out.
- This computer never needs it, so the `lights` command and the developer page keep working. Requests passed on by a proxy running on this computer (like `tailscale serve`) still need it.
- Only a salted hash of the PIN is stored, never the PIN. After 5 wrong tries in a row, each try has to wait 30 seconds.
- Shortcuts and `curl` from other devices send it in a header: `Authorization: Bearer <pin>` or `X-Lights-Pin: <pin>`.
- Forgot it? Run `lights pin off` (or `lights pin <new>`) on the computer.
- The connection is plain HTTP, so someone who can watch your Wi-Fi traffic could still see the PIN. It keeps out guests and housemates, not a determined attacker on your network.

Either way, requests from other websites and DNS-rebinding tricks are blocked, and the browser only ever sees the last 4 characters of your API key. **Don't port-forward 8420 or expose it to the internet.** For access away from home, use a VPN such as Tailscale: open the computer's Tailscale name (like `http://mymac.tail1234.ts.net:8420`) or its 100.x address.

**Your data stays in `data/`.** Settings, alarms, groups, favorites, your location (rounded to about 1 km), the API key and the log live in `data/lights.json` (file mode 600) and `data/server.log`. The folder is in `.gitignore`; never commit it.

**Alarms at sunrise or sunset** follow the real sun where you are: set your location in *Settings → Location* or with `lights location <latitude> <longitude>`, then pick *Sun rises* or *Sun sets* in the alarm, up to 4 hours before or after. The times are worked out on your computer (NOAA's formula, no internet needed) and change every day. Near the poles, days without a sunrise or sunset are skipped and logged. A *sunrise fade* is different: it's the wake-up fade from red to white, and it can end at any time, including at sunrise.

**Cloud limits.** Govee allows 10,000 cloud requests per day per key and limits how fast each light can be changed. The app queues commands per light and prefers LAN when it can. Settings shows today's count.

**What Govee's API can't do** (so neither can this app):

- Scenes you build in the Govee app (Tap-to-Run, many DIY scenes) aren't exposed to the API. Use *Save what's on now* instead.
- Lights report their color and brightness, but not which scene is playing.
- Scene pictures come from the library the Govee phone app uses. That isn't part of the official API; if it stops working, scenes simply show without pictures.

## Configuration

Everything is set in the app or with `lights` commands. These environment variables override it:

| Variable | Default | What it does |
| --- | --- | --- |
| `LIGHTS_PORT` | `8420` | Port for the web app and API |
| `LIGHTS_DATA_DIR` | `./data` | Where settings, the API key and logs are stored |
| `GOVEE_API_KEY` | | API key to use if none is saved yet |
| `LIGHTS_ALLOW_SLEEP` | | Set to `1` to let the Mac sleep (alarms may not fire) |
| `LIGHTS_ALLOWED_HOSTS` | | Extra host names the web app may be opened at, comma-separated (like `lights.example.com,mac.lan`). Exact names only. `localhost`, `*.local`, `*.ts.net`, this computer's name and IP addresses always work |
| `NO_COLOR` | | Turns off colors in `lights` output |

On macOS, `lights service install` saves the `LIGHTS_*` variables that are set when you run it, so they still apply at login and after `lights restart`. `lights service status` shows them. To change them, set them and run `lights service install` again; to drop one, unset it first. Keep `LIGHTS_PORT` and `LIGHTS_DATA_DIR` in your shell profile too (like `~/.zshrc`), because `lights` commands need them to find the server. `GOVEE_API_KEY` is never saved there: the service file is readable by other users on the Mac, and the key is already kept safely in `data/`.

## Troubleshooting

- **No lights found**: check the API key (`lights key <key>`), switch on LAN Control, then `lights refresh`. The computer must be on the same network as the lights for LAN.
- **"UDP port 4002 is busy"**: another Govee integration (Homebridge, Home Assistant on the same machine) is using the LAN port. Stop it, or rely on the cloud.
- **A light shows "offline"**: it's unplugged, off Wi-Fi, or Govee's cloud is down. Lights you've used before stay listed; *Forget* one in Settings once you no longer have it.
- **"Govee rate limit reached"**: wait a minute; see *Cloud limits* above.
- **Alarm didn't fire**: was the server running and the computer awake? `lights service status` and `lights logs` will tell you.
- **"Unknown host"**: the app was opened at a name it doesn't know, like a custom DNS name or a reverse proxy. To keep other websites out, it only answers to `localhost`, `*.local`, Tailscale `*.ts.net` names, this computer's name and IP addresses. Add other names to `LIGHTS_ALLOWED_HOSTS`.
- **Changed the code?** `lights restart`.

## Developer page

Open `http://localhost:8420/dev` (or run `lights dev`, or *Settings → Developer page*) to watch the server work while it runs:

- **Overview**: how a command travels from the app to a light, live status of Local Wi-Fi and the cloud, and the timings it uses.
- **Lights**: what the server knows about each light, why it uses Local Wi-Fi or the cloud for it, its cloud queue, and the raw JSON.
- **Traffic**: every message to and from the lights, LAN and cloud, with the exact payload and Govee's answer.
- **Events**: what the server pushes to open pages, and what changed each time.
- **Console**: the server's recent output.
- **API**: every route, with a working example. Send it from the page or copy it as `curl`.

It's read-only except for the API tab, whose requests are real and change your lights. It only works on the computer running the server (other devices on your Wi-Fi get a "not here" message), and it never shows the API key.

## How it's built

```text
server.js           HTTP API, live updates (server-sent events) and the alarm scheduler
bin/lights.js       the `lights` CLI; talks to the server over HTTP
lib/lan.js          Govee LAN protocol (UDP multicast scan on 4001, replies on 4002, commands on 4003)
lib/cloud.js        Govee Developer API v2 client
lib/devices.js      merges LAN and cloud lights and sends each command over the fastest route
lib/fades.js        sunrise and fade-out engine
lib/scheduler.js    alarms and sleep timers
lib/trial.js        "try" a look for a few seconds, then undo or keep
lib/library.js      scene pictures and categories (optional)
lib/store.js        reads and writes data/lights.json
lib/hosts.js        which host names the server answers to (blocks DNS rebinding), and requests from this computer
lib/auth.js         the optional PIN: hashing, login cookies and slowing down guessing
lib/service.js      the macOS start-at-login service file, with saved LIGHTS_* settings
lib/commands.js     what words like "off", "40", "warm" or "fav cozy" mean, for the CLI and Siri/Shortcuts
lib/util.js         colors, times, sunrise/sunset and parsing, shared with the web app
public/             the web app and the developer page at /dev (plain HTML, CSS and JavaScript, no build step)
test/               tests for colors, times, sun times, light names, alarms, host names, the PIN, command words and the service file (npm test)
```

No frameworks and no build step: edit a file, run `lights restart`, and open pages reload themselves.

## Contributing

Bug reports, ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to work on the code and run the tests. To report a security problem, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
