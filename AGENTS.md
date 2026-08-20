# AGENTS.md

## Project overview

PNG2CHR Studio is a browser-based tool for creating, converting, inspecting, and managing graphics and related data for Nintendo Entertainment System projects.

The project should favor practical NES development workflows over unnecessary abstraction. Features should make it easier to move assets from source artwork into a real NES project while respecting the limitations of the hardware.

The application runs locally in the browser and should remain lightweight, understandable, and easy to maintain.

---

## General principles

When working on this repository:

* Prefer simple and explicit solutions over clever abstractions.
* Preserve existing behavior unless the task intentionally changes it.
* Avoid large unrelated refactors while implementing a focused change.
* Reuse existing project patterns before introducing new architectural concepts.
* Keep NES hardware constraints visible in the domain model instead of hiding them behind UI assumptions.
* Treat exported files and metadata as interfaces consumed by external projects.
* Maintain backward compatibility where practical, especially for persisted project data and exported formats.
* Do not silently change file formats or semantics.
* Avoid adding dependencies when the existing stack or browser APIs can reasonably solve the problem.
* Keep the application usable without a backend or external runtime service.

The goal is not architectural perfection. The goal is reliable software that remains understandable as the project grows.

---

## Understand before changing

Before implementing a task:

1. Inspect the relevant existing code.
2. Identify the current data flow and affected modules.
3. Check existing tests covering the behavior.
4. Check whether documentation describes the affected behavior.
5. Consider whether the change affects persisted projects, CHR layout, exported metadata, palettes, animations, or other NES-specific behavior.

Do not assume the issue description completely represents the implementation.

If the current implementation contradicts documentation, determine which represents the intended behavior before blindly preserving either one.

---

## NES constraints are product requirements

NES hardware limitations are part of the application's domain and should be treated as first-class requirements.

Examples include:

* 8×8 tiles;
* 2 bits per pixel;
* four colors per palette;
* sprite/background palette restrictions;
* 256 tile indexes per pattern table;
* two 4 KiB pattern tables in an 8 KiB CHR-ROM;
* OAM-local tile indexes;
* sprite and background pattern-table selection;
* nametable and Attribute Table limitations;
* sprite-per-scanline limitations where relevant;
* CHR capacity and occupancy;
* mapper-specific limitations when ROM support is involved.

Do not remove or bypass hardware validation simply to make an operation succeed.

When the application can detect an invalid or suspicious NES configuration, prefer giving the user a clear diagnostic explaining the limitation and possible resolution.

---

## Data integrity and exports

Treat project files and exported data carefully.

When modifying persistence or exporters:

* preserve existing project data whenever possible;
* provide migration/default behavior for older project versions when necessary;
* keep format versions explicit;
* do not silently reinterpret existing fields;
* validate indexes, offsets, sizes, and CHR boundaries;
* ensure exported C/ca65 data remains consistent with the canonical project/JSON representation;
* ensure physical CHR positions and NES-visible indexes are not accidentally confused.

Changes affecting exported formats should receive regression tests.

---

## Testing

Every behavioral change should be accompanied by appropriate tests when reasonably possible.

Bug fixes should preferably include a regression test demonstrating the failure that was fixed.

Prioritize tests around:

* CHR encoding and decoding;
* tile allocation and reuse;
* pattern-table boundaries;
* base CHR handling;
* deduplication;
* palette behavior;
* project persistence and loading;
* animation metadata;
* exporters;
* validation rules;
* previously reported regressions.

Before considering a task complete, run the relevant tests.

For changes with broad impact, run the complete test suite and production build.

At minimum, use the repository's existing commands rather than inventing alternative validation procedures.

A change is not complete merely because it works manually in the browser.

---

## Documentation is part of the implementation

Documentation must evolve together with the code.

**A task is not complete if it leaves relevant documentation knowingly outdated.**

After every meaningful change, review the documentation affected by that change.

At minimum, inspect:

* `README.md`;
* relevant files under `docs/`;
* examples, when applicable;
* comments describing formats or non-obvious NES behavior.

Update documentation in the same branch/PR when behavior, workflow, architecture, formats, limitations, commands, or user-visible capabilities change.

Do not wait for a separate "update documentation" task.

### README responsibility

`README.md` should accurately describe the current project.

When implementing or removing a user-visible capability, check whether the README needs to change.

Keep it useful for someone discovering the repository today.

Avoid leaving statements such as future plans, unsupported limitations, old version behavior, or obsolete workflows after the implementation has changed.

If detailed technical information becomes too large for the README, move it into an appropriate file under `docs/` and link to it from the README.

### Technical documentation

Important behavior that would be difficult to reconstruct from the code should be documented.

Good candidates include:

* CHR allocation rules;
* pattern-table behavior;
* project file formats;
* exporter formats;
* persistence/version migrations;
* palette model;
* animation model;
* NES validation rules;
* architectural decisions that affect future development.

Prefer explaining **why a rule exists**, especially when it comes from NES hardware behavior.

---

## Keep documentation trustworthy

Do not document intended behavior as if it already exists.

Documentation should clearly distinguish between:

* implemented behavior;
* known limitations;
* planned work.

When code and documentation disagree, fix the inconsistency as part of the task whenever it is related to the area being changed.

Avoid duplicating detailed documentation across several files. Prefer one authoritative explanation and links from other documents.

---

## Code quality

Follow the existing TypeScript style and project conventions.

Prefer:

* small focused functions;
* explicit domain types;
* pure functions for conversion and validation logic;
* deterministic processing;
* descriptive names;
* separation between UI state and NES conversion logic.

Avoid:

* unexplained magic numbers;
* duplicated NES rules in multiple UI components;
* hidden mutations;
* unnecessary global state;
* mixing file parsing, domain logic, rendering, and exporting when they can reasonably remain separate.

NES constants should have names or comments when their meaning is not immediately obvious.

---

## UI and diagnostics

PNG2CHR Studio is a technical tool, but the user should not need to understand the source code to understand an error.

Validation messages should explain:

1. what is wrong;
2. which NES constraint caused it;
3. what the user can do about it, when practical.

Avoid silently correcting ambiguous input when that could produce unexpected exported data.

Warnings are preferable to hard failures when the result remains technically valid and the user may intentionally be doing something unusual.

Do not redesign unrelated UI while implementing a functional task.

---

## Scope discipline

Implement the requested task completely, but avoid expanding its scope unnecessarily.

Small adjacent fixes are acceptable when they are:

* directly related;
* low risk;
* necessary to keep behavior consistent.

Larger discoveries should be documented or proposed separately rather than quietly folded into the current change.

Do not perform broad cleanup merely because nearby code could be improved.

---

## Completion checklist

Before finishing a task, verify:

* the requested behavior is implemented;
* existing behavior was not unintentionally broken;
* relevant regression tests were added or updated;
* relevant tests pass;
* the production build succeeds when appropriate;
* persisted/exported formats remain valid;
* NES hardware constraints are still respected;
* `README.md` was reviewed for impact;
* relevant `docs/` files were reviewed for impact;
* documentation was updated when necessary;
* obsolete documentation introduced or exposed by the change was removed or corrected.

When reporting completion, summarize:

* what changed;
* important implementation decisions;
* tests performed;
* documentation updated;
* any remaining limitations or follow-up work.

---

## Final rule

Code, tests, and documentation describe the same product.

Whenever one changes, verify whether the others must change with it.
