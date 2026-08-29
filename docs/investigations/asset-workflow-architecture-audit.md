# Asset Workflow Architecture Audit before Milestone 12

**Date:** 2026-08-29  
**Scope:** Read-only audit of graphics assets, screens, Background Maps, Animation, CHR layout, ownership, palettes, diagnostics, and Delivery & Export.  
**Baseline:** `main` at the working tree inspected on the date above. No implementation, issue, branch, or pull-request changes are part of this audit.

## Executive conclusion

PNG2CHR Studio has mature isolated domain pieces, especially the Animation allocator, Background allocator, palette manager, CHR Regions/Reservations, ownership index, and pure exporters. It does **not** yet have one project-wide graphics compilation boundary. Older Tileset and Playfield workflows, newer Background and Animation workflows, CHR Memory, diagnostics, and Delivery independently reconstruct or assume physical CHR placement. Those reconstructions are not equivalent.

Milestone 12 should not build code export directly on the current orchestration. The critical prerequisite is one canonical compilation result that binds every logical tile reference to a physical CHR slot and supplies the exact Nametable/OAM bytes, ownership facts, diagnostics, and exported CHR bytes consumed everywhere else.

Repository evidence does not justify keeping Playfield as a second canonical screen/map domain. It does justify preserving its useful workflow: import a full 256×240 PNG, generate a test screen, edit pixels/palettes, paint collisions, and get immediate artifacts. The recommended boundary is therefore:

- keep **full-screen PNG conversion** as an import operation or preset;
- keep **collision editing** as a map-owned gameplay layer;
- merge the resulting screen state into **Background Maps**, which already owns the logical 32×30 grid, 16×15 palette assignments, explicit Background Pattern Table, compiled Nametable, Attribute Table, and physical CHR resolution;
- retire the standalone persisted Playfield screen representation after a backward-compatible migration.

This is a merge of duplicated screen semantics, not removal of the Playfield workflow.

## Finding classifications

This report uses these labels consistently:

| Label                          | Meaning                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verified defect**            | Current code can demonstrably lose state, produce mutually inconsistent outputs, target the wrong identity, or claim behavior it does not implement. |
| **Architectural debt**         | Current pieces can work in isolation, but there is no authoritative project-wide boundary or invariant supporting future composition.                |
| **UX/discoverability problem** | Controls or labels obscure the actual domain operation, even when underlying behavior can be valid.                                                  |
| **NES hardware constraint**    | A limit or encoding rule imposed by NES PPU/OAM behavior.                                                                                            |
| **Studio policy**              | A project convention or product decision, not a hardware fact.                                                                                       |
| **Proposed improvement**       | Recommended target behavior; not current functionality.                                                                                              |

## Current architecture and data-flow map

### Persisted and runtime boundaries

