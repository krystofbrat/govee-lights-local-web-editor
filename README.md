# Lights

A web app and `lights` terminal command for Govee lights, with sunrise alarms, sleep timers, groups and favorites. It runs on your own computer and has **no dependencies** besides Node.js: no `npm install`, no database, no account besides your Govee one.

> Not affiliated with or endorsed by Govee. It uses Govee's public developer API and the LAN protocol their lights speak.

## What it does

- **Local Wi-Fi (LAN) control**: on/off, brightness, color and white respond instantly and work without internet.
- **Govee cloud API**: Govee scenes, DIY scenes and snapshots, music mode, per-segment colors, and lights that don't have LAN Control.
- **Alarms**: sunrise wake-up (deep red → warm → bright white), turn on at a time, turn off with a fade-out, per weekday.
- **One-tap looks** (Bright, Relax, Focus, Movie, Night light) next to your own favorites, and a drag-to-pick **color wheel**.
- **Try before you keep**: trying a scene or color shows it for 10 seconds, then goes back unless you keep it.
- **My scenes**: every scene you turn on is saved, so it's one tap away next time. *Edit* in the scene list deletes scenes you don't want, including Govee's own ones (only from this app; Govee keeps them, so they can be brought back).
- **Save what's on now**: keeps every light's own color and brightness as one favorite, including looks set in the Govee app (Govee's API doesn't share the scenes you make in their app, so this is how to bring them over).
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
lights alarm add 6:45 sunrise weekdays --for 30
lights alarm add 23:30 off daily --for 15 --lights bedroom
lights alarms                  # list; lights alarm off|on|rm|test <n>
lights group add bedroom lamp strip
lights restart | logs          # server control
lights help                    # everything else
```

## Things to know

**Alarms run on your computer, not on the lights.** Govee doesn't let other apps write the timers stored on the light, so the server has to be running when an alarm is due. On macOS it keeps the Mac from sleeping on its own **while it's plugged in** (`caffeinate -s`). On battery or with the lid closed, a MacBook sleeps and alarms won't fire. To let the Mac sleep anyway, set `LIGHTS_ALLOW_SLEEP=1`.

**Anyone on your Wi-Fi can use it.** There's no login: the server listens on your local network so your phone can reach it, which means anyone on the same network can open the web app and control your lights. Requests from other websites and DNS-rebinding tricks are blocked, and the browser only ever sees the last 4 characters of your API key. **Don't port-forward 8420 or expose it to the internet.** For access away from home, use a VPN such as Tailscale.

**Your data stays in `data/`.** Settings, alarms, groups, favorites, the API key and the log live in `data/lights.json` (file mode 600) and `data/server.log`. The folder is in `.gitignore`; never commit it.

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
| `NO_COLOR` | | Turns off colors in `lights` output |

## Troubleshooting

- **No lights found**: check the API key (`lights key <key>`), switch on LAN Control, then `lights refresh`. The computer must be on the same network as the lights for LAN.
- **"UDP port 4002 is busy"**: another Govee integration (Homebridge, Home Assistant on the same machine) is using the LAN port. Stop it, or rely on the cloud.
- **A light shows "offline"**: it's unplugged, off Wi-Fi, or Govee's cloud is down. Lights you've used before stay listed; *Forget* one in Settings once you no longer have it.
- **"Govee rate limit reached"**: wait a minute; see *Cloud limits* above.
- **Alarm didn't fire**: was the server running and the computer awake? `lights service status` and `lights logs` will tell you.
- **Changed the code?** `lights restart`.

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
lib/util.js         colors, times and parsing, shared with the web app
public/             the web app (plain HTML, CSS and JavaScript, no build step)
```

No frameworks and no build step: edit a file, run `lights restart`, and open pages reload themselves.
