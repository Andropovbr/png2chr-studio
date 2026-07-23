# PNG2CHR Studio

PNG2CHR Studio is a static, browser-based tool for converting PNG artwork into Nintendo Entertainment System CHR tiles and playfield data, as well as inspecting and editing existing CHR tilesets. It is designed for artists and developers who need a small, transparent conversion workflow without installing a desktop graphics suite or uploading source artwork to a server.

## Current status

Version 0.7 provides PNG/CHR import and playfield conversion flows:

- PNG selection and drag-and-drop import;
- CHR tileset import with automatic 2bpp decoding;
- local image decoding and preview;
- dimension, transparency, and color validation;
- quantization to the 64 NES PPU color codes;
- four editable background palettes with a shared universal color;
- graphical palette assignment per 8x8 tileset tile or 16x16 playfield region;
- 8×8 tile extraction in reading order;
- enlarged, pixel-perfect tile previews with decimal and hexadecimal IDs;
- NES 2bpp CHR encoding;
- optional exact tile deduplication with an immediate grid preview;
- optional Tileset deduplication across horizontal, vertical, and combined flips;
- `.chr` download using either the original or deduplicated tile set;
- explicit Tileset and Playfield processing modes;
- 256×240 playfield validation;
- `.nam` nametable, `.atr` Attribute Table, and `.pal` palette exports;
- interactive 32x30 collision painting directly over a playfield preview;
- `.col` collision-map export with one bit per 8x8 tile;
- one-click random playfield generation for quick export and collision tests;
- Portuguese (Brazil) and English user interfaces;
- responsive, keyboard-accessible controls and translated diagnostics.

All graphics processing happens locally in the browser. PNG and CHR files are never sent to a server or external service.

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

The test suite covers color mapping, transparency validation, tile extraction, exact and flip-aware deduplication, deduplication maps, bit direction, CHR encoding and decoding, nametable and Attribute Table generation, translation parity, file naming, and the complete RGBA-to-CHR pipeline.

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

An imported PNG must:

- be a PNG file;
- have a width divisible by 8;
- have a height divisible by 8;
- use at most 256 distinct source color indices;
- contain only fully opaque or fully transparent pixels.

Fully transparent pixels always use source index 0. Their stored RGB channel values are ignored. Source colors are quantized to the four colors of the palette assigned to each region before CHR encoding. Partial transparency is rejected.

An imported CHR file must contain a positive multiple of 16 bytes. Each 16-byte block is decoded as one NES 2bpp tile. Because CHR files do not store dimensions or palette colors, imported tiles are arranged into rows of up to 16 and initially displayed with palette 0. Their original color indices are preserved, and exporting without deduplication reproduces the decoded tile sequence.

Palette choices are restricted to the NES PPU's 64 color codes (`$00`-`$3F`). The editor exposes four background palettes. Slot 0 is the universal background color and is shared automatically by all four palettes.

### Playfield mode

A playfield PNG must be exactly 256×240 pixels, representing the NES screen as 32×30 tiles. Deduplication is enabled automatically when Playfield mode is selected, but it remains user-configurable.

The exported files are:

- `.chr`: the selected original or deduplicated CHR tile set;
- `.nam`: 960 tile indices in left-to-right, top-to-bottom order;
- `.atr`: the 64-byte NES Attribute Table.
- `.col`: a 120-byte collision map painted over the playfield.
- `.pal`: four NES background palettes stored as 16 PPU color codes.

A nametable entry is one byte, so playfield data can reference no more than 256 exported CHR tiles. When that limit is exceeded, CHR export remains available while nametable and Attribute Table exports are disabled. Enabling deduplication will usually bring a playfield below the limit.

Each Attribute Table quadrant covers a 16x16 pixel region and selects one of the four configured palettes. Select a palette in the GUI and paint directly over the converted preview to generate the corresponding two-bit fields in the 64-byte `.atr` file.

In Tileset mode, palettes are assigned per 8x8 tile. The selection remaps that tile's pixels to CHR indices 0-3, while the `.pal` file carries the four palette definitions for use by the game.

