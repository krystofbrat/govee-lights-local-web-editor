# Security

## Reporting a problem

Please **don't open a public issue** for a security problem. Report it privately on GitHub instead: the **Security** tab of this repository → **Report a vulnerability**.

Say what someone could do and how, and which version or commit you tested. You'll get an answer as soon as possible, and credit in the fix if you'd like it.

## What counts

This app runs on your own computer and controls your lights on your home network. Security problems include:

- another website, or a page opened in your browser, controlling your lights or reading app data (the server blocks cross-site requests and DNS rebinding)
- getting the Govee API key out of the server (the browser only ever sees its last 4 characters)
- using the app or API without the PIN when one is set, or guessing it faster than 1 try per 30 seconds after 5 wrong ones
- using the developer page or its routes (`/api/dev…`, including the checks) from another device: they only answer this computer
- reading files outside `public/` through the web server
- a message on the network crashing the server or putting bad data into it

## What doesn't

These are known and described in the README:

- **Without a PIN, anyone on your Wi-Fi can control your lights.** The PIN is optional, so phones on the same network can use the app without setup. Even with one, the connection is plain HTTP, so someone who can watch your Wi-Fi traffic could see it.
- **Exposing port 8420 to the internet** (port forwarding) isn't supported. For access away from home, use a VPN such as Tailscale.
