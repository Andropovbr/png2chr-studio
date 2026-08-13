# AGENTS.md

## Overview

Browser-only, framework-free TypeScript app (Vite) that converts PNGs/CHR/NROM into NES CHR tiles, playfields, and sprite animations. No UI framework, backend, or external services; all processing happens in the browser (a Web Worker handles quantization comparison previews).

## Commands

- Node 20.19+ is required (README says this; don't rely on an older system Node).
- Lockfile is `pnpm-lock.yaml` — use `pnpm install` rather than `npm install` (npm would create a stray `package-lock.json`; the ESLint config also ignores `.pnpm-store`).
- `pnpm dev` — Vite dev server. Never open `index.html` via `file://`; TS modules need Vite's transform.
- `pnpm test` — Vitest, Node environment, include pattern `src/**/*.test.ts`. Single file: `pnpm test src/core/chr-encoder.test.ts`.
- `pnpm build` — `tsc -b && vite build`. This **is** the typecheck step; there is no standalone typecheck script. Output: `dist/`, relative base path for subdirectory hosting.
- `pnpm lint` — ESLint `strictTypeChecked` + `stylisticTypeChecked` (type-aware). Writing code must also satisfy strict TS flags like `noUnusedLocals/Parameters` and `noUncheckedIndexedAccess`.
- `pnpm format` / `pnpm format:check` — Prettier, single quotes, semicolons, trailing commas.

## Architecture

- `src/core/` — pure, deterministic logic: image analysis/quantization, CHR encode/decode, playfield/collision encoding, animation model + exporters. **Must not touch DOM or Canvas** — this is what keeps it testable in the Node test environment.
- `src/ui/` — DOM/Canvas components; `src/main.ts` (single large orchestrator) wires the whole workflow. Plain DOM, no framework.
- `src/i18n/` — translations: the `en` and `pt-BR` objects in `translations.ts` **must keep identical keys** (enforced by `translations.test.ts`). Add any new UI string to both locales; interpolate with `t(key, { var })` using `{var}` placeholders. Locale: any `pt*` → pt-BR, everything else → en.
- `src/workers/quantization-preview-worker.ts` — Web Worker for the quantization comparison panel.

## Gotchas

- If you change the animation exporters (JSON/C/ca65), keep the committed reference outputs under `examples/sprite-animation/` in sync — their README documents the expected layout. Prettier ignores `examples/**/*.{inc,s,c,h}`.
- `.chr` exports are zero-padded to ≥8 KiB (one NES CHR-ROM bank); animation sprite CHR capacity is 512 tiles with 16-bit tile indexes in C/ca65 exports (OAM stays 8-bit, so >256 sprite tiles need runtime CHR bank switching); playfield nametables are capped at 256 tiles.
- Quantization test fixtures live in `src/core/fixtures/quantization-fixtures.ts`.
- Releases are cut on feature branches (e.g. `v0.12.0`) merged into `main`; commit messages use the repo's `feat:`/`Refactor` style.

## Verification order

After changes: `pnpm lint` → `pnpm build` (typecheck) → `pnpm test`, then `pnpm format:check` before committing.
