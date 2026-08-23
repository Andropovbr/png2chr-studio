# Stabilization smoke test

Run this concise manual check after building the application. It validates the
existing sprite-sheet workflow without introducing a browser test framework.

## Fixtures and setup

- Start the application with `npm run dev` and open the URL printed by Vite.
- Use a known-valid sprite-sheet PNG whose width and height are multiples of
  eight. For the flip-reuse check, use a sheet with two 8x8 tiles where the
  second is the horizontal mirror of the first.
- Use [`examples/base-chr-persistence/game.chr`](../examples/base-chr-persistence/game.chr).
  It is an 8,192-byte CHR with 512 physical slots: 14 occupied slots in PT0,
  none in PT1, and 498 free slots.

There is intentionally no binary PNG fixture in the repository. Keep the PNG
chosen for this run alongside the saved smoke-test project so the project can
be reopened with its original asset available.

## Manual flow

| Step | Action                                                                                                        | Expected result                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Open the app and navigate to **Sprite Sheet & Animation** via the sidebar.                                    | The animation workspace loads with Asset Configuration, Sprite Palettes, Animation List, and Selected Animation Editor; no console or visible startup error. |
| 2    | Load a valid PNG on an animation card.                                                                        | The frame detection grid suggestions, timing controls, and sticky animation preview column appear.                                                           |
| 3    | Set frame width/height (or accept a detected grid) and select at least two frames.                            | Frame cells match the intended sheet grid, and the sticky preview plays the selected sequence.                                                               |
| 4    | Toggle the preview collapse button `[-]` / `[+]`.                                                             | Preview minimizes to a single compact status header; the project does NOT mark dirty.                                                                        |
| 5    | Switch between contextual tabs (_Frames & Timing_, _Pixel Overrides_, _Metasprite Mapping_, _Scene Preview_). | Subtools render without reloading or re-quantizing the entire project; inspector space is reclaimed when empty.                                              |
| 6    | Navigate to **Project Palettes** via sidebar.                                                                 | 4-slot active sprite palette grid and multi-column palette definition cards render responsively.                                                             |
| 7    | Navigate to **CHR Memory** via sidebar.                                                                       | Physical 8 KiB CHR-ROM breakdown displays PT0/PT1 occupancies, base CHR retention, and local 8-bit OAM vs physical index mapping.                            |
| 8    | Navigate to **Deliver & Export** via sidebar.                                                                 | Project readiness badge, unified diagnostics, and download cards for all production artifacts appear.                                                        |
| 9    | Save the project (`.p2c`), then reopen it with the same PNG and `game.chr` available.                         | Complete state (animations, palette definitions, slots, overrides, scene instances, and CHR settings) is restored accurately.                                |
| 10   | Remove the base CHR, save, and reopen again.                                                                  | No base CHR is restored and its occupancy/reference do not reappear.                                                                                         |
| 11   | Attempt to load an invalid or corrupt file labelled as PNG, then load the valid PNG again.                    | A visible load error is shown for the invalid PNG; the valid PNG then loads normally and the application remains usable.                                     |

## State-boundary checks

After opening or saving a project so the dirty marker is clear:

1. Collapse and expand quantization, animation configuration, palette, mapping,
   preview (`[-]`/`[+]`), or individual animation panels. The project must remain clean.
2. Change the active workspace, active tab, preview tool, palette-number overlay, or zoomed palette
   region. The project must remain clean.
3. Change a palette color, assignment, pixel override, collision cell,
   animation frame/duration, CHR destination, or project name. The project must
   show the dirty marker.
4. Save and reopen the project. Persistable edits must be restored; collapsed
   panels and other workspace-only state may reset to defaults.
5. Trigger a recoverable load/processing error. Showing or clearing the error
   alone must not mark an otherwise clean project dirty.

## Automated counterpart

Run these checks before or alongside the manual flow:

```bash
npm test -- src/core/png-load.test.ts src/core/animation-mapping.test.ts src/core/animation-model.test.ts src/core/chr-pattern-table.test.ts src/core/project.test.ts src/core/animation-exporters.test.ts src/core/tile-deduplication.test.ts
npm test
npm run build
npm run lint
npm run format:check
```

The focused suite covers PNG failure/recovery, effective mapping and flip
orientation, raw CHR occupancy, PT0/PT1 local/physical indexing, sparse-slot
allocation, 8 KiB output, project persistence/removal, and metadata exports.
Browser-level file chooser and download interactions remain manual because the
repository deliberately has no browser/E2E harness.
