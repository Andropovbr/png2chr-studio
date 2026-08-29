# Project and workspace state boundaries

PNG2CHR Studio keeps one canonical in-memory project in `src/main.ts`. This is
the authority used to build the versioned `StudioProject` saved by
`src/core/project.ts`. The UI must not introduce a second project store or copy
NES-domain behavior into component state.

## State ownership

| Boundary                | Owns                                                                                                                                                                                                                                                                                                                                                                                | Dirty effect                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `updateProject(...)`    | Project settings, stable asset identities (`ProjectAssetReference.id`), selected mode and source, palettes and assignments, pixel overrides, collisions, animation definitions, scene instances, CHR destination, CHR regions and reservations (`chrRegions`), and other data represented by the saved project                                                                      | A changed project identity marks the project dirty  |
| `updateWorkspace(...)`  | Active workspace navigation, active preview tool, palette-number overlay, zoomed palette region, palette color target, collapsed panels, active animation and Scene-instance selection (`selectedAnimationId`, `selectedSceneInstanceId`), active contextual tab (`activeTab`), and CHR memory workspace options (`zoom`, `previewPalette`, `heatmapEnabled`, `highlightedAssetId`) | Never marks the project dirty and is not serialized |
| `setDerivedStatus(...)` | Loading state and processing/validation errors                                                                                                                                                                                                                                                                                                                                      | Never marks the project dirty and is not serialized |

## Pure derived domain models (never persisted)

The following Milestone 6 structures are computed dynamically in memory from the project state and are never serialized into `.p2c`:

- `ChrAssetMappingIndex` (slot-by-slot bidirectional mapping, origin attributions, usage graphs, reverse lookups);
- `PhysicalSlotAttribution` (per-slot origin and usage slices);
- `AssetChrMetrics` and `ProjectChrOwnershipMetrics` (per-asset and global resource accounting);
- `ChrOwnershipDiagnosticFact` (ownership integrity, orphan detection, dangling reference facts).

`ProjectView` also carries reconstructed source images and conversion caches
needed by the current browser workflow. It retains the persisted Tileset and
Playfield configurations while another mode is active, plus original asset
references when browser decoding is unavailable. These retained values remain
part of the same canonical view; they are not a second project store. New
projects and successfully loaded projects replace that canonical view directly
and explicitly reset the dirty flag.

`buildCurrentStudioProject()` remains the only projection from the working view
into the persisted `StudioProject` schema. It projects the active legacy source
from its runtime image state and carries every other durable domain through:
Background Maps, CHR Regions/Reservations, Animation, Scene, palette-manager
state, and inactive Tileset/Playfield configuration. Project opening restores
those domains regardless of the selected legacy mode. A graphics-source import
clears only the active source's working image, assignments, overrides, and
Playfield collisions; it preserves unrelated project-owned state.

The project name is persisted separately from `ProjectView`, so its header
callback uses the same dirty rule through `updateProjectName(...)`.

## Rendering transient animation state

The animation editor splits animation workflows into a compact animation/entity list, a single selected animation editor, and a sticky live preview/summary column.

Active animation selection (`selectedAnimationId`), selected Scene instance (`selectedSceneInstanceId`), and active subtool tab (`activeTab: 'frames' | 'pixels' | 'mapping' | 'scene'`) are managed strictly within `WorkspaceState.animation`. `renderAnimationWorkspace()` projects these selection states onto the editor options at render time. Switching active animations, Scene instances, or contextual tabs does not mark the project dirty and is never serialized into the project schema or export files.

The Scene panel is mounted only while the dedicated `Animation > Scene` tab is active. Its play/pause flag and per-instance frame clocks live in one transient playback session owned by the UI orchestrator. The session survives ordinary UI rerenders and tab switches, resets when the project transient state resets, and is never projected into `StudioProject` or `.p2c`. Keyboard and pointer movement write canonical anchor coordinates; layer changes reorder the persisted `scenePreview.instances` array already consumed by rendering. Selection and short-lived focus restoration remain transient UI concerns. Before replacing the application shell, the orchestrator explicitly disposes the mounted Scene panel so its `requestAnimationFrame` loop and Pointer Event listeners cannot accumulate.

Scene resource context is derived on demand from current animation settings, palette definitions, `AnimationProjectModel`, and `ChrAssetMappingIndex`. It is not stored in Scene state. `navigateToRelatedResource(...)` updates only existing Animation, Palette, and CHR selections in `WorkspaceState`; it never writes navigation-only references into `StudioProject` or `.p2c`. Returning to Scene therefore reprojects current canonical resource data, including unsaved project edits and explicit dangling references.

Persistable editor callbacks update only the existing project model. CHR
allocation, deduplication, mirroring, palette meaning, animation mapping, and
export generation remain in the existing core modules.

## Rules for future changes

- Route every user-visible change that must survive save/load through
  `updateProject(...)` (or the focused project-name boundary).
- Keep selection/visibility/layout state in `WorkspaceState` unless it is an
  intentional part of the project file format.
- Keep asynchronous progress and recoverable processing errors in
  `DerivedStatus`.
- Do not add fields to `StudioProject` merely to preserve editor layout.
- Do not mutate typed arrays in place; create the next project value so dirty
  tracking can observe the change.
- Preserve `src/core` as the home of NES rules. `ProjectMode` lives in
  `src/core/project-mode.ts` so project persistence does not depend on UI
  modules.
- A project schema change requires an explicit format decision, migration or
  compatibility behavior, persistence tests, and documentation updates.

## Regression coverage

`src/ui/state-update.test.ts` verifies that changed project updates mark dirty,
identity updates remain clean, workspace and derived-status changes remain
clean, and workspace changes do not alter serialized project data.

`src/ui/project-runtime.test.ts` exercises the application runtime projection
through save, deserialize, restore, and repeat-save boundaries for Tileset,
Playfield, and Animation modes. It also verifies focused source replacement,
stable asset/map IDs, Background/Animation coexistence, CHR Regions and
Reservations, Scene state, and palette-manager state.

The existing project, animation, palette, CHR, and exporter tests continue to
protect the persisted schema and NES-domain semantics. Use the full validation
commands documented in the README and stabilization smoke test after changing
these boundaries.
