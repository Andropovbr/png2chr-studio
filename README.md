# PNG2CHR Studio

PNG2CHR Studio is a static, browser-based tool for converting PNG artwork into Nintendo Entertainment System (NES) CHR tiles, playfields, collision maps, and sprite animation data, as well as inspecting and editing existing CHR tilesets or extracting graphics from NROM games.

It is designed for retro game developers and pixel artists who need a transparent, deterministic NES graphics conversion workflow directly in the browser—with zero server uploads, zero frameworks, and strict adherence to NES hardware constraints.

---

## Features

- **PNG, CHR & iNES ROM Import:** Drag-and-drop or file selection for PNG images, raw 2bpp `.chr` files, and iNES Mapper 0 (NROM) ROMs with 8 KiB CHR-ROM extraction.
- **Strict NES Validation:** Dimension validation (multiples of 8, exact 256×240 for playfields), binary transparency validation (no partial alpha), and quantization to the 64 NES PPU color codes.
- **Configurable Color Reduction & Dithering:** Nearest, Median Cut, and deterministic K-Means quantization with optional Floyd-Steinberg, Atkinson, and Bayer (4×4, 8×8) dithering, using Euclidean RGB or perceptual OKLab color distance.
- **Studio Project Persistence (`.p2c`):** Save and load complete project states, including self-contained embedded image data, custom palettes, active slots, pixel overrides, animations, collisions, and scene preview configurations.
- **Tileset Workflow:** 8×8 tile extraction in reading order, per-tile palette assignment, integrated 8×8 pixel editor, and exact or flip-aware (horizontal, vertical, combined) deduplication.
- **Playfield & Collision Workflow:** 256×240 playfield conversion with 960-byte Nametable (`.nam`), 64-byte Attribute Table (`.atr`), 480-byte 11-type typed collision map (`.col`), 16-byte palette (`.pal`), and procedural test playfield generation.
- **Background Map Workspace:** Dedicated NES screen tilemap workspace for composing full 32×30 Nametables (256×240 px) with source image tile browser, brush tools (pencil, picker, eraser, palette), hardware-accurate 16×16 Attribute Table painting, canonical BG 0..3 slot previews with logical palette names and the universal `$3F00` color, Pattern Table selection (PT0 / PT1), 1×–4× zoom controls, grid/attribute overlays, cell inspector with direct physical CHR slot tracking and _Inspect in CHR Memory_ navigation, and live integrity diagnostics.
- **Sprite Sheet & Animation Workflow:**
  - Decoupled workspace layout with a compact entity/animation list, single focused animation editor, responsive multi-column palette grids, and a collapsible, sticky live preview column.
  - Contextual subtool tabs: _Frames & Timing_, _Pixel Overrides_, _Metasprite Mapping_, and a dedicated _Scene Preview_ subworkspace.
  - Multi-entity Scene playback keeps independent transient frame state across editor rerenders and tab switches while project files persist only canonical scene instances.
  - Scene instances support pointer drag with one persisted commit, focusable companion cards with screen-reader labels, one-pixel Arrow-key movement, Delete, and canonical layer reordering through Ctrl+Up/Down or inspector controls.
  - Multiple animations per asset with independent spritesheets, frame sizes, signed origin anchors, playback modes (Loop / Once), and flip capability flags.
  - Assisted frame-grid detection for sprite sheets.
  - Deterministic spritesheet reimportation and frame geometry changes with pure reconciliation of pixel overrides, frame sequences, parallel duration/palette arrays, and signed 8-bit origin anchors.
  - Metasprite generation with transparent 8×8 cell omission to minimize OAM usage and scanline limits.
  - Physical 8 KiB CHR-ROM modeling with independent sprite pattern table selection (PT0 / PT1), 8-bit local OAM tile indexes, sparse allocation, and base CHR preservation.
  - Logical palette selection by stable ID at animation and frame level, with active SPR slot badges, transparent sprite color 0, and frame override precedence reflected consistently in previews and Scene capacity diagnostics.
