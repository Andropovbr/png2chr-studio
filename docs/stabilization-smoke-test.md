# Stabilization smoke test

Run this concise manual check after building the application. It validates the
existing sprite-sheet workflow without introducing a browser test framework.

## Fixtures and setup

- Start the application with `pnpm dev` and open the URL printed by Vite.
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

| Step | Action                                                                                     | Expected result                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Open the app and select **Sprite sheet / animation**.                                      | The image importer and animation editor are available; no console or visible startup error.                                                                      |
| 2    | Load the valid PNG.                                                                        | Preview, diagnostics, color-reduction controls, and tiles appear.                                                                                                |
| 3    | Set frame width/height (or accept a detected grid) and select at least two frames.         | Frame cells match the intended sheet grid and an animation preview is available.                                                                                 |
| 4    | Preview the animation, select a NES reduction mode, and inspect tiles.                     | Preview remains populated; the reduction result and tile data update without losing the selected frames.                                                         |
| 5    | Enable exact deduplication and flip-aware reuse.                                           | The mirrored tile reuses the first tile and reports the H-flip attribute instead of allocating another tile.                                                     |
| 6    | Open **Tile mapping**.                                                                     | The panel is not blank and shows effective frame cells, OAM-local tile byte, physical CHR tile, reuse source, attributes, and orientation.                       |
| 7    | Choose `game.chr` as the base CHR.                                                         | Occupancy reports 14 occupied / 512 physical slots and 498 free; PT0 is 14 occupied and PT1 is 0 occupied. The PT counts add up to the total occupied count.     |
| 8    | Select PT1, rebuild/inspect the mapping, and export the animation CHR.                     | New tiles use free PT1 slots (physical index 256 or later, local OAM index 0–255); occupied base indexes are unchanged. The exported CHR is exactly 8,192 bytes. |
| 9    | Save the project, then reopen it with the same PNG and `game.chr` available.               | Animation settings, selected frames, mapping, PT selection, base-CHR reference, and occupancy are restored.                                                      |
| 10   | Remove the base CHR, save, and reopen again.                                               | No base CHR is restored and its occupancy/reference do not reappear.                                                                                             |
| 11   | Attempt to load an invalid or corrupt file labelled as PNG, then load the valid PNG again. | A visible load error is shown for the invalid PNG; the valid PNG then loads normally and the application remains usable.                                         |

## State-boundary checks

After opening or saving a project so the dirty marker is clear:

1. Collapse and expand quantization, animation configuration, palette, mapping,
   or individual animation panels. The project must remain clean.
2. Change the active preview tool, palette-number overlay, or zoomed palette
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
pnpm test -- src/core/png-load.test.ts src/core/animation-mapping.test.ts src/core/animation-model.test.ts src/core/chr-pattern-table.test.ts src/core/project.test.ts src/core/animation-exporters.test.ts src/core/tile-deduplication.test.ts
pnpm test
pnpm build
pnpm lint
pnpm format:check
```

The focused suite covers PNG failure/recovery, effective mapping and flip
orientation, raw CHR occupancy, PT0/PT1 local/physical indexing, sparse-slot
allocation, 8 KiB output, project persistence/removal, and metadata exports.
Browser-level file chooser and download interactions remain manual because the
repository deliberately has no browser/E2E harness.
