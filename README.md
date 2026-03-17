# PMX Video DJ

A browser-based DJ player for YouTube videos with dual-deck crossfading, playlist support, and real-time remote control via WebSocket.

## Features

- **Dual-deck crossfade** — Two YouTube players fade between each other over 5 seconds
- **Single video & playlist mode** — Paste a YouTube video ID/URL or a playlist ID/URL
- **Auto playlist progression** — Preloads the next track 30 seconds before the current one ends
- **Live playlist refresh** — Detects new songs added to the playlist and crossfades into them automatically
- **Remote control via WebSocket** — A `DJSyncClient` connects to a backend sync server; supports play, volume, mute, next/prev, and play/pause commands
- **QR code for song requests** — Displays a QR code overlay (fetched from the backend) so guests can request songs
- **10-band EQ + Echo** (`Eq.js`) — Web Audio API equalizer script with sub-bass to air bands and an echo effect, designed to be injected into the page via browser DevTools
- **mDNS discovery** (`broadcast_server.js`) — Local Express server that broadcasts itself on the network via Bonjour so companion apps (e.g., Google TV) can auto-discover it
- **TV integration** — Responds to custom window events (`tv-fullscreen`, `tv-play-pause`, `tv-next`, etc.) for remote/TV control
- **Keyboard shortcuts** — `F` fullscreen, `M` mute/unmute, `Q` QR code overlay

## Project Structure

```
FrontEnd/
├── index.html           # Main app UI
├── script.js            # Core player logic (crossfade, playlist, sync client, QR)
├── style.css            # App styles
├── Eq.js                # Standalone EQ + echo script (inject via DevTools)
├── broadcast_server.js  # Local Express + mDNS discovery server
├── package.json         # Node dependencies
└── dev_test.html        # Development test page
```

## Getting Started

### Run the local server

```bash
npm install
npm start
```

The server starts at `http://<your-local-ip>:8081` and broadcasts a Bonjour mDNS service (`_pmx-dj._tcp.local`) for auto-discovery by companion apps.

### Open the player

Navigate to `http://localhost:8081` in your browser.

## Usage

### Loading videos

- Paste a **YouTube video ID** (e.g. `dQw4w9WgXcQ`), full URL, or short URL into the input field and press Enter
- Paste a **YouTube playlist ID** or URL (e.g. `PLxxxxxx`) to enter playlist mode — tracks advance automatically

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `F` | Toggle fullscreen |
| `M` | Toggle mute |
| `Q` | Toggle QR code overlay |
| `Esc` | Close QR overlay |

### EQ (`Eq.js`)

Paste the contents of `Eq.js` into your browser's DevTools console while the player is open. This injects a 10-band equalizer UI (32Hz–16kHz) and an echo effect directly on the YouTube audio.

## Architecture

```
Browser (index.html + script.js)
    │
    ├── YouTube IFrame API  ← two overlaid players (player1 / player2)
    │
    └── DJSyncClient (WebSocket)
            │
            ├── Local:  ws://localhost:<port>/ws/sync?role=player
            └── Remote: wss://<ngrok-url>/ws/sync?role=player
```

The sync client auto-detects local vs. remote and reconnects with exponential backoff. It sends heartbeats every 10 seconds with current playback state (video ID, timestamp, duration, player state).
