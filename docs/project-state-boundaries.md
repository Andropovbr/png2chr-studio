# Project and workspace state boundaries

PNG2CHR Studio keeps one canonical in-memory project in `src/main.ts`. This is
the authority used to build the versioned `StudioProject` saved by
`src/core/project.ts`. The UI must not introduce a second project store or copy
NES-domain behavior into component state.

## State ownership

| Boundary                | Owns                                                                                                                                                                                                        | Dirty effect                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `updateProject(...)`    | Project settings, selected mode and source, palettes and assignments, pixel overrides, collisions, animation definitions, scene instances, CHR destination, and other data represented by the saved project | A changed project identity marks the project dirty  |
| `updateWorkspace(...)`  | Active preview tool, palette-number overlay, zoomed palette region, palette color target, collapsed panels, and collapsed animation cards                                                                   | Never marks the project dirty and is not serialized |
| `setDerivedStatus(...)` | Loading state and processing/validation errors                                                                                                                                                              | Never marks the project dirty and is not serialized |

`ProjectView` also carries reconstructed source images and conversion caches
needed by the current browser workflow. New projects and successfully loaded
projects replace that canonical view directly and explicitly reset the dirty
flag. `buildCurrentStudioProject()` remains the only projection from the
working view into the persisted `StudioProject` schema.

The project name is persisted separately from `ProjectView`, so its header
callback uses the same dirty rule through `updateProjectName(...)`.

## Rendering transient animation state

The animation editor still accepts optional collapsed flags in its render
options. `renderAnimationWorkspace()` projects those flags from
`WorkspaceState` onto the editor options. They are not written back to the
canonical animation settings and do not appear in project files or exports.

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

The existing project, animation, palette, CHR, and exporter tests continue to
protect the persisted schema and NES-domain semantics. Use the full validation
commands documented in the README and stabilization smoke test after changing
these boundaries.
