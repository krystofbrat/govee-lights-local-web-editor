# Contributing

Thanks for helping out! Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

[Open an issue](../../issues/new/choose) and pick **Bug report**. The most useful details are the light's model (like H6008), whether it's connected over Local Wi-Fi or the Govee cloud, and what `lights logs` shows. Never paste your API key or `data/lights.json`.

## Working on the code

There's nothing to install and nothing to build:

```sh
git clone https://github.com/krystofbrat/govee-lights-local-web-editor.git
cd govee-lights-local-web-editor
npm link        # puts the `lights` command on your PATH
lights open     # starts the server and opens the web app
```

After changing a file, run `lights restart`. Open pages reload by themselves.

To see what the server is doing, open the developer page (`lights dev`, or `/dev` in the browser). It shows every LAN and cloud message with its payload, what each light's state and route is, the events sent to open pages, the server's output, and an explorer for every API route.

"How it's built" in the [README](README.md) says which file does what. A few things to know:

- **No dependencies.** The project runs on Node.js alone, which is a big part of why it's easy to install. If a change really needs a package, open an issue first so we can talk about it.
- **`lib/util.js` runs in the browser too** (the server serves it at `/shared/util.js`), so it can't import anything from Node.
- **Match the code around you**: ES modules, two-space indents, single quotes, and comments that say *why* rather than *what*.
- **Don't commit `data/`.** It holds your API key and settings, and it's already in `.gitignore`.

## Tests

```sh
npm test
```

The tests use Node's built-in test runner and don't need lights or an API key. They cover colors, times and sunrise frames (`lib/util.js`), turning names into lights (`lib/devices.js`), and when alarms fire (`lib/scheduler.js`). If you change one of those, add a test next to the others in `test/`. GitHub runs the tests on every pull request.

Anything that talks to lights (LAN, cloud, fades) can only really be tested with real lights. Please say in your pull request which models you tried it with, and whether they were on Local Wi-Fi or the cloud.
