# Project Graphics Architecture

This document is the authoritative logical graphics contract for PNG2CHR
Studio project files. Its runtime compilation boundary is defined in
[`project-graphics-compiler.md`](./project-graphics-compiler.md).

## Supported profile

The only executable profile is:

> NROM, static 8 KiB CHR-ROM, 8×8 Sprites, fixed Pattern Table configuration
> per render context.

NES hardware provides two independent 4 KiB Pattern Tables with 256 8×8 tiles
each. In 8×8 Sprite mode, `PPUCTRL` selects one Background Pattern Table and
one Sprite Pattern Table. All four PT combinations are hardware-valid,
including deliberate same-table use.

Studio policy defaults new projects to Background PT0 and Sprites PT1. This is
not a hardware restriction. Background PT1 / Sprite PT0 and same-table use are
valid project configurations.

Current limitations are one static 8 KiB CHR-ROM image and one fixed PT pair per
declared render context. The following remain unsupported or unknown: 8×16
Sprites, mapper CHR banking, CHR-RAM transfer/streaming, runtime CHR layout
switching, mid-frame or scanline-dependent Pattern Table changes, and inferred
runtime residency. The Studio must not report guessed hardware violations for
those unmodeled behaviors.

## Canonical persisted model

`.p2c` `formatVersion: 2` requires `StudioProject.graphics` with four parts:

```text
graphics
  profile
  assets[]
  baseChr
  renderContexts[]
```

Version 1 is accepted only as migration input. Deserialization always returns a
version 2 project; serialization always writes version 2.

Tileset and Animation editor fields remain temporary compatibility projections.
Playfield is also a runtime-only compatibility workflow: its full-screen PNG,
procedural, palette, pixel-override, and collision editors create or update a
Background Map. Persisted screen semantics live only in `backgrounds.maps`.
At the save boundary one canonical adapter captures legacy-editor changes into
`graphics` and the map. A version 2 file cannot use aliases to override
conflicting catalog, Base CHR, render-context, or Background Map state.

## Graphics assets and logical tiles

`graphics.assets[]` is the project asset catalog. Each entry owns exactly one
stable `id`; its `source` intentionally has no second ID. Entries also own:

- asset kind and display name;
- path, source kind, and optional embedded source data;
- deterministic decode mode (`png-indexed` or NES 2bpp);
- quantization input when applicable;
- Background/Sprite palette-bank input;
- palette assignments and pixel overrides when applicable.

One asset ID identifies one decoded logical tile grid and one set of processing
inputs. If the same file needs different processing, those are distinct logical
assets with distinct IDs.

`LogicalTileKey` remains `${assetId}:${tileX}:${tileY}`. It identifies a tile in
that logical grid. It is never a physical slot, Pattern Table index, Nametable
byte, or OAM byte. Matching numbers do not establish identity.

`DecodedGraphicsAsset` is the non-persisted runtime form. It indexes decoded
tiles by `LogicalTileKey` and contains no physical allocation. Source images,
decoded pixels, and previews remain disposable runtime data.

Every catalog asset is decoded independently using its own stable asset ID and
persisted logical-tile inputs. Runtime code must never project one active
`project.tiles` array onto every asset ID. A missing source or incompatible
decode mode is unresolved and surfaces explicitly. Background Map cells must
use keys belonging to the map's declared `assetId`; no fallback chooses another
asset.

Tileset, Background Maps, and Animation provide logical tile demands only.
Project compiler determines production CHR placement. A raw CHR tile-pack is a
developer utility containing one decoded asset's tiles in source order; it is
not compiled project CHR and has no physical-slot semantics.

## Base CHR

`graphics.baseChr` is project-level state. Animation does not own it. It keeps:

- one stable Base CHR asset ID and source reference;
- byte length, or `null` while an external companion is unresolved;
- placement PT for files containing at most 256 tiles;
- an ordered, non-overlapping policy partition covering physical slots
  `0..511`.

Every policy range stores separate facts:

- `occupancy`: `available`, `occupied`, or `unknown`;
- `writability`: `writable` or `locked`;
- `ownerAssetId`;
- provenance: none, imported Base CHR, or pending source.

