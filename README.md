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
- **Sprite Sheet & Animation Workflow:**
  - Multiple animations per asset with independent spritesheets, frame sizes, signed origin anchors, playback modes (Loop / Once), and flip capability flags.
  - Assisted frame-grid detection for sprite sheets.
  - Metasprite generation with transparent 8×8 cell omission to minimize OAM usage and scanline limits.
  - Physical 8 KiB CHR-ROM modeling with independent sprite pattern table selection (PT0 / PT1), 8-bit local OAM tile indexes, sparse allocation, and base CHR preservation.
  - Multi-entity scene preview with independent positioning and playback.
- **Production Exporters:**
  - Consolidated physical 8 KiB `.chr` or raw deduplicated `.chr`.
  - Versioned JSON animation metadata (`format: png2chr-studio-animation`, `version: 5`).
  - cc65-ready C header and source files (`.h` / `.c`) with ROM-friendly flattened structs and enums.
  - ca65-ready assembly include and source files (`.inc` / `.s`).
  - 16-byte NES palette files (`.pal`).
- **Internationalization:** Full bilingual user interface in Portuguese (Brazil) and English.

All graphics processing happens locally in the browser. PNG, CHR, and ROM files are never uploaded to any server or external service.

---

## Technical Documentation

Detailed technical documentation is available in the [`docs/`](docs/) directory:

- [**Documentation Index (`docs/README.md`)**](docs/README.md) — Overview of available documentation.
- [**Architecture Guide (`docs/arquitetura.md`)**](docs/arquitetura.md) — Application structure, modules, state flow, processing pipeline, and NES hardware handling.
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

The codebase is versioned according to semantic releases tracked via Git tags (`v0.11`, `v0.12.0`, `v0.13.0`, etc.) and `package.json`. All recent capabilities—such as the persistent project model (`.p2c`), multi-entity scene preview, tile pixel editor, project palette manager, assisted frame detection, and 512-tile independent pattern tables—are fully integrated and tested in the current baseline.

---

## License

This project is licensed under the terms defined in the repository.
