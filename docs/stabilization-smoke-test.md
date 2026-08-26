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

## CHR Regions & Reservations smoke test (Milestone 5)

Validate the end-to-end lifecycle of organizational Regions and allocation-blocking Reservations:

| Step | Action                                                                                                              | Expected result                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Create a new project or open a legacy `.p2c` project without regions.                                               | CHR Memory workspace opens cleanly; Region Manager displays empty state guidance; project is unmodified.                                                 |
| 2    | In **CHR Memory**, click `[+ New Region]` and configure `Player` (PT0, `$00..$1F`, kind `region`, color `#38bdf8`). | Region appears in Region Manager table; slots `$00..$1F` in PT0 display subtle region color markers; project marks dirty.                                |
| 3    | Click `[+ New Region]` and configure `Runtime FX` (PT0, `$20..$2F`, kind `reservation`, color `#a855f7`).           | Reservation appears in table; empty slots `$20..$2F` in PT0 display distinctive dashed/hatched reservation styling; capacity counters update accurately. |
| 4    | Select any slot within `$00..$1F` and `$20..$2F` using keyboard or mouse.                                           | Tile Inspector displays accurate addressing, physical index, and contextual Region/Reservation membership badges.                                        |
| 5    | Check diagnostics in **CHR Memory** and **Deliver & Export**.                                                       | No spurious errors; clean diagnostic facts; project readiness reflects valid configuration.                                                              |
| 6    | Load a Base CHR or create project tiles that occupy slots within `$20..$2F`.                                        | Occupied tiles are preserved as `base` or `project`; Tile Inspector and diagnostics display a non-blocking `reservation-contains-occupied` warning.      |
| 7    | Add new assets/frames in Animation, Tileset, or Playfield mode.                                                     | Automatic allocator skips the entire reserved range `$20..$2F` and allocates subsequent unreserved slots (`$30+`).                                       |
| 8    | Save the project as `.p2c`.                                                                                         | Serialized JSON retains full `chrRegions` array with stable IDs, names, ranges, kinds, notes, and colors.                                                |
| 9    | Reopen the saved `.p2c` project file.                                                                               | All regions and reservations are restored with 100% fidelity, exact ranges, colors, and stable IDs.                                                      |
| 10   | Click `[Edit]` on `Runtime FX`, change end tile to `$3F`, and click `[Save]`.                                       | Reservation expands to `$20..$3F`; newly reserved slots reflect reservation state without moving or altering existing tiles.                             |
| 11   | Click `[Edit]` on `Player`, press `Escape` or click `[Cancel]`.                                                     | Form closes immediately; focus returns cleanly to `[+ New Region]`; no fields are modified.                                                              |
| 12   | Click `[Delete]` on `Runtime FX` and confirm the deletion prompt.                                                   | Reservation is removed from metadata; previously reserved empty slots return to unallocated state; existing tile bytes remain completely untouched.      |
| 13   | Save and reopen the project after deletion.                                                                         | Project loads without the deleted reservation; zero leftover artifacts.                                                                                  |

## Tile Ownership & Asset Mapping smoke test (Milestone 6)

Validate the end-to-end lifecycle of Asset Identities, Tile Ownership, Deduplication, CHR Inspector attribution, Metrics, and Diagnostics:

| Step | Action                                                                                                         | Expected result                                                                                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Load a project with multiple animation assets or tileset/playfield artwork.                                    | Assets receive stable `ProjectAssetId`s; CHR memory and delivery workspaces populate automatically.                                                                                     |
| 2    | In **CHR Memory**, expand the **Asset CHR Usage & Metrics** panel.                                             | Each active asset renders a card with detailed factual metric chips (`unique`, `primary`, `consumed`, `shared`, `cross-asset`, `exclusive`, `base-chr`, `manual`, and PT distribution). |
| 3    | Click `[Highlight tiles]` on an asset card.                                                                    | CHR pattern table grids highlight all physical slots occupied by the selected asset; button changes to `[Clear highlight]`; project remains clean.                                      |
| 4    | Select a physical slot occupied by an asset and view the **Tile Inspector**.                                   | Inspector displays origin asset, creation kind, logical coordinates, canonical `LogicalTileKey`, and list of all active consumer references (`Animation`, `Tileset`, or `Playfield`).   |
| 5    | For a shared tile (consumed by multiple assets or frames), inspect the usage list and click `[Jump to Frame]`. | Workspace switches to the selected consumer context (e.g. Animation Editor) with the specific frame selected.                                                                           |
| 6    | In **CHR Tile Editor**, edit a pixel on a shared slot.                                                         | System updates pixel overrides for the active consumer without silently altering the source graphics of other consuming assets.                                                         |
| 7    | Check the **Ownership Diagnostics** section in CHR Memory and the readiness checklist in **Deliver & Export**. | Integrity checks validate mapping correctness; clean projects show zero diagnostic warnings or errors; orphaned tiles emit actionable `[Inspect slot]` warnings.                        |
| 8    | In **Deliver & Export**, review the **Asset CHR Resource Accounting** section.                                 | Summary cards display concise per-asset CHR resource breakdown and pattern table distribution.                                                                                          |
| 9    | Save project as `.p2c` and reopen.                                                                             | Asset IDs and pixel overrides remain stable; derived mapping index, metrics, and diagnostics reconstruct dynamically with 100% fidelity.                                                |

