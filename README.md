# NovaSynth

NovaSynth is a browser-based grid sequencer and soft-synth for creating patterns, leads, basses and drum parts. It's designed to be lightweight, responsive, and easy to experiment with.

## Features

- 16-step polyphonic/semi-polyphonic grid sequencer
- Multiple instrument layers (synth, bass, drums)
- Per-note fade-in / fade-out controls
- ADSR envelope, filter, LFO and FX per layer
- Save / Load projects as JSON, plus local autosave
- Export rendered audio to WAV

## Quick Start

1. Open `index.html` in a modern browser (Chrome/Edge/Firefox recommended).
2. Add layers with the +ADD button in the left sidebar.
3. Select a layer and click cells in the grid to add notes. Shift-click to extend duration.
4. Right-click a note to delete it.
5. Use the controls in the bottom panel to tweak envelopes, filter and FX.

## Saving & Loading

- Click `Save` to download a JSON snapshot of your project (`novasynth-project.json`).
- Click `Load` and choose a previously saved JSON file to restore a project. The app recreates audio nodes and restores sheets, BPM and layer params.
- The app also performs a quick local autosave to `localStorage` whenever you add/delete/drag notes or perform sheet/layer operations. This is stored under the key `novasynth_autosave` in your browser; you can copy and paste it if needed.

## Keyboard

- Space: Play / Stop

## Developer Notes

- The front-end is plain HTML/CSS/JS. Key files:
	- `index.html` — main UI
	- `css/` — styles
	- `js/app.js` — core application logic and audio graph
	- `js/ui.js` — DOM bindings and helpers
	- `js/audio-fx.js` — helper for reverb impulse
	- `js/visualizer.js` — waveform/scope visualization

- Project serialization stores only serializable data (layer params and sheets). AudioContext nodes are rebuilt on load.

## Notes & Next Steps

- If you want an undo stack for deletes (or a non-destructive delete confirmation), we can add a small snackbar with undo.
- We can also add cloud sync or download-to-cloud options if you want cross-device projects.

Enjoy making sounds!