Tile bytes and these semantic facts are independent. Sixteen zero bytes are a
valid NES tile and never prove availability. Explicit version 2 Base CHR policy
may mark zero-filled tiles as occupied and locked. Version 1 did not persist
that policy: its embedded `destinationChr` can be a generated, padded 8 KiB
envelope rather than an imported Base CHR file. Migration therefore preserves
the source reference but marks all Base CHR occupancy `unknown` and locked
until an explicit policy is available. At runtime, the Studio may clear that
provisional Base CHR only when every non-padding tile in its complete 8 KiB
envelope is recoverable from the catalog-backed Animation demands. This ignores
historical physical placement while proving semantic generated output; it is
not a byte-length or non-zero-slot occupancy guess. Otherwise opening the
project remains possible, but future allocation must not treat unknown slots as
free.

Runtime compatibility aliases may carry an embedded compiled CHR preview. That
payload does not replace an unchanged version 2 Base CHR source or its explicit
policy; source identity and policy remain canonical.

CHR Regions and Reservations remain separate Studio allocation policy.
Reservation is not ownership and does not rewrite Base CHR metadata.

## Render contexts

Each stable `ProjectRenderContext` contains:

- Background Pattern Table;
- explicit `spriteMode: "8x8"`;
- Sprite Pattern Table;
- Background map IDs intended for that context;
- Animation IDs intended to coexist in that context.

Consumer arrays use map and animation IDs, never asset IDs. Pattern Table
selection is render-context state, not inferred from asset origin or physical
placement. Multiple contexts may use different PT pairs, but the supported
NROM profile still targets one static 8 KiB image for the project; contexts do
not imply mapper banks or runtime layout variants.

Physical indexes are future compiler output. Before reducing a physical slot to
an 8-bit byte, that compiler must prove membership in the configured Pattern
Table:

```text
Background: floor(slot / 256) == backgroundPatternTable
            nametableByte == slot % 256

8×8 Sprite: floor(slot / 256) == spritePatternTable
             oamTileByte == slot % 256
```

## Deterministic version 1 migration

Migration performs these operations without compiling CHR:

- Tileset and Playfield source references become catalog entries with their
  quantization, palette assignments, and indexed pixel overrides.
- Each Background source becomes a catalog entry. Existing map IDs, cells,
  palette assignments, and logical keys remain unchanged.
- Each Animation source becomes a catalog entry with its quantization and
  sparse tile overrides. Animation IDs, frame data, palette references, and
  Scene references remain unchanged.
- Legacy Animation-owned `destinationChr` becomes project-level Base CHR. Its
  short-file placement preserves `destinationPatternTable`; because version 1
  did not record semantic slot occupancy, migration blocks the Base CHR as
  unknown instead of deriving occupancy from embedded byte length. A complete
  padded envelope is later removed only after deterministic canonical
  compilation proves every non-padding tile recoverable from Animation
  content, independent of historical physical slots; ambiguous and imported
  Base CHR remain blocked rather than guessed.
- CHR Regions and Reservations are preserved unchanged.
- A legacy Playfield screen becomes one deterministic Background Map with 960
  logical cells, its 240 palette assignments, source asset identity, and pixel
  overrides in the catalog. Collision becomes optional map-owned gameplay data
  and procedural settings become optional map-owned generation inputs. The
  persisted `migratedFromPlayfield: true` provenance is explicit; map IDs never
  determine compatibility identity.
- Missing legacy asset IDs receive existing deterministic fallback IDs.
- Conflicting `map.assetId`, `asset.id`, duplicate consumer IDs, or incompatible
  definitions under one asset ID produce a structured schema error. Migration
  never chooses an identity by array order.

Version 1 did not record map/animation coexistence. Migration therefore applies
a declared conservative Studio policy, not a recovered fact: one context per
Background map, preserving that map's Background PT, using the legacy global
Sprite PT, and including all animations. Without Background maps, migration
creates one default/sprite-only context. A migrated Playfield adds one map
context using its selected Background Pattern Table.

## Compiler boundary

`compileProjectGraphics` consumes this model, resolved Base CHR bytes, decoded
assets, Background Maps, logical Animation frame demands, and CHR Regions /
Reservations. One invocation produces one atomic project-wide result containing
the final static 8 KiB CHR-ROM, physical allocation manifest, logical placement
metadata, compiled Nametable and OAM-local indexes, usage provenance, capacity
facts, and required render-context Pattern Table configuration.

Physical allocation remains runtime-derived and is never persisted in version 2. CHR Memory, diagnostics, ownership, editing, and Delivery migration remain
later work; their existing projections are not additional authoritative
compiler results. Playfield conversion, 8×16 Sprites, mapper banking, CHR-RAM
streaming, and exporter redesign remain outside this boundary.