- **Project Palette Workspace:** Dedicated workspace with an unbounded logical palette library, editable universal Background color (`$3F00`), independent 4-slot Background/Sprite hardware banks, usage-aware filters, safe deletion, a scrollable usage/diagnostics inspector, and direct exports for 16-byte BG/SPR palettes, the complete 32-byte PPU Palette RAM, cc65 C, and ca65 Assembly tables.
- **CHR Memory & Pattern Table Workspace:** Visual inspection, cross-workspace hub, and projected view of physical 8 KiB CHR-ROM memory (Pattern Table 0 and Pattern Table 1 16×16 grids with 512 total tile slots, integrated CHR Region Manager for organizing named logical regions and allocation-blocking reservations with hexadecimal $00..$FF input, live decimal mirror, deterministic PT0/PT1 sorting, accessible roving tabindex keyboard navigation across rows and columns via Arrow/Home/End/PageUp/PageDown keys, interactive CHR usage heatmap with discrete frequency buckets, reference count badges, and project summary metrics, per-asset CHR resource metrics panel (unique physical slots, primary-owned vs. consumed, shared, cross-asset deduplication, exclusive tiles, Base CHR reuse, manual-materialized tiles, PT0/PT1 breakdown), ownership and mapping integrity diagnostics with direct slot inspection and asset highlighting actions, interactive highlight-by-asset filtering, comprehensive tile reuse diagnostics in Tile Inspector with multi-modal chips, bidirectional cross-workspace navigation via contextual _Inspect in CHR_ actions across Tileset cards, Playfield cells, and Metasprite mapping cells, reverse lookup _Used by_ section in Tile Inspector listing project references with bounded scrolling and direct jump-to-source actions for Animation frames, Playfield cells, and Tileset tiles, integrated interactive 8×8 CHR Tile Editor with drawing tools (pencil, eraser, eyedropper, flood fill), geometric transformations (flip H/V, 90° rotation), shift & wrap, internal clipboard copy/paste, atomic 50-level Undo/Redo, keyboard shortcuts, and full single-source-of-truth integration across Animation spritesheets, Tileset/Playfield pixel overrides, Base CHR preservation, and empty slot materialization, multi-modal slot occupancy visualization distinguishing free, project-occupied, base CHR, and reserved slots, contextual CHR usage highlighting across Current Frame, Current Animation, Current Entity, Base CHR, and All Project Tiles with PT0/PT1 summary badges, allocation-based blank tile disambiguation, toolbar view and context groupings with occupancy and heatmap legends, per-table and global utilization summaries, neutral grayscale plus exactly four canonical BG and four canonical SPR preview modes, transparent sprite index 0, logical palette identity/NES codes/RGB details in the Tile Inspector, pixel-perfect zoom controls (1×, 2×, 3×, 4×), interactive tile selection, contextual Tile Inspector with PPU hardware addressing, CHR-ROM start and bitplane 0/1 byte offsets, slot allocation diagnosis, animation source attribution, enlarged 16× preview canvas with toggleable pixel grid and live palette synchronization, PT0 / PT1 pattern table isolation, base CHR retention, physical vs. 8-bit OAM-local sprite indexing, reduced-motion accessibility, and deduplication reuse breakdown).
- **Deliver & Export Workspace:** Consolidated delivery hub showing project readiness status, per-asset CHR resource accounting, domain and ownership integrity validation diagnostics with direct links to relevant editing workspaces, and unified downloads for all production binary and source artifacts across Tileset, Playfield, and Animation modes.
  - Consolidated physical 8 KiB `.chr` or raw deduplicated `.chr`.
  - Versioned JSON animation metadata (`format: png2chr-studio-animation`, `version: 5`).
  - cc65-ready C header and source files (`.h` / `.c`) with ROM-friendly flattened structs and enums.
  - ca65-ready assembly include and source files (`.inc` / `.s`).
  - Canonical 16-byte Background/Sprite and 32-byte full PPU palette files (`.pal`), plus cc65 (`.h` / `.c`) and ca65 (`.inc` / `.s`) palette tables.