## Sprite Sheet → CHR Integration smoke test (Milestone 7)

Validate the end-to-end integration of spritesheets, transparent cell omission, unified CHR allocation, flip-aware deduplication, reimport reconciliation, and aligned multi-target exporters (C, ca65 ASM, JSON v5, binary CHR):

| Step | Action                                                                                                                                        | Expected result                                                                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | In **Sprite Sheet & Animation**, load a multi-frame spritesheet PNG containing transparent regions and flipped sub-graphics.                  | Frames are auto-detected (or configured via 16×16/32×32 inputs); fully transparent 8×8 cells are omitted with positive `omitted_tile_count`.                                             |
| 2    | Configure frame sequencing, custom frame durations (e.g. `[6, 12, 8]`), and per-frame palette overrides.                                      | Animation timeline reflects custom timings and subpalettes; sticky preview plays sequence smoothly at target framerate.                                                                  |
| 3    | Open the **Pixel Overrides** tab and edit individual pixels on an extracted frame tile.                                                       | Override applies cleanly; modified pattern is immediately reflected in animation preview and CHR allocation without altering source image bytes.                                         |
| 4    | Navigate to **CHR Memory** and inspect pattern table distribution.                                                                            | Sprites occupy the selected pattern table (PT0 or PT1); local indices range `$00..$FF` while physical indices reflect `0..255` (PT0) or `256..511` (PT1).                                |
| 5    | Configure a CHR Reservation on the active pattern table (e.g. slots `$10..$1F`).                                                              | Dynamic allocation skips reserved slots and allocates subsequent free slots; Base CHR tiles remain protected.                                                                            |
| 6    | Inspect deduplication metrics in **Asset CHR Usage & Metrics**.                                                                               | Tiles matching via exact, H-flip, V-flip, or HV-flip share physical CHR slots; Tile Inspector attributes display hardware OAM flags (`$00`, `$40`, `$80`, `$C0`) and local tile byte.    |
| 7    | In **Sprite Sheet & Animation**, click `[Reimport Spritesheet]` with an updated PNG (different frame dimensions or extra frames).             | Geometry and overrides reconcile deterministically; out-of-bounds keys are pruned; valid overrides and surviving frame steps are preserved; ProjectAssetId remains stable.               |
| 8    | In **Deliver & Export**, review and download **cc65 C (`.h`/`.c`)**, **ca65 ASM (`.inc`/`.s`)**, **JSON v5 (`.json`)**, and **CHR (`.chr`)**. | C/ASM headers declare `${PREFIX}_SPRITE_PATTERN_TABLE`; OAM tables contain local 8-bit tile bytes `$00..$FF`; signed coordinates reflect âncora; CHR export contains exact 8 KiB buffer. |
| 9    | Save project as `.p2c`, reload the application, and open the saved file.                                                                      | Project state reloads completely; exports re-generated from reloaded model are 100% bit-for-bit identical to initial exports.                                                            |

## Tileset & Playfield non-regression smoke test

Validate that Tileset and Playfield modes operate without regression alongside the new animation subsystem:

| Step | Action                                                                                  | Expected result                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Switch to **Tileset** mode and import a tileset PNG (e.g. 128×128 pixels).              | Tileset extracts 8×8 tiles; deduplication and Base CHR assignment function cleanly; CHR Memory displays accurate project tile attributions.   |
| 2    | Switch to **Playfield** mode and import a full-screen background PNG (256×240 pixels).  | Playfield quantizes to 4 background palettes; 32×30 nametable grid and 64-byte attribute table generate accurately.                           |
| 3    | Paint collision cells (solid, ladder, hazard) and test procedural feature overlays.     | Collision map updates 480-byte `.col` buffer; random playfield generator operates without errors.                                             |
| 4    | Export Tileset/Playfield production artifacts (`.chr`, `.nam`, `.atr`, `.pal`, `.col`). | Binary files match strict NES hardware sizing (Nametable = 960 bytes, Attribute Table = 64 bytes, Collision = 480 bytes, Palette = 16 bytes). |
| 5    | Save project as `.p2c` and reopen.                                                      | Mode, collision cells, palette assignments, and tile overrides restore with 100% fidelity.                                                    |

