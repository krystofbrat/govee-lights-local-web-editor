# Screenshots

The images the main README shows. Take them on a phone, in dark mode, from the app added to the Home Screen (so there's no browser bar).

| File | What it shows |
| --- | --- |
| `lights.png` | The **Lights** tab: a few lights on in different colors, the one-tap looks row, and the next alarm line |
| `color-wheel.png` | One light's controls (tap a light) on the **Color** pane, with the wheel and the brightness slider visible |
| `alarms.png` | The **Alarms** tab with a sunrise fade on weekdays and a "30 min before sunset" alarm |
| `try-scene.gif` | 5–8 seconds: tap a scene on the **Scenes** tab, the "Trying…" bar counts down, tap **Keep** |

Before taking them, check that nothing personal is on screen: no Settings tab (it shows addresses and your location), no notifications, and light names you don't mind sharing.

PNG screenshots straight from the phone are fine. For the GIF, record the screen, then convert it small enough to load fast (under about 5 MB), for example:

```sh
ffmpeg -i recording.mov -vf "fps=12,scale=360:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" try-scene.gif
```