- **Internationalization:** Full bilingual user interface in Portuguese (Brazil) and English.

All graphics processing happens locally in the browser. PNG, CHR, and ROM files are never uploaded to any server or external service.

---

## Technical Documentation

Detailed technical documentation is available in the [`docs/`](docs/) directory:

- [**Documentation Index (`docs/README.md`)**](docs/README.md) — Overview of available documentation.
- [**Architecture Guide (`docs/arquitetura.md`)**](docs/arquitetura.md) — Application structure, modules, state flow, processing pipeline, and NES hardware handling.
- [**CHR Editor Guide (`docs/chr-editor.md`)**](docs/chr-editor.md) — Tools, keyboard shortcuts, focus behavior, PT0/PT1 and Base CHR integration, persistence, and known limitations.
- [**Development Guide (`docs/desenvolvimento.md`)**](docs/desenvolvimento.md) — Prerequisites, local environment, tests, linting, formatting, coding standards, and CI pipeline.
- [**Formats & Export Specification (`docs/formatos-e-exportacao.md`)**](docs/formatos-e-exportacao.md) — Binary layouts, file formats (PNG, CHR, iNES, `.nam`, `.atr`, `.pal`, `.col`, `.p2c`, JSON, cc65 C, ca65 ASM).
- [**Project State Boundaries (`docs/project-state-boundaries.md`)**](docs/project-state-boundaries.md) — State segregation rules between persistable project data and transient workspace state.
- [**Stabilization Smoke Test (`docs/stabilization-smoke-test.md`)**](docs/stabilization-smoke-test.md) — Verification checklist and automated test counterparts.
- [**Technical Change History (`docs/historico/`)**](docs/historico/README.md) — Architecture and format evolution log.

---

## Technology

- **Language & Runtime:** TypeScript in strict mode, Node.js 20.19+
- **Build Tool:** Vite
- **UI Architecture:** Semantic HTML, plain CSS, native Canvas 2D API (no UI framework overhead)
- **Testing & Quality:** Vitest, ESLint (with typescript-eslint), Prettier
- **Continuous Integration:** GitHub Actions CI

---

## Quick Start

### Requirements

- Node.js 20.19.0 or newer (LTS recommended)
- npm

### Installation

```bash
npm install
```

### Local Development

```bash
npm run dev
```

Open the local development URL printed in the terminal (typically `http://localhost:5173`).

### Run Tests

```bash
npm run test
```

### Check Lint and Formatting

```bash
npm run lint
npm run format:check
```

### Production Build

```bash
npm run build
```

The optimized static production files will be output to `dist/`. Vite uses relative asset paths, making the build directly hostable on GitHub Pages or any static file host.

To preview the production build locally:

```bash
npm run preview
```

---

## Project Structure

```text
src/
  core/       Pure NES domain logic, image analysis, tile extraction, encoders, and project persistence
  i18n/       Typed translations (pt-BR and en) and locale management
  ui/         Modular DOM components, Canvas renderers, and interactive editors
  utils/      Download helpers and identifier sanitization
  workers/    Web Workers for intensive background computation (color quantization)
  main.ts     Application orchestrator and canonical state manager
```

The `src/core/` directory contains no DOM or Canvas references, ensuring all NES conversion algorithms remain pure, deterministic, and easily testable.

---

## Versioning and Project Status

The project is at version **v0.13.0** (declared in `package.json` and aligned with the repository's `v0.13.0` release tag). All current capabilities—such as the persistent project model (`.p2c`), multi-entity scene preview, tile pixel editor, project palette manager, assisted frame detection, and 512-tile independent pattern tables—are fully integrated and tested in the current baseline.

---

## License

This project is licensed under the terms defined in the repository.