`StudioProject` declares Tileset, Playfield, Backgrounds, Animation, palettes, CHR Regions, and Scene state as one durable project schema ([`src/core/project.ts:176`](../../src/core/project.ts#L176)). Runtime uses one `ProjectView` whose top-level `fileName`, source image, indexed image, extracted `tiles`, palette assignments, pixel overrides, and `mode` represent only one legacy Tileset/Playfield source at a time. Animation and Background state are additional fields on that view ([`src/ui/types.ts:77`](../../src/ui/types.ts#L77)). `ProjectMode` still has only `tileset | playfield | animation`; Background is a workspace, not a project mode ([`src/core/project-mode.ts:1`](../../src/core/project-mode.ts#L1), [`src/ui/workspace-state.ts:22`](../../src/ui/workspace-state.ts#L22)).

The documented boundary says `buildCurrentStudioProject()` is the only runtime-to-persistence projection and must contain project-owned state ([`docs/project-state-boundaries.md:3`](../project-state-boundaries.md#L3), [`docs/project-state-boundaries.md:25`](../project-state-boundaries.md#L25)). That projection currently omits `chrRegions` and `backgrounds` even though both exist in `StudioProject` ([`src/main.ts:546`](../../src/main.ts#L546)). Loading also reconstructs only the active mode: animation-mode loading omits Backgrounds, while Tileset/Playfield loading omits Backgrounds and replaces Animation with defaults ([`src/main.ts:850`](../../src/main.ts#L850), [`src/main.ts:1054`](../../src/main.ts#L1054)).

Ordinary asset import is another replacement boundary, not a focused field update: `loadFile()` supplies a new `ProjectView` without `backgrounds`, `chrRegions`, `scenePreview`, the logical palette library/slot fields, or the current asset ID ([`src/main.ts:4246`](../../src/main.ts#L4246)). Those optional fields therefore disappear from runtime as soon as a user imports a new Tileset/Playfield source. This makes the current “project” behave as an active conversion session despite its multi-asset persisted schema.

### Current split compilation paths

```text
Tileset PNG/CHR/NES
  -> one ProjectView image/tile array
  -> UI-local map/deduplicate/encode/pad
  -> raw or separately recomposed CHR

Playfield PNG
  -> one ProjectView image/tile array
  -> encodePlayfield (deduplicate + local 0..255 indexes)
  -> Nametable/Attribute Table
  -> separate CHR composition that may move tiles

Background Map
  -> persisted logical cells + BG slot assignments + explicit PT
  -> buildBackgroundProjectModel
  -> allocation + resolved cells + Nametable + Attribute Table + final CHR

Animation source(s)
  -> persisted frame/animation definitions + explicit sprite PT
  -> buildAnimationProjectModel
  -> allocation + OAM local indexes + final CHR

CHR Memory / ownership / diagnostics / Delivery
  -> rebuild one or more of the above with additional assumptions
  -> do not consume one shared project-wide compilation result
```

### Canonical representation by concept

| Concept                     | Intended/current durable source                                                                                                                                               | Current runtime or derived source                                                                             | Audit result                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Graphics source asset       | Scattered `ProjectAssetReference` values in `tileset.asset`, `playfield.asset`, `backgrounds.maps[].asset`, animation items, and `animation.destinationChr`                   | `extractProjectAssets()` derives a registry; the active legacy source lives in top-level `ProjectView` fields | **Architectural debt:** stable IDs exist, but no durable asset catalog owns all source graphics and their derived tiles.        |
| Logical tile identity       | `LogicalTileKey = assetId:tileX:tileY`; Background cells persist it; animation derives it                                                                                     | Tileset/Playfield often reconstruct it from current mode and coordinates                                      | **Architectural debt:** model is sound, adoption is incomplete.                                                                 |
| Tileset                     | `tileset.asset`, palette assignments, pixel overrides                                                                                                                         | One current source image and `project.tiles`                                                                  | **Architectural debt:** a source-graphics concept is coupled to project mode and immediate export.                              |
| Playfield                   | `playfield.asset`, collision cells, palette assignments, pixel overrides                                                                                                      | One current 256×240 image, deduplicated tiles, generated Nametable and Attribute Table                        | **Architectural debt plus verified defects:** screen source, screen layout, CHR packing, collision, and delivery are conflated. |
| Background Map              | `BackgroundMapDefinition`: stable map ID, explicit PT, logical cells, 16×15 BG-slot assignments ([`src/core/background-model.ts:80`](../../src/core/background-model.ts#L80)) | `BackgroundProjectModel`: resolved physical cells, final CHR, Nametable, Attribute Table                      | Best current screen-domain boundary, but runtime asset resolution and persistence integration are incomplete.                   |
| Animation                   | Animation source references and logical frame definitions                                                                                                                     | `AnimationProjectModel` with explicit sprite PT, OAM-local indexes, physical assignments, and final CHR       | Strong isolated pipeline; not compiled together with Background/Tileset demands.                                                |
| Base CHR                    | Nested under `animation.destinationChr`, including its short-file destination PT                                                                                              | Reused by other workspaces as a de facto project-wide Base CHR                                                | **Architectural debt:** project-wide resource is owned by Animation settings.                                                   |
| CHR Regions/Reservations    | `StudioProject.chrRegions`; PT-local inclusive ranges                                                                                                                         | Runtime reservation sets; regions organize, reservations block new allocation                                 | Sound core model, but save integration and legacy workflow use are inconsistent.                                                |
| Physical CHR layout         | Intentionally not persisted                                                                                                                                                   | Several independently built slot arrays/final CHR buffers                                                     | **Critical architectural debt:** no single project compilation manifest.                                                        |
| Ownership and asset mapping | Intentionally not persisted                                                                                                                                                   | `ChrAssetMappingIndex`, derived from supplied models plus reconstructed legacy allocation                     | Correct boundary in principle; some inputs do not match actual exported placement.                                              |
| Palettes                    | Project palette library, universal `$3F00`, four BG slots, four SPR slots                                                                                                     | Resolved palette state and binary/source exporters                                                            | Largely canonical. Consumers still differ in how they persist a logical palette ID versus a hardware slot.                      |
| Collision                   | `playfield.collisionCells` only                                                                                                                                               | 32×30 4-bit Studio collision types, packed to 480 bytes                                                       | **Studio policy**, not NES hardware. It belongs to a screen/map or gameplay layer, not a graphics source.                       |
| Diagnostics                 | Not persisted                                                                                                                                                                 | Multiple domain analyzers fed by independently reconstructed models                                           | Good analyzers can report facts about the wrong or incomplete projection.                                                       |
| Delivery                    | Not persisted                                                                                                                                                                 | Active-mode artifact assembly                                                                                 | **Architectural debt and verified omissions:** not a project delivery manifest.                                                 |

## How each workflow currently reaches physical CHR

### Tileset / graphics

1. The shared import panel accepts PNG, CHR, NES ROM, or project files in Tileset mode ([`src/ui/image-input.ts:128`](../../src/ui/image-input.ts#L128)). CHR and NROM are decoded into tiles and treated as the current Tileset source, not as a project-level Base CHR ([`src/main.ts:4289`](../../src/main.ts#L4289)).
2. PNG input is quantized, mapped through current BG palettes, and extracted into `project.tiles` ([`src/main.ts:4361`](../../src/main.ts#L4361)).
3. The Tileset workspace performs mapping and deduplication again, then exports `padChrRom(encodeChr(visibleTiles))`. That puts the tile list contiguously at the beginning of the output; no destination PT, Region, Reservation, or Base CHR participates ([`src/ui/tileset-workspace.ts:121`](../../src/ui/tileset-workspace.ts#L121), [`src/ui/tileset-workspace.ts:145`](../../src/ui/tileset-workspace.ts#L145)).
4. CHR Memory and Delivery use a different path. If Base CHR or Regions exist, `composeChrWithAllocatedTiles()` reconstructs placement by scanning physical slots from index 0 and skipping occupied/reserved slots ([`src/core/chr-pattern-table.ts:1203`](../../src/core/chr-pattern-table.ts#L1203)).
5. Ownership uses yet another reconstruction: it constrains Tileset placement to `destinationPatternTable`, which is borrowed from Animation settings ([`src/core/chr-asset-mapping.ts:495`](../../src/core/chr-asset-mapping.ts#L495)).

**Result:** Tileset has no explicit allocation intent. Inline export, Delivery/CHR composition, ownership, and CHR editing can disagree about the same tile's physical address.

### Playfield / game screen

1. A 256×240 PNG is mapped through BG palettes and split into 960 tiles.
2. `encodePlayfield()` deduplicates exact tiles and emits a Nametable whose bytes are positions in the deduplicated tile list, always `0..255` ([`src/core/playfield-encoder.ts:48`](../../src/core/playfield-encoder.ts#L48)). It has no Base CHR, PT, Region, Reservation, or allocator input.
3. The Playfield workspace exports CHR by encoding that deduplicated list contiguously from the start, so its local Nametable indexes match only that standalone CHR assumption ([`src/ui/playfield-workspace.ts:170`](../../src/ui/playfield-workspace.ts#L170), [`src/ui/playfield-workspace.ts:188`](../../src/ui/playfield-workspace.ts#L188)).
4. Delivery may instead compose the same tile list around Base CHR and Reservations, but it does not rewrite the Nametable with the resulting allocated local indexes ([`src/main.ts:3775`](../../src/main.ts#L3775), [`src/main.ts:3802`](../../src/main.ts#L3802)). `composeChrWithAllocatedTiles()` is not limited to one Pattern Table and silently stops when it cannot find another slot.
5. Delivery tells Nametable validation to use `animation.destinationPatternTable` as the background PT ([`src/main.ts:3891`](../../src/main.ts#L3891)). Playfield itself has no background PT field.

**Verified defect:** when an occupied Base CHR slot or Reservation shifts a Playfield tile away from its deduplicated list index, exported Nametable bytes no longer select the exported tile. The diagnostic may label reserved backing as informational or empty backing as a warning, but it does not repair the artifact pair and does not prevent every download.

This also confirms the reported PT0 concern. Without Base CHR/Regions, standalone Playfield CHR begins at physical slot 0. With composition, new tiles still begin searching at physical slot 0. There is no explicit Background PT selection in Playfield, so sprite content already in PT0 can be overwritten, displaced, or merely described differently by diagnostics.

### Background Maps

1. A map persists logical tile references, not physical CHR indexes. It explicitly selects PT0 or PT1 and stores 16×15 BG slot assignments ([`src/core/background-model.ts:80`](../../src/core/background-model.ts#L80)).
2. `allocateBackgroundChr()` resolves each logical tile, reuses exact Base/project tiles in the selected PT, skips reservations for new allocation, and emits both local and physical indexes.
3. `buildBackgroundProjectModel()` produces the authoritative per-map Nametable, Attribute Table, resolved cells, slots, and 8 KiB final CHR ([`src/core/chr-background-allocation.ts:438`](../../src/core/chr-background-allocation.ts#L438)).
4. Pure exporters already exist for `.nam`, `.atr`, `.map`, full or PT-slice `.chr`, `.pal`, cc65 C, and ca65 Assembly ([`src/core/background-exporters.ts:1`](../../src/core/background-exporters.ts#L1)).

The isolated core path is coherent. Orchestration is not:

- every project asset is mapped to the same single `project.tiles` array when Background sources are built ([`src/main.ts:3362`](../../src/main.ts#L3362), [`src/main.ts:3961`](../../src/main.ts#L3961));
- persisted Background assets are parsed by `deserializeProject()`, but `loadProjectFile()` does not reconstruct or retain `loaded.backgrounds`;
- selecting a source asset changes only `map.assetId`, not its durable `asset` reference, and existing cell keys are not reconciled ([`src/main.ts:4058`](../../src/main.ts#L4058));
- each map is compiled independently from the same Base CHR, so multiple map models are not proof of one compatible project-wide CHR layout;
- a short Base CHR is always placed with destination PT0 inside `buildBackgroundProjectModel()`, regardless of the Animation-owned destination PT setting ([`src/core/chr-background-allocation.ts:444`](../../src/core/chr-background-allocation.ts#L444));
- `createEmptyBackgroundMap()` defaults every new map to `bg_map_default`, and the UI does not supply a unique ID, so adding a second map creates duplicate identity and ID-based edit/delete ambiguity ([`src/core/background-model.ts:273`](../../src/core/background-model.ts#L273), [`src/main.ts:4002`](../../src/main.ts#L4002)).

### Sprite sheet / Animation

1. Each animation item owns a stable editor ID, source asset reference, frame geometry, logical frame sequence, palette reference/overrides, and pixel overrides.
2. The UI explicitly selects the sprite Pattern Table and the placement of a short Base CHR ([`src/ui/animation-editor.ts:476`](../../src/ui/animation-editor.ts#L476)).
3. `buildAnimationProjectModel()` builds slots from Base CHR, limits allocation to the selected sprite PT, skips Reservations, reuses exact/flip-equivalent tiles, and emits both 8-bit OAM-local indexes and physical indexes.
4. Animation JSON/C/ASM and CHR exporters consume this same compiled model.

This is the strongest end-to-end path. Its remaining project-level problem is isolation: it compiles without the logical tile demands of Tileset/Background Maps. The project can therefore derive a valid Animation `finalChr` and a valid Background `finalChr` that assign different pixels to the same physical slot. Current code has no residency/bundle model to say whether that is legal because of bank switching or invalid because assets must coexist.

## PT0/PT1 and physical slot selection matrix

| Workflow                    | PT selection                                                                                                      | Physical slot selection                                                | Current status                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Tileset inline export       | None; implicit start of file/PT0                                                                                  | Contiguous encoded tile list                                           | **UX problem and architectural debt.**                                                  |
| Tileset CHR Memory/Delivery | Borrows `animation.destinationPatternTable` only for short Base CHR placement; new allocation scans all 512 slots | First available physical slot, Reservations skipped                    | **Verified mismatch** with inline export and ownership's PT-constrained reconstruction. |
| Playfield inline export     | None; implicit PT0                                                                                                | Deduplicated list index equals local tile index                        | Internally coherent only as a standalone artifact set.                                  |
| Playfield Delivery          | Uses Animation's destination PT as validation assumption                                                          | CHR composition scans all 512; Nametable remains unremapped            | **Verified defect.**                                                                    |
| Background Map              | Explicit `map.patternTable`                                                                                       | Exact reuse or first unreserved slot within that PT                    | Coherent per map.                                                                       |
| Animation                   | Explicit sprite `patternTable`; separate short-Base-CHR `destinationPatternTable`                                 | Exact/flip reuse or first unreserved slot within sprite PT             | Coherent per animation build.                                                           |
| CHR Regions/Reservations    | Explicit PT and local `$00..$FF` range                                                                            | Converted to physical `0..511` set                                     | Core semantics are clear.                                                               |
| CHR Editor                  | User selects physical `0..511` slot                                                                               | Origin resolver reconstructs legacy placement, or uses animation model | Correct for Animation/Base; unreliable for shifted Tileset/Playfield placement.         |

### Hardware constraints versus Studio policy

| Rule                                                                                                                                                   | Classification                | Consequence                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each 4 KiB Pattern Table has 256 8×8 tiles; Nametable and 8×8 OAM tile fields are 8-bit local indexes.                                                 | **NES hardware constraint**   | A background or sprite compilation target cannot spill into the other PT while preserving the same index semantics.                                                                                                                                                               |
| A 32×30 screen produces 960 Nametable bytes and 64 Attribute Table bytes; each Attribute quadrant selects one of four BG subpalettes for a 16×16 area. | **NES hardware constraint**   | Screen compiler must emit map and palette selection together.                                                                                                                                                                                                                     |
| Background tiles have no per-cell flip bits; sprite OAM does.                                                                                          | **NES hardware constraint**   | Background deduplication must be exact; animation may be flip-aware and export attributes.                                                                                                                                                                                        |
| `region` is organizational; `reservation` blocks only new automatic allocation and may contain/reuse existing tiles.                                   | **Studio policy**             | It must be applied by the authoritative allocator, not inferred by exporters.                                                                                                                                                                                                     |
| Zero-filled imported Base CHR tiles count as free because raw CHR carries no occupancy metadata.                                                       | **Studio limitation/policy**  | Blank art is not proof of semantic availability; the project cannot know intent without extra metadata.                                                                                                                                                                           |
| `.col` is a 480-byte, 4-bit, 11-type collision format.                                                                                                 | **Studio/game-engine policy** | It should never be presented as an NES PPU requirement.                                                                                                                                                                                                                           |
| Error diagnostics block readiness.                                                                                                                     | **Studio policy**             | Current UI computes `isReady` for status only; available artifact buttons are still created without consulting it ([`src/ui/delivery-workspace.ts:678`](../../src/ui/delivery-workspace.ts#L678), [`src/ui/delivery-workspace.ts:975`](../../src/ui/delivery-workspace.ts#L975)). |

## Ownership and identity semantics at transitions

| Transition                                | Required identity                                                                     | Current behavior                                                                                                                                                                                                                     | Finding                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| File/source to asset                      | Stable `ProjectAssetId`                                                               | IDs are optional in references and normalized deterministically for legacy projects                                                                                                                                                  | Acceptable migration mechanism, but scattered ownership prevents multi-asset lifecycle. |
| Asset tile to logical tile                | `(assetId, tileX, tileY)` / `LogicalTileKey`                                          | Background and Animation preserve it; Tileset/Playfield reconstruct it from current mode                                                                                                                                             | Partial adoption.                                                                       |
| Logical tile to physical slot             | Compiler allocation record                                                            | Background/Animation produce records; Tileset/Playfield mapping re-simulates placement                                                                                                                                               | **Critical inconsistency.**                                                             |
| Physical slot to Nametable/OAM local byte | `physicalIndex % 256` in an explicitly selected PT                                    | Background/Animation derive from the allocation; Playfield derives before later composition                                                                                                                                          | **Verified defect for shifted Playfield allocation.**                                   |
| Physical slot to ownership                | One origin plus zero or more usages                                                   | `ChrAssetMappingIndex` is the right derived structure                                                                                                                                                                                | Inputs are sometimes fictional placements.                                              |
| Runtime asset to mapping diagnostics      | Same stable asset ID as active asset registry                                         | Main passes hard-coded `asset-tileset` and `asset-playfield`, while `extractProjectAssets()` may expose persisted IDs such as `asset-tileset-default` or custom IDs ([`src/main.ts:3864`](../../src/main.ts#L3864))                  | **Verified defect:** false dangling/missing-origin diagnostics are possible.            |
| Physical CHR edit to canonical source     | Allocation record's origin and sharing semantics                                      | Legacy resolver assumes contiguous Tileset placement or `destinationPatternTable + Nametable byte`, ignoring shifted reservation/Base allocation ([`src/core/chr-pattern-table.ts:1695`](../../src/core/chr-pattern-table.ts#L1695)) | **Verified defect:** the selected physical slot can update the wrong source tile.       |
| Shared physical tile edit                 | Explicit decision: edit origin, all usages, detach one usage, or materialize override | Resolver selects one source target; recompile may split or move the tile                                                                                                                                                             | **Architectural debt/UX ambiguity.**                                                    |

Reservation is not ownership. Logical asset existence is not physical allocation. Matching numeric tile indexes across the current code are not sufficient evidence of identity.

## Playfield versus Background Maps

### Actual overlap

| Responsibility                     | Playfield                                       | Background Maps                                 |
| ---------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| 256×240 / 32×30 screen             | Fixed full-screen PNG                           | Fixed logical 32×30 map                         |
| Tile selection                     | Implicit from source image position             | Explicit logical source tile references         |
| Nametable                          | Generated by `encodePlayfield()`                | Generated by compiled allocation                |
| Attribute Table                    | Generated from Playfield palette assignments    | Generated from map palette assignments          |
| Background palettes                | Edits current BG assignments/pixels             | Paints BG hardware slot 0..3 per 16×16 quadrant |
| Pattern Table                      | Not owned; inferred elsewhere                   | Explicit per map                                |
| CHR allocator                      | Not used by encoder; separate later composition | Integrated with Base CHR and Reservations       |
| Multiple screens                   | No                                              | Yes by schema/UI intent                         |
| Collision                          | Yes, one top-level map                          | No                                              |
| Full-screen PNG convenience import | Yes                                             | No direct contextual import                     |
| Procedural test screen             | Yes                                             | No                                              |

### Decision

Keeping both as authoritative screen models is not justified. The duplicated outputs have different CHR semantics, and only Background Maps preserves the logical-to-physical boundary needed by Milestone 12.

Keeping both **workflows** is justified. The Playfield screen importer is valuable because converting completed 256×240 art is a different authoring action from manually composing a map from a tile catalog. It should become an operation that creates or replaces a `BackgroundMapDefinition` and its source asset, then hands allocation to the Background compiler. The procedural generator should be another map creation operation.

### Collision responsibility and relocation

Collision describes gameplay interpretation of screen cells, not pixels, source tiles, CHR slots, or NES PPU state. If Playfield is merged:

- move the 32×30 collision grid from singleton `playfield.collisionCells` to the corresponding Background Map, or to a map-owned optional layer keyed by map ID;
- retain `activeCollisionType` as transient editor state, not durable map semantics unless the selected tool must reopen exactly;
- keep `.col` encoding as a pure serializer of the map collision layer;
- migrate legacy Playfield collision cells into the generated/imported first Background Map;
- do not attach collision to Tileset assets, because the same source tile can have different gameplay meaning in different screen cells;
- decide separately whether future scrolling maps need collision dimensions beyond 32×30. Current NES-screen dimensions are a Studio MVP constraint, not a general hardware prohibition on larger level data.

## Inconsistencies with CHR Regions, Reservations, and allocator

1. **Verified defect — Playfield map/CHR divergence.** `encodePlayfield()` assigns dense local indexes before allocation; later composition skips Base/Reserved slots without remapping the Nametable.
2. **Verified defect — unrestricted composition.** `composeChrWithAllocatedTiles()` scans all 512 physical slots rather than one consumer-selected PT and silently stops on exhaustion.
3. **Architectural debt — Tileset has no allocation request.** The UI cannot select target PT, Region, exact range, or intended role; the ownership layer borrows Animation's destination setting.
4. **Verified inconsistency — three legacy placements.** Inline export is contiguous PT0, Delivery composition is global first-free, and ownership is PT-constrained first-free.
5. **Verified defect — CHR Editor legacy origin lookup.** Physical edits use contiguous/dense assumptions instead of the allocation that produced current CHR.
6. **Architectural debt — independent allocators have no shared slot plan.** Background maps and animations each start from Base CHR and cannot prove project-wide co-residency.
7. **Verified defect — Background short Base CHR destination.** Per-map build hard-codes PT0 placement.
8. **Correct Studio policy — reservation reuse.** Existing matching tiles may still be referenced in a reservation; only new allocation is blocked. This should remain explicit and shared by the compiler.

## Persisted state, runtime state, diagnostics, and exporter inconsistencies

### Data loss and reconstruction

- **Verified defect:** Save omits `backgrounds` and `chrRegions` from the only runtime projection, contradicting both schema and state-boundary documentation.
- **Verified defect:** Load discards Backgrounds in every mode and discards persisted Animation when opening a Tileset/Playfield project.
- **Verified defect:** importing a new legacy source replaces `ProjectView` with an object that omits other project-owned asset families, CHR Regions, Scene, and logical palette-manager state.
- **Verified defect:** Background source assets are not reconstructed into per-asset tile catalogs. The runtime maps every discovered asset ID to one active `project.tiles` array.
- **Verified defect:** new Background maps receive duplicate default IDs.
- **Coverage gap:** project persistence tests serialize manually constructed `StudioProject` values and prove `serializeProject()`/`deserializeProject()` purity, but they do not pass through `buildCurrentStudioProject()` or `loadProjectFile()` ([`src/core/project.test.ts:1490`](../../src/core/project.test.ts#L1490)). There is no `main.ts` round-trip integration test.

### Diagnostics

- CHR Region, palette, OAM, scanline, scene visibility, Nametable backing, and ownership analyzers are mostly pure and well separated.
- Their orchestration is not canonical. Slot classification, ownership mapping, CHR Editor origin resolution, Playfield Nametable encoding, and final CHR can each use different placement assumptions.
- A warning that a Nametable points to an empty slot can be factually correct for the supplied classification but still fail to identify the underlying compiler defect: the tile exists elsewhere because CHR was moved without remapping the Nametable.
- Background compilation failures are swallowed by `buildProjectBackgroundModels()`, which returns only successfully compiled maps. Delivery cannot distinguish “no map” from “map failed to compile” at that boundary ([`src/main.ts:3394`](../../src/main.ts#L3394)).
- Ownership diagnostics can be false errors because hard-coded legacy asset IDs differ from active persisted IDs.

### Delivery and exporters

- Pure Background exporters exist, and documentation/smoke tests claim Delivery exposes them ([`docs/stabilization-smoke-test.md:120`](../stabilization-smoke-test.md#L120)). Delivery artifact assembly has only Animation, Playfield, and Tileset branches; it never adds Background `.nam/.atr/.map/.chr/.pal/C/ASM` artifacts ([`src/ui/delivery-workspace.ts:767`](../../src/ui/delivery-workspace.ts#L767)). **Verified defect/documentation drift.**
- Delivery is gated by `ProjectMode`, so it cannot assemble a project containing graphics sources, maps, and animations. **Architectural debt.**
- Delivery status computes errors, warnings, and readiness, but downloads are not universally disabled when errors exist. **Verified workflow defect relative to documented blocking semantics.**
- Tileset and Playfield still expose inline export panels that bypass consolidated project readiness and use different CHR construction from Delivery. **Architectural debt and UX problem.**
- Milestone 12 code exporters would have no reliable choice among raw asset order, active-mode CHR, per-map CHR, or animation CHR.

### Outdated UI artifacts

The reported import artifact is present. Both Tileset and Playfield render the shared `createImageInput()` panel and its mode selector. Its heading is always “Import PNG, CHR, or NROM,” including Playfield, although Playfield's file input accepts only PNG/project files ([`src/ui/image-input.ts:19`](../../src/ui/image-input.ts#L19), [`src/i18n/translations.ts:25`](../../src/i18n/translations.ts#L25)). The sidebar already supplies workspace navigation, so the embedded mode selector duplicates navigation and reinforces the obsolete single-active-mode model.

Classification:

- misleading Playfield heading: **verified UX defect**;
- duplicate workspace/mode controls: **UX/discoverability problem**;
- treating CHR/NROM decode as a Tileset import without distinguishing “tile source,” “Base CHR,” and “inspect ROM graphics”: **architectural and UX ambiguity**;
- inline export panels inside authoring workspaces: **workflow debt** once Delivery is intended to be authoritative.

## Risks to Milestone 12 if unresolved

| Risk                                    | Impact on code and asset export                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| No canonical project compilation result | C/ASM metadata can name tile indexes that do not match emitted CHR bytes.                                                        |
| Active-mode persistence and delivery    | Export silently excludes valid maps, animations, Regions, or Reservations outside the active legacy mode.                        |
| Playfield CHR/Nametable divergence      | Generated screen code displays wrong tiles even though each file has valid byte length.                                          |
| Independent map/animation CHR builds    | One project-wide `.chr` cannot be selected without undefined overwrite/precedence rules.                                         |
| No asset residency/bundle model         | Export cannot know which screens/entities must coexist or may use separate banks.                                                |
| Re-simulated ownership                  | Symbol maps, resource reports, and diagnostics can refer to slots not present in the downloaded CHR.                             |
| Hard-coded/fallback identities          | Generated symbol names and asset-to-CHR maps may not remain stable across save/load or migration.                                |
| Background export absent from Delivery  | Milestone 12 could duplicate exporters instead of integrating the existing correct serializers.                                  |
| Error status does not gate downloads    | Users can export a known-invalid bundle and interpret “Action Required” as advisory.                                             |
| Schema v1 ambiguity                     | Adding export manifests before fixing canonical state risks freezing accidental mode/layout assumptions as an external contract. |

## Proposed target architecture

### 1. Durable logical project model

Persist logical intent only:

- a project-level graphics asset catalog with stable IDs, source reference/data, asset kind, quantization settings, palette-context inputs, and pixel overrides;
- Background Maps/Screens with stable IDs, logical tile references, 16×15 BG slot assignments, explicit Background PT, and optional map-owned collision layers;
- Animation definitions referring to source asset IDs, with frame selection, timing, logical palette IDs, sprite PT intent, and flips;
- project-level Base CHR and CHR layout policy;
- CHR Regions and Reservations;
- canonical palette library, universal `$3F00`, and active BG/SPR hardware slots.

Do not persist physical allocation merely as a cache. If future requirements need fixed ABI addresses, persist explicit allocation constraints or locks as user intent, then compile them.

### 2. One project graphics compiler

Introduce one pure orchestration boundary, conceptually:

```text
StudioProject + decoded asset tiles + export/residency target
  -> compileProjectGraphics(...)
  -> CompiledProjectGraphics
       finalChr
       physical slot manifest
       logical-to-physical placements
       compiled Background maps (Nametable, Attribute Table, collision)
       compiled animations (OAM-local indexes and metadata)
       palette binaries/slot resolutions
       typed diagnostics
       export readiness
```

The compiler should call existing focused primitives rather than replace them. It must allocate all consumers that are declared co-resident against one slot array, in a deterministic order, and fail atomically on capacity or constraint conflicts. It must never silently truncate.

### 3. Explicit residency/export target

For the current lightweight/NROM scope, the simplest valid default is one static 8 KiB CHR layout with one Background PT selection per screen and one Sprite PT selection for its animations. If assets are not required to coexist, the project must say so through explicit export bundles/residency groups; independent per-map CHR builds must not be silently combined.

Mapper banking and CHR-RAM streaming remain future capabilities. Until modeled, diagnostics and exporters must not infer them.

### 4. One allocation manifest for all consumers

`ChrAssetMappingIndex`, CHR slot classifications, CHR Memory, Tile Inspector, CHR Editor origin resolution, diagnostics, and Delivery must consume placements from `CompiledProjectGraphics`. They must not independently call a first-free algorithm for legacy modes.

The manifest should preserve:

- physical slot and PT-local index;
- logical tile key;
- origin asset and creation kind;
- all usages;
- reuse transform where hardware supports it;
- reservation/region membership;
- exact exported tile bytes or an immutable reference to the compiled slot.

### 5. Screen import and collision

Create a “New screen from full PNG” operation that:

1. registers a graphics asset;
2. quantizes/maps it through BG palettes;
3. creates a Background Map with one logical cell per source tile;
4. transfers its 16×15 palette assignments;
5. attaches a 32×30 collision layer when requested;
6. compiles through the same Background/project compiler as manually composed maps.

Procedural Playfield generation should produce the same logical result. A legacy Playfield migration should perform this conversion deterministically.

### 6. Delivery as project manifest

Delivery should enumerate artifacts from the compiled project/bundle, not the active editor mode. Existing Background, Animation, palette, and binary serializers should remain pure leaf exporters. Generated C/ASM should use stable asset/map/animation IDs and the exact same allocation manifest as `.chr`, `.nam`, `.atr`, OAM, and diagnostics.

Raw per-asset CHR can remain a developer utility, but it must be named and labeled as an unallocated tile pack, distinct from production project CHR.

## Keep / Merge / Move / Rename / Remove decisions

| Concept/workspace                        | Decision                                                                             | Rationale                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Tileset source concept                   | **Keep**                                                                             | Reusable graphics sources and tile inspection remain necessary.                                                  |
| Tileset workspace                        | **Rename** to “Graphics Assets” or “Tile Sources”                                    | It should manage logical sources, not imply ownership of final CHR placement.                                    |
| Tileset inline production export         | **Move/Rename**                                                                      | Move production export to Delivery; retain optional “raw unallocated tile pack” utility with explicit semantics. |
| Standalone Playfield domain/workspace    | **Merge** into Background Maps                                                       | Both own one NES screen's map/attribute outputs; only Background has explicit logical/physical separation.       |
| Full-screen PNG import                   | **Keep and Move**                                                                    | Keep as “New screen from PNG” inside Screens/Background Maps.                                                    |
| Procedural Playfield generator           | **Keep and Move**                                                                    | Keep as a Background Map creation tool.                                                                          |
| Playfield collision grid                 | **Move** to map-owned collision layer                                                | Collision is cell/gameplay data for a screen, not source-asset or CHR data.                                      |
| Background Maps workspace                | **Keep and Rename** to “Screens & Background Maps” if full-screen import moves there | Clarifies both composition and imported-screen workflows.                                                        |
| Background logical model                 | **Keep and extend**                                                                  | It is the best current canonical screen model; add collision and migration support.                              |
| Animation workspace/model                | **Keep**                                                                             | Strong logical and compiled pipeline.                                                                            |
| Animation-owned Base CHR controls        | **Move** to CHR Memory/project layout settings                                       | Base CHR is project-wide, not animation-owned.                                                                   |
| Sprite PT selection                      | **Keep**, but bind to export/residency target                                        | It is hardware-relevant allocation intent.                                                                       |
| CHR Memory                               | **Keep**                                                                             | Make it a projection/editor of the one compiled layout.                                                          |
| CHR Regions/Reservations                 | **Keep**                                                                             | Semantics are useful and already well defined; compiler must govern every new allocation.                        |
| Ownership index                          | **Keep**, change input                                                               | Derive only from compilation manifest; remove legacy re-allocation simulation.                                   |
| Palette Manager                          | **Keep**                                                                             | Current logical palette library and hardware slot separation are sound.                                          |
| Generic “Import PNG, CHR, or NROM” panel | **Remove/replace**                                                                   | Use contextual actions: add PNG asset, import Base CHR, inspect/extract NROM CHR, open project.                  |
| Embedded legacy mode selector            | **Remove**                                                                           | Sidebar/workspace navigation already owns editor selection; project data must not be mode-gated.                 |
| `ProjectMode` as persistence/export gate | **Remove or narrow** to legacy migration/default editor intent                       | It must not decide which durable project objects exist or export.                                                |
| Delivery & Export                        | **Keep and expand**                                                                  | It should become authoritative project/bundle export driven by one compiler result.                              |

## Recommended follow-up issues in dependency order

### 1. `fix: preserve complete project state through runtime save/load`

**Priority:** P0, data safety.

- Include `backgrounds` and `chrRegions` in `buildCurrentStudioProject()`.
- Reconstruct all persisted asset families on load instead of replacing non-active families with defaults.
- Add browser-orchestrator round-trip tests that exercise the actual runtime projection, not only pure `StudioProject` serialization.
- Fix unique Background map ID generation.
- Do not change schema shape in this issue unless required for lossless preservation.

### 2. `architecture: define graphics asset catalog, residency target, and schema migration contract`

**Priority:** P0, Milestone 12 blocker.

- Decide project asset catalog shape and whether it requires `formatVersion: 2`.
- Decide static NROM layout versus explicit export bundles/residency groups.
- Move Base CHR ownership and placement policy to project-level design.
- Specify deterministic v1 migration for Tileset, Playfield, Background assets, Animation sources, IDs, and embedded data.

### 3. `core: add canonical project-wide CHR compiler and immutable allocation manifest`

**Priority:** P0, depends on issue 2.

- Compile Base CHR, Reservations, logical demands, PT constraints, and all co-resident consumers against one 512-slot model.
- Emit exact final CHR, placement records, per-consumer local indexes, typed failures, and capacity facts.
- Reuse existing Background/Animation allocation primitives.
- Fail atomically; never silently stop on overflow.

### 4. `core: migrate Playfield screens and collision into Background Map domain`

**Priority:** P1, depends on issues 2–3.

- Define deterministic Playfield-to-Background conversion.
- Add optional map-owned collision layer and pure `.col` serializer binding.
- Convert full-screen PNG and procedural generator into Background Map creation operations.
- Preserve legacy filenames/artifact bytes where semantics are unchanged.

### 5. `core: make Tileset and Animation produce logical CHR demands for the project compiler`

**Priority:** P1, depends on issue 3.

- Give Tileset assets explicit role/PT/region constraints or bundle membership.
- Preserve Animation's logical extraction, flip-aware reuse, and OAM attributes while delegating shared slot ownership to the project compiler.
- Distinguish raw tile-pack export from allocated project CHR.

### 6. `integration: project asset decoding and Background source catalog`

**Priority:** P1, depends on issue 2.

- Decode/reconstruct each asset independently.
- Remove the `all asset IDs -> project.tiles` projection.
- Reconcile map source changes and logical keys explicitly.
- Add multi-asset, multi-map, save/reload tests.

### 7. `integration: drive CHR Memory, ownership, and CHR editing from allocation manifest`

**Priority:** P1, depends on issues 3, 5, and 6.

- Remove legacy first-free/contiguous placement reconstruction from mapping and origin resolution.
- Use real stable asset IDs; remove hard-coded Tileset/Playfield IDs.
- Define editing behavior for shared slots: edit origin, detach usage, or materialize explicit override.

### 8. `validation: derive readiness from compiled project facts and enforce export gating`

**Priority:** P1, depends on issue 7.

- Feed Region, ownership, Nametable, palette, OAM, and capacity diagnostics from the compiled manifest.
- Surface Background compilation failures instead of dropping models.
- Ensure error readiness prevents production artifact downloads while leaving inspection/recovery actions available.
- Keep unknown facts unknown; do not infer mapper/runtime behavior.

### 9. `ui: replace legacy import/mode panels with contextual asset and screen workflows`

**Priority:** P2, depends on issues 2, 4, and 6.

- Replace generic import panel with Add PNG Asset, New Screen from PNG, Import Base CHR, Inspect/Extract NROM CHR, and Open Project actions.
- Remove duplicate embedded mode selector.
- Rename Tileset and Background workspaces according to the final product vocabulary.

### 10. `export: build Milestone 12 Delivery manifest and code exporters on compiled project`

**Priority:** P2, depends on issues 3–8.

- Integrate existing Background, Animation, palette, CHR, Nametable, Attribute Table, collision, JSON, cc65, and ca65 serializers.
- Enumerate all project/bundle artifacts rather than one active mode.
- Generate symbols and references from stable IDs and exact allocation records.
- Add byte-level cross-artifact tests proving `.chr`, `.nam`, OAM, C, ASM, diagnostics, and ownership agree.

### 11. `quality: migration, end-to-end browser workflows, docs, and stale-claim cleanup`

**Priority:** P2, last integration gate.

- Cover v1 migration, multiple assets/maps/animations, PT0/PT1, Base CHR, Reservations, collisions, save/reload, and downloads.
- Test actual `main.ts` orchestration or extract it into testable pure application services.
- Update README, architecture, format, CHR editor, smoke-test, and investigation documents only after behavior exists.
- Remove claims that Background save/load or Delivery export works before corresponding integration passes.

## Open questions requiring specialist or product judgment

1. **Residency and mapper profile:** Must every exported Background and Animation coexist in one static NROM 8 KiB CHR, or should the project define multiple export bundles? Without an explicit mapper/banking model, the Studio cannot treat independent per-map layouts as simultaneously valid.
2. **Background/Sprite PT policy:** Should a default NROM profile reserve one PT for Background and one for 8×8 Sprites, permit both to share a PT, or require explicit per-bundle choices? Hardware permits configuration; Studio policy must avoid implying a false hardware rule.
3. **Base CHR blank-slot intent:** Is zero-byte content sufficient to mean allocatable, or should imported Base CHR support an occupancy mask/lock range? Raw bytes alone cannot establish semantic ownership.
4. **Asset allocation intent:** Should Tileset assets declare only a PT, an optional Region, exact pinned slots, or a higher-level role? Pinned ABI addresses are useful for engine integration but increase migration and fragmentation cost.
5. **Shared-slot editing:** When several logical tiles reuse one physical slot, should CHR Editor edit the primary origin, edit all equivalent sources, or offer “detach this usage”? Current behavior does not make the choice explicit.
6. **Collision scope:** Is collision always per visible 32×30 screen, or must the target architecture anticipate larger scrolling maps and reusable gameplay layers? This is engine/product policy, not NES graphics hardware.
7. **Raw CHR/NROM import vocabulary:** Should decoded CHR become a reusable logical tile source, immutable Base CHR, or an inspection-only resource by default? These are distinct ownership and export semantics.
8. **Schema version:** The current v1 schema can receive additive fields, but consolidating asset ownership, Base CHR, maps, and collision may warrant v2 to prevent ambiguous precedence. Compatibility should be decided before Milestone 12 exports become external interfaces.
9. **NES profile review:** Before freezing export profiles, Professor Carvalho should confirm the intended PT0/PT1 policy for Background versus 8×8/8×16 Sprites and the boundary between static NROM CHR, mapper banking, and CHR-RAM behavior. The repository currently models only part of that runtime context, so the audit does not infer it.

## Focused specialist review

Seu Camilo performed a read-only architecture and domain-integrity review after the repository trace. His independent conclusion matches this audit: Milestone 12 should be blocked on the real save/load contract, multi-asset runtime state, a declared residency/export unit, and one project-scoped physical compiler. He also found no architectural basis for keeping Playfield as a second canonical screen model; only its import/generation workflow warrants preservation. No specialist changed repository state.

## Audit confidence and limits

Confidence is high for the verified defects because they follow direct runtime paths and contradict explicit schema/documentation contracts. Existing tests give strong confidence in isolated Background, Animation, palette, CHR Region, ownership, diagnostic, and exporter primitives. Confidence is lower for intended multi-map residency because the repository does not define a mapper/banking/export-bundle policy; this is deliberately left as an open question rather than inferred.

No implementation, automated test run, issue change, branch, or pull request was performed for this audit.
