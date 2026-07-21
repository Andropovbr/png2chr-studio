# PNG2CHR Studio

PNG2CHR Studio is a static, browser-based tool for converting PNG artwork into Nintendo Entertainment System CHR tiles and playfield data. It is designed for artists and developers who need a small, transparent conversion workflow without installing a desktop graphics suite or uploading source artwork to a server.

## Current status

Version 0.3 provides PNG-to-CHR and playfield conversion flows:

- PNG selection and drag-and-drop import;
- local image decoding and preview;
- dimension, transparency, and color validation;
- stable four-index color mapping;
- 8×8 tile extraction in reading order;
- enlarged, pixel-perfect tile previews with decimal and hexadecimal IDs;
- NES 2bpp CHR encoding;
- optional exact tile deduplication with an immediate grid preview;
- `.chr` download using either the original or deduplicated tile set;
- explicit Tileset and Playfield processing modes;
- 256×240 playfield validation;
- `.nam` nametable and `.atr` Attribute Table exports;
- Portuguese (Brazil) and English user interfaces;
- responsive, keyboard-accessible controls and translated diagnostics.

All image processing happens locally in the browser. PNG files and generated CHR data are never sent to a server or external service.

## Technology

- TypeScript in strict mode
- Vite
- Semantic HTML
- Plain CSS
- Canvas API
- Vitest
- ESLint
- Prettier

The application has no UI framework, backend, database, or runtime external service.

## Requirements

- Node.js 20.19 or newer
- npm

## Install

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Open the local URL printed by Vite. Do not open `index.html` directly with a `file://` URL because TypeScript modules must be served and transformed by Vite.

## Run tests

```bash
npm run test
```

The test suite covers color mapping, transparency validation, tile extraction, deduplication maps, bit direction, CHR bitplanes, nametable and Attribute Table generation, translation parity, file naming, and the complete RGBA-to-CHR pipeline.

## Build

```bash
npm run build
```

The production files are written to `dist/`. Vite uses a relative base path, so the build can be hosted from a repository subdirectory such as:

```text
https://username.github.io/png2chr-studio/
```

To inspect the production build locally:

```bash
npm run preview
```

## Input rules

An imported image must:

- be a PNG file;
- have a width divisible by 8;
- have a height divisible by 8;
- use at most four color indices in total;
- contain only fully opaque or fully transparent pixels.

Fully transparent pixels always use color index 0. Their stored RGB channel values are ignored. Opaque colors are assigned to the remaining indices in first-occurrence order, scanning left to right and top to bottom. If no transparent pixel exists, the first opaque color uses index 0.

Partial transparency is rejected. Images requiring more than four indices are also rejected rather than automatically reduced.

### Playfield mode

A playfield PNG must be exactly 256×240 pixels, representing the NES screen as 32×30 tiles. Deduplication is enabled automatically when Playfield mode is selected, but it remains user-configurable.

The exported files are:

- `.chr`: the selected original or deduplicated CHR tile set;
- `.nam`: 960 tile indices in left-to-right, top-to-bottom order;
- `.atr`: the 64-byte NES Attribute Table.

A nametable entry is one byte, so playfield data can reference no more than 256 exported CHR tiles. When that limit is exceeded, CHR export remains available while nametable and Attribute Table exports are disabled. Enabling deduplication will usually bring a playfield below the limit.

Version 0.3 still uses one global four-color palette. Consequently, every Attribute Table quadrant selects palette 0 and the generated `.atr` file contains 64 zero bytes.

## CHR format summary

Each 8×8 tile produces 16 bytes:

- bytes 0–7 contain bitplane 0;
- bytes 8–15 contain bitplane 1;
- the leftmost pixel uses bit 7;
- the rightmost pixel uses bit 0;
- the low bit of each color index goes to bitplane 0;
- the high bit goes to bitplane 1.

Tiles are exported from left to right and then top to bottom. Deduplication is disabled by default. When enabled, exact pixel duplicates are omitted, first occurrences keep their order, and tile IDs are reassigned to match their positions in the exported CHR data. Disabling the option restores the original tile list.

## Development commands

```bash
npm run dev
npm run test
npm run lint
npm run format:check
npm run build
```

## Version 0.3 limitations

- No automatic color reduction or NES master-palette matching
- No manual pixel editing
- No manual tile removal
- No interactive playfield editor
- No multiple NES palettes
- No metatiles, metasprites, or animations
- No cloud storage or backend

The current color limit applies to the whole imported image. Per-tile palette assignment is outside the scope of version 0.3, so the generated Attribute Table always selects palette 0. Deduplication compares exact indexed pixel data and does not consider flipped or rotated variants equivalent.

## Project structure

```text
src/
  core/    Pure image analysis, tile extraction, CHR, and playfield encoding
  i18n/    Typed translations and locale selection
  ui/      DOM and Canvas interface components
  utils/   Download and file-name helpers
  main.ts  Browser workflow orchestration
```

The `core` directory does not access the DOM or Canvas API, which keeps conversion behavior deterministic and straightforward to test.

## Roadmap

Possible future versions may add multiple NES palettes, Attribute Table palette assignment, interactive tile and playfield editing, flip-aware deduplication, metatiles, metasprites, and animation tooling. These features are intentionally excluded from version 0.3.
