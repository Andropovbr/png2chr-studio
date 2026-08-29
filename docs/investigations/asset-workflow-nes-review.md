# NES Hardware Review of the Asset Workflow Architecture Audit

**Date:** 2026-08-29  
**Reviewer:** Professor Carvalho  
**Scope:** Focused, read-only review of NES hardware and validation assumptions in [`asset-workflow-architecture-audit.md`](./asset-workflow-architecture-audit.md). This review does not repeat the broader architecture audit.

## Confirmed hardware facts

- The PPU pattern address space is 8 KiB, `$0000..$1FFF`, divided into PT0 (`$0000..$0FFF`) and PT1 (`$1000..$1FFF`). Each Pattern Table contains 256 8×8 tiles. Each tile occupies 16 bytes of 2bpp planar data. CHR-ROM is one possible backing store for this address space; CHR-RAM and mapper-controlled CHR banking also exist.

- With **8×8 Sprites**, `PPUCTRL` (`$2000`) bit 4 selects the Background Pattern Table and bit 3 selects the Pattern Table used by Sprites. The selections are independent. All four combinations are valid:

  - Background PT0, Sprites PT0;
  - Background PT0, Sprites PT1;
  - Background PT1, Sprites PT0;
  - Background PT1, Sprites PT1.

  NES hardware does not require Background and Sprites to use different Pattern Tables. Current Studio metasprites explicitly use 8×8 Sprites ([`src/core/nes-sprite-diagnostics.ts:9`](../../src/core/nes-sprite-diagnostics.ts#L9)), and current animation exports describe a global Sprite Pattern Table selected through `PPUCTRL` bit 3 ([`docs/formatos-e-exportacao.md:381`](../formatos-e-exportacao.md#L381)).

- With **8×16 Sprites**, `PPUCTRL` bit 3 does not select the Sprite Pattern Table. Each OAM tile byte supplies both the Pattern Table and the tile pair:

  ```text
  patternTable       = oamTileByte & 1
  topLocalTileIndex  = oamTileByte & 0xFE
  topPhysicalSlot    = patternTable * 256 + topLocalTileIndex
  bottomPhysicalSlot = topPhysicalSlot + 1
  ```

  Each 8×16 Sprite therefore requires two consecutive 8×8 tiles, beginning at an even local index, within the Pattern Table selected by OAM tile-byte bit 0. A single global `spritePatternTable` field and `physicalSlot % 256` conversion do not describe 8×16 addressing. Vertical flip applies to the complete 8×16 Sprite, including the perceived order of its two halves.

- A Background Nametable entry is an 8-bit tile index within the Pattern Table selected by `PPUCTRL` bit 4:

  ```text
  physicalSlot = backgroundPatternTable * 256 + nametableByte
  ```

  A compiler may derive `nametableByte = physicalSlot % 256` only after proving that the physical slot belongs to the configured Background Pattern Table.

- In 8×8 Sprite mode, an OAM tile byte is an 8-bit local index within the Pattern Table selected by `PPUCTRL` bit 3. Moving a Sprite tile to the other Pattern Table without also changing the render configuration does not preserve its meaning.

- Allocation must not silently spill between Pattern Tables when the consumer has one configured Pattern Table. A full selected table is an allocation error even if the other table has free slots. Current Background allocation already fails when its selected table is full ([`src/core/chr-background-allocation.ts:374`](../../src/core/chr-background-allocation.ts#L374)); a general compositor that crosses the boundary or stops without an error does not satisfy this hardware contract.

- One standard visible Background screen uses 32×30 tile indexes, totaling 960 Nametable bytes. Its Attribute Table occupies 64 bytes. Each Attribute byte covers 32×32 pixels and contains four 2-bit selectors, one per 16×16-pixel quadrant. The Studio's logical 16×15 palette-assignment grid and deterministic padding of the non-visible lower quadrants are hardware-correct ([`src/core/background-model.ts:288`](../../src/core/background-model.ts#L288)).

- Background tile entries have no per-tile horizontal or vertical flip bits. A flipped Background image must exist as distinct CHR tile data. Sprite flip bits are OAM attributes and do not change this Background rule.

- A CHR tile containing sixteen `$00` bytes is valid tile data. Hardware sees 64 pixels whose 2-bit color index is zero. Hardware has no concepts of free slots, Regions, Reservations, provenance, ownership, or allocation.

- Collision data is not a PPU, OAM, or standard NES graphics structure. The Studio's 32×30 cells, 4 bits per cell, and 480-byte encoding are entirely Studio/game-engine policy ([`src/core/collision-encoder.ts:1`](../../src/core/collision-encoder.ts#L1)).

## Studio policies that are reasonable defaults

- For an initial profile limited to 8×8 Sprites, **Background PT0 and Sprites PT1** is a reasonable default. It makes CHR inspection simpler, reduces accidental allocation collisions, and gives each role an independent 256-tile budget. This is a Studio convention, not an NES rule.

- Background and Sprite Pattern Tables should remain independently configurable. The Studio should permit the inverse split and deliberate same-table use.

- Sharing one Pattern Table between Background and 8×8 Sprites is valid. Identical tile bytes may share a slot when both render contexts select that table. All co-resident Background and Sprite demands then share one 256-slot capacity budget.

- One fixed `PPUCTRL` Pattern Table configuration per declared render context is a sound simplification for the initial profile. Mid-frame changes are hardware-possible but need not be supported.

- One static 8 KiB CHR image is a sound compilation target when the profile is explicitly **NROM with 8 KiB CHR-ROM**. Every pattern used from CHR-ROM by that build must reside in that one fixed image.

- Imported Base CHR should be treated conservatively as occupied unless explicit allocation metadata says otherwise. Reasonable mechanisms include an occupancy mask, locked ranges, or user-declared allocatable ranges. Exact reuse of an existing zero tile may be allowed without calling its slot free or overwriting it.

- CHR Regions and Reservations are reasonable Studio allocation policies. They organize and constrain compilation but are not NES hardware features.

## Assumptions that must not be presented as hardware rules

- “PT0 is for Background and PT1 is for Sprites” is not a hardware rule.

- “Background and Sprites must use different Pattern Tables” is false in 8×8 mode.

- A Pattern Table choice is not intrinsically owned by an animation. In 8×8 mode, `PPUCTRL` bit 3 is global PPU state for all Sprites rendered in that context. Simultaneously visible animations cannot require different Sprite Pattern Tables unless timed register changes are modeled.

- A single `spritePatternTable` field is not valid for 8×16 Sprite addressing.

- “Zero-filled means free” is not a hardware fact. It is the current Studio fallback when raw CHR lacks ownership metadata ([`src/core/chr-pattern-table.ts:1122`](../../src/core/chr-pattern-table.ts#L1122)). Semantic availability remains unknown.

- “NROM can switch residency groups at runtime” is false for static CHR-ROM. Different 8 KiB layouts are separate build/ROM variants, not runtime-resident banks.

- “A screen always uses one Background Pattern Table” is a reasonable simple-profile policy, not an absolute hardware limit. Software may change `PPUCTRL` during rendering. Without timing and scanline information, validity of such use is not determinable from the current Studio model.

- 32×30 describes a standard visible Nametable area, not a universal game-map format. Larger worlds, scrolling maps, compression, and metatiles are engine abstractions.

- Collision consistency failures are not NES graphics hardware violations.

## Required corrections to the target architecture, if any

1. Declare the initial profile explicitly as `spriteMode: 8x8`. Current persisted Animation settings contain a Pattern Table but no Sprite mode ([`src/core/project.ts:131`](../../src/core/project.ts#L131)). Until a separate 8×16 model exists, 8×16 must be reported as unsupported rather than interpreted through 8×8 rules.

2. Make render configuration an explicit compiler input:

   - Background Pattern Table;
   - Sprite mode;
   - Sprite Pattern Table for 8×8 mode;
   - maps and animations that may be simultaneously active.

   Pattern Table selection must not be inferred from asset origin or incidental physical allocation.

3. Treat 8×8 Sprite Pattern Table selection as render-context state, not animation-owned state. Animations compiled for simultaneous use must agree on the selected Sprite Pattern Table in the initial profile.

4. Record address interpretation in the compilation manifest, not only physical slot and local index:

   - Background: configured Pattern Table, Nametable byte, and physical slot;
   - 8×8 Sprite: configured Pattern Table, OAM tile byte, and physical slot;
   - future 8×16 Sprite: OAM tile byte, Pattern Table encoded in bit 0, and both physical slots in the aligned pair.

5. Validate Pattern Table membership before reducing a physical index to eight bits. Applying modulo 256 first can hide allocation into the wrong table.

6. Correct the residency-group proposal for the static NROM profile. One NROM CHR-ROM build has one fixed 8 KiB layout. Independent bundles with different layouts are separate build variants unless mapper banking or CHR-RAM transfer behavior is explicitly modeled.

7. Separate Base CHR tile bytes from occupation intent, overwrite permission, provenance, and ownership. For legacy projects without metadata, whether a zero-filled slot is allocatable is **unknown**, not a hardware-derived fact.

8. Fail compilation atomically when any demand cannot fit its required Pattern Table. No exporter may accept silent truncation or cross-table spill.

9. Keep the logical-screen to compiled Nametable/Attribute Table/CHR boundary. It is hardware-correct. The compiled result must also carry the `PPUCTRL` configuration required to interpret those bytes.

10. Keep collision attached to its owning map for lifecycle, dimensions, and coordinate consistency, but outside PPU validity. A collision error may block the collision artifact; it must not by itself make `.nam`, `.atr`, or `.chr` invalid NES graphics.

## Recommendations for the initial NROM/static-CHR profile

Name the profile precisely: **NROM, static 8 KiB CHR-ROM, 8×8 Sprites, fixed Pattern Table configuration per render context**.

Recommended defaults and validation:

- Background uses PT0 by default.
- 8×8 Sprites use PT1 by default.
- Both selections remain configurable.
- No allocation spills between Pattern Tables.
- Exceeding the selected table's available capacity is an error.
- Same-table Background/Sprite use compiles against one shared 256-slot budget.
- Simultaneously active animations must use the render context's single Sprite Pattern Table.
- One build emits one authoritative 8 KiB CHR image.
- Base CHR is occupied by default unless explicit metadata grants allocation permission.
- Existing zero tiles may be reused exactly without treating them as writable free space.

Required compiled invariants for Background:

```text
floor(physicalSlot / 256) == configuredBackgroundPatternTable
nametableByte == physicalSlot % 256
```

Required compiled invariants for 8×8 Sprites:

```text
floor(physicalSlot / 256) == configuredSpritePatternTable
oamTileByte == physicalSlot % 256
```

Exports should include the required `PPUCTRL` Pattern Table constants beside the data, consistent with existing Animation and Background exporters ([`docs/formatos-e-exportacao.md:381`](../formatos-e-exportacao.md#L381), [`docs/formatos-e-exportacao.md:415`](../formatos-e-exportacao.md#L415)).

## Future mapper/CHR-RAM boundaries that should remain explicitly unsupported or unknown

Until corresponding runtime models exist, the Studio must not infer:

- mapper CHR bank sizes, banking registers, or active bank state;
- runtime switching among alternative CHR-ROM layouts;
- CHR-RAM upload sources, schedules, slot lifetime, mutation, or streaming;
- VBlank transfer budgets;
- per-scanline or mid-frame Pattern Table changes;
- 8×16 Sprite allocation and OAM encoding;
- simultaneous Nametable residency, mirroring, and scrolling requirements beyond the compiled single-screen artifact;
- mapper extensions that alter tile or attribute selection.

These facts should remain **unknown/not determinable** when project data does not model them. They must not produce guessed hardware violations.

Mapper 0 can be paired with CHR-RAM, but that is not semantically equivalent to this static CHR-ROM profile. The current NROM importer explicitly rejects CHR-RAM ROMs ([`src/core/ines-rom.ts:57`](../../src/core/ines-rom.ts#L57)). Supporting such projects requires an explicit model for initial data, CPU-to-PPU transfers, timing, residency, and mutability.

## Final verdict on whether the proposed architecture is safe to use as the basis for the pre-Milestone-12 remediation work

**Valid with required corrections.**

The proposed logical-assets to project-wide physical compiler to Nametable/OAM/CHR boundary is faithful to NES hardware and is a safe basis for pre-Milestone-12 remediation after four conditions are made explicit:

1. initial profile is limited to 8×8 Sprites;
2. Pattern Table selection is render configuration with strict index validation;
3. each static NROM CHR-ROM build has one authoritative 8 KiB layout;
4. Base CHR occupation intent is modeled separately from tile bytes.

Without these corrections, the Studio could present conventions as NES requirements or export well-formed indexes that address the wrong CHR tiles.