## Background Pipeline smoke test (Milestone 8)

Validate the end-to-end Background Pipeline, 32×30 map composition, 16×16 Attribute Table painting, CHR allocation in PT0/PT1 with Base CHR and Reservations, project persistence, and full binary/C/ASM exports:

| Step | Action                                                                                                 | Expected result                                                                                                                                                                                                                 |
| :--- | :----------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | In the sidebar, click **Background** to open the Background Workspace.                                 | Background Workspace loads with Map Toolbar, Left Tools & Tile Browser, Center 256×240 Canvas, and Right Inspector/Diagnostics panel; no errors.                                                                                |
| 2    | Click `[+ Novo Mapa]` and rename the map to `Overworld Level 1`.                                       | New map is added to the project, set as `activeMapId`; project marks dirty.                                                                                                                                                     |
| 3    | Select the source asset and pick a tile in the **Tile Browser**.                                       | Selected tile is highlighted; active tool switches to Stamp (`pencil`).                                                                                                                                                         |
| 4    | Click or drag on the center 32×30 canvas to place tiles.                                               | Tiles render on the canvas at 256×240 px resolution; inspector reflects screen coordinates (`column`, `row`), `logicalKey`, `localTileIndex`, and `physicalTileIndex`.                                                          |
| 5    | Toggle Grid (`G`) and Attribute Overlay (`A`).                                                         | 8×8 tile grid and 16×16 attribute quadrant borders render crisp overlay indicators; subpalette numbers (`0..3`) appear in each 16×16 quadrant.                                                                                  |
| 6    | Select the Palette tool (`P` or tool button), choose Subpalette 2, and click a quadrant on the canvas. | The entire 16×16 px area (2×2 tiles) updates to Subpalette 2; 240-element palette array and 64-byte Attribute Table compile accordingly.                                                                                        |
| 7    | Switch Pattern Table between `PT0 ($0000)` and `PT1 ($1000)`.                                          | Allocation recompiles targeting the selected table; local indices remain `$00..$FF` while physical indices switch between `0..255` and `256..511`.                                                                              |
| 8    | In the cell inspector, click `[Inspect in CHR Memory]`.                                                | Workspace switches to **CHR Memory** with the corresponding physical slot selected; Tile Inspector details the background usage with direct jump-back link.                                                                     |
| 9    | In Tile Inspector, click the jump button next to the background usage reference.                       | Workspace returns cleanly to **Background Workspace** with the original map and cell selected.                                                                                                                                  |
| 10   | Save project as `.p2c` and inspect JSON content.                                                       | Project JSON stores pure logical definitions (`cells`, `paletteAssignments`, `activeMapId`); no derived physical CHR buffers are persisted.                                                                                     |
| 11   | Reopen the saved `.p2c` file.                                                                          | Map configuration, placed tiles, subpalette assignments, and active map selection restore with 100% fidelity.                                                                                                                   |
| 12   | In **Deliver & Export**, export `.nam`, `.atr`, `.map`, `.chr`, `.pal`, cc65 C, and ca65 ASM.          | Production files compile with exact byte lengths (960B `.nam`, 64B `.atr`, 1024B `.map`, 8192B/4096B `.chr`, 16B `.pal`); C header defines `${ID}_BACKGROUND_PATTERN_TABLE`; ASM source emits cleanly structured `.byte` lines. |

## Automated counterpart

Run these checks before or alongside the manual flow:

```bash
npm test -- src/core/background-pipeline-e2e.test.ts src/core/background-exporters.test.ts src/core/background-model.test.ts src/core/chr-background-allocation.test.ts
npm test
npm run build
npm run lint
npm run format:check
```

The focused suite covers PNG failure/recovery, effective mapping and flip
orientation, raw CHR occupancy, PT0/PT1 local/physical indexing, sparse-slot
allocation, 8 KiB output, project persistence/removal, CHR regions/reservations CRUD,
asset identity persistence, bidirectional mapping, lifecycle reconciliation,
CHR inspector attributions, per-asset metrics, ownership diagnostics, transparent cell omission,
flip-aware deduplication, reimport reconciliation, aligned multi-target exporters,
Background domain model, Attribute Table 16×16 packing/unpacking, Background CHR allocation with Base CHR and Reservations,
Background project persistence purity, pure Background exporters (.nam, .atr, .map, .chr, .pal, cc65, ca65),
and cross-mode non-regression.
Browser-level file chooser and download interactions remain manual because the
repository deliberately has no browser/E2E harness.