The palette editor uses one painting workflow: select one of the four palettes, choose a 0-3 CHR color index, and paint individual pixels. Every pixel in an 8x8 tile stores its own two-bit color index, so all four colors can coexist inside a tile. Painting also assigns the active palette to the containing 8x8 tileset or 16x16 playfield region, keeping the Attribute Table consistent with NES hardware. Enable **Show palette numbers in image regions** to inspect those assignments without changing the artwork.

Choose **Edit palette** and click the main image preview to open its 8x8 or 16x16 region in the enlarged editor. Palette selection and pixel editing are available only in this zoomed view, avoiding a second interactive playfield. Use the left mouse button to paint individual pixels. The right button suppresses the browser context menu and replaces every pixel with the clicked color index inside the same palette region. The preview highlights the active palette region and reports its pixel, tile, and palette coordinates.

The playfield preview also provides explicit **Paint solid** and **Erase** collision tools. A click changes one 8x8 collision cell, while dragging changes multiple cells. This keeps collision editing separate from 16x16 palette-region selection.

Selecting a swatch in the palette definition changes only which color is being edited. It does not change the CHR paint brush. The active brush is selected explicitly in the **CHR color brush** control and is always identified by palette, color index, and NES color code.

### Random test playfield

In Playfield mode, **Generate random playfield** creates a complete 256x240 test screen without requiring a PNG. The scene uses one four-color background palette (`$0F`, `$11`, `$21`, `$30`), a maximum of six reusable tile patterns, and automatic exact deduplication. The generated data therefore remains within the 256-tile nametable limit and can immediately be exported as `.chr`, `.nam`, `.atr`, `.col`, and `.pal`.

Generating another screen randomizes stars, clouds, and platforms. Existing collision markings are cleared because the new screen has a different layout.

### Collision map

In Playfield mode, the preview becomes a 32x30 collision editor. Select **Paint solid** or **Erase**, then click and drag across the 8x8 cells. **Clear all** removes every marked cell. The editor also supports the arrow keys to move between cells and Space or Enter to apply the selected tool.

The `.col` file stores the cells from left to right and top to bottom. Each byte contains eight horizontal cells: bit 7 is the leftmost cell and bit 0 is the rightmost. A set bit means solid and a clear bit means free. Each 32-cell row therefore occupies four bytes, and the complete 30-row map occupies 120 bytes. Collision data remains separate so `.nam` and `.atr` preserve their standard NES layouts.

## CHR format summary

Each 8×8 tile produces 16 bytes:

- bytes 0–7 contain bitplane 0;
- bytes 8–15 contain bitplane 1;
- the leftmost pixel uses bit 7;
- the rightmost pixel uses bit 0;
- the low bit of each color index goes to bitplane 0;
- the high bit goes to bitplane 1.

Tiles are exported from left to right and then top to bottom. Deduplication is disabled by default. When enabled, exact pixel duplicates are omitted, first occurrences keep their order, and tile IDs are reassigned to match their positions in the exported CHR data. Disabling the option restores the original tile list.

Tileset mode provides an additional option that treats horizontal, vertical, and combined flips as duplicates. It keeps the orientation of the first matching tile encountered and exports only that orientation to CHR. This option depends on the main deduplication setting and is intentionally unavailable in Playfield mode because standard NES background nametables have no flip bits.

## Development commands

```bash
npm run dev
npm run test
npm run lint
npm run format:check
npm run build
```

## Version 0.7 limitations

- No manual tile removal
- Collision cells are binary (solid or free); collision types and slopes are not supported
- No metatiles, metasprites, or animations
- No cloud storage or backend

Color quantization uses nearest-color matching in sRGB. It does not simulate NTSC composite artifacts or color-emphasis bits. Flip-aware deduplication is limited to Tileset exports; rotated variants are still considered different.

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

Possible future versions may add typed collision regions, rotation-aware analysis, metatiles, metasprites, and animation tooling.
