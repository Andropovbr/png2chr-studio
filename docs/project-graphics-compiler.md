# Project Graphics Compiler

This document defines the canonical runtime compilation boundary introduced by
Issue #167. The persisted input contract remains authoritative in
[`project-graphics-architecture.md`](./project-graphics-architecture.md).

## Boundary

`compileProjectGraphics` is a pure, deterministic project-wide operation. It
receives:

- `ProjectGraphicsConfiguration`;
- decoded logical graphics assets;
- Background Map definitions;
- logical Animation frame demands;
- resolved project-level Base CHR bytes;
- CHR Regions and Reservations.

It returns either `CompiledProjectGraphics` or a typed failure. A successful
result contains one authoritative static 8 KiB CHR-ROM, a 512-entry physical
allocation manifest, logical-tile placements, compiled Background Nametable
indexes, compiled Animation/OAM tile indexes, usage provenance, Region and
Reservation membership, Pattern Table capacity facts, and the required render
context configuration.

The manifest is runtime-only. It is not written into `.p2c` files. Manifest
objects and arrays are frozen; binary access returns a defensive copy of the
compiled CHR image.

## Deterministic allocation

Compilation starts from Base CHR policy and bytes, then applies all Background
demands in render-context/map order followed by all Animation demands in
render-context/animation order. Each focused allocator receives the preceding
512-slot result, so same-table Background and Sprite consumers share one
256-slot capacity budget.

Within a required Pattern Table, allocation uses the lowest eligible physical
slot. Exact byte reuse always has priority. Background reuse is exact only.
Animation may additionally reuse H, V, or HV transformed tiles when its logical
demand enables established flip-aware deduplication. A reused slot records all
logical usages; its first deterministic logical placement supplies project
origin attribution, while Base CHR origin remains the Base CHR asset.

Regions are organizational membership. Reservations exclude empty slots from
automatic allocation but are not ownership. Existing content in a reserved
range remains reusable. Base CHR occupancy, writability, provenance, and bytes
remain separate facts: zero bytes never imply availability. Occupied Base CHR
slots are retained and may be reused exactly; locked or non-available slots are
never selected for new allocation. Writable available Base CHR ranges may be
overwritten, while untouched bytes remain preserved in final CHR.

## Pattern Table invariants

Before producing an 8-bit consumer index, the compiler allocates and verifies
within the render context's required Pattern Table:

```text
Background:
  floor(physicalSlot / 256) == backgroundPatternTable
  nametableByte == physicalSlot % 256

8×8 Sprite:
  floor(physicalSlot / 256) == spritePatternTable
  oamTileByte == physicalSlot % 256
```

Allocation never spills into the other Pattern Table. A full required table is
a compilation failure even when the other table has free slots. Same-table use
is valid and shares capacity. Default BG PT0 / Sprite PT1, inverse selection,
and both same-table configurations are valid.

## Atomic failures

Failure results contain only typed failure facts. They never expose partial
CHR, placements, maps, animations, or a partial manifest. Current failure
families cover invalid graphics/Base CHR input, unresolved Base CHR or render
consumers, unresolved/conflicting logical tiles, selected Pattern Table
capacity overflow, and allocation conflicts.

Unresolved Base CHR bytes fail compilation because an authoritative 8 KiB image
cannot be produced by guessing. Likewise, duplicate consumer identities or one
logical key resolving to different tile bytes fail instead of selecting a
winner by input order.

For a Background Map, every non-empty logical key must also name its declared
source asset. This prevents a source change from silently retaining cells that
would resolve through another asset. Animation demands retain frame extraction
and flip-aware reuse, but their required Sprite Pattern Table comes only from
render context.

## Scope boundary

This compiler supports only NROM, static 8 KiB CHR-ROM, 8×8 Sprites, and fixed
Pattern Table configuration per render context. It does not replace CHR Memory
or Delivery projections, redesign exporters, support 8×16
Sprites, model mapper banks, or model CHR-RAM streaming.
