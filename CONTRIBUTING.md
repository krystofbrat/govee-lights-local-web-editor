# Contributing

Thanks for helping out! Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

[Open an issue](../../issues/new/choose) and pick **Bug report**. The most useful details are the light's model (like H6008), whether it's connected over Local Wi-Fi or the Govee cloud, and what `lights logs` shows (every line has its time). For an alarm, say what its card in the Alarms tab says under it; for a connection problem, what the developer page's Overview shows under *Health* and *Checks*. Never paste your API key or `data/lights.json`.

## Working on the code

There's nothing to install and nothing to build:

```sh
git clone https://github.com/krystofbrat/govee-lights-local-web-editor.git
cd govee-lights-local-web-editor
npm link        # puts the `lights` command on your PATH
lights open     # starts the server and opens the web app
```

After changing a file, run `lights restart`. Open pages reload by themselves.

To see what the server is doing, open the developer page (`lights dev`, or `/dev` in the browser). It shows how the cloud and Wi-Fi have been doing lately, with buttons to check them, every LAN and cloud message with its payload, what each light's state and route is, the events sent to open pages, the server's output, and an explorer for every API route. If you add a file to `lib/`, add it to the file list on that page too (a test checks).

"How it's built" in the [README](README.md) says which file does what. A few things to know:

- **No dependencies.** The project runs on Node.js alone, which is a big part of why it's easy to install. If a change really needs a package, open an issue first so we can talk about it.
- **`lib/util.js` runs in the browser too** (the server serves it at `/shared/util.js`), so it can't import anything from Node.
- **Match the code around you**: ES modules, two-space indents, single quotes, and comments that say *why* rather than *what*.
- **Don't commit `data/`.** It holds your API key and settings, and it's already in `.gitignore`.

## Tests

```sh
npm test
```

The tests use Node's built-in test runner and don't need lights or an API key. They cover colors, times, sunrise frames and sunrise/sunset times (`lib/util.js`), turning names into lights and the order commands go out in (`lib/devices.js`), what fades and sunrises send to a light (`lib/fades.js`), when alarms fire, how they went, when they were missed and why the next may not work (`lib/scheduler.js`), connection health (`lib/health.js`), which host names the server answers to (`lib/hosts.js`), the PIN (`lib/auth.js`), and what command words like `warm 40` mean (`lib/commands.js`). If you change one of those, add a test next to the others in `test/`. GitHub runs the tests on every pull request.

The tests use fake lights. How a change really looks and behaves (how dark the start of a sunrise is, whether a model takes a brightness while it's off, LAN and cloud timing) can only be checked with real ones. Please say in your pull request which models you tried it with, and whether they were on Local Wi-Fi or the cloud.
