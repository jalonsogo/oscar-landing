# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

No build step. Serve locally with any static file server to support ES module imports:

```bash
python3 -m http.server 8080
# or
npx serve .
```

Open `http://localhost:8080` — do not open `index.html` directly as a `file://` URL (ES modules + importmap require HTTP).

## Architecture

Single-file static landing page for OScar (Operating System for Cooperative Agent Runtime).

**`index.html`** — the entire site: HTML structure, inline CSS, and an inline `<script type="module">` that bootstraps the Three.js WebGPU scene. Three.js is loaded from CDN via an importmap (no npm/bundler).

**`donut-scene.js`** — standalone version of the same WebGPU animation, exported as `initScene(container, config)`. The inline script in `index.html` is a self-contained copy of this logic with a specific scene config applied at the bottom.

**`screens/`** — product screenshots used for reference (not displayed on the page currently).

## Design system

- Brutalist: monospace (`Courier New`), 1px borders as structural dividers, no decorative elements
- CSS custom properties: `--black: #0a0a0a`, `--white: #f5f5f0`, `--gray: #888`, `--border: 1px solid currentColor`, `--mono`
- Layout sections: hero (fullscreen), marquee bar, 3-column feature grid, 2-column install block, specs strip, footer

## Animation config

`initScene(container, config)` accepts a config object with these top-level keys: `camera`, `object`, `animation`, `lights`, `ground`, `fog`, `dof`. All keys are optional and deep-merged with DEFAULTS. The `object.shape` field accepts `"donut"` or `"ring"`.

Current scene uses: ring shape, near-black ground (`#000000`), top-down camera, `spinSpeed: 0.016`, low smoke (`smokeAmount: 0.3`), no depth-of-field (`bokehScale: 0`).
