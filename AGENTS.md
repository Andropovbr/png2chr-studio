# AGENTS.md

## Project overview

PNG2CHR Studio is a browser-based tool for creating, converting, inspecting, validating, and managing graphics and related data for Nintendo Entertainment System projects.

The project should favor practical NES development workflows over unnecessary abstraction. Features should make it easier to move assets from source artwork into a real NES project while respecting the limitations of the hardware.

The application runs locally in the browser and should remain lightweight, understandable, deterministic, and easy to maintain.

---

## General principles

When working on this repository:

- Prefer simple and explicit solutions over clever abstractions.
- Preserve existing behavior unless the task intentionally changes it.
- Avoid large unrelated refactors while implementing a focused change.
- Reuse existing project patterns before introducing new architectural concepts.
- Keep NES hardware constraints visible in the domain model instead of hiding them behind UI assumptions.
- Treat persisted project files, exported files, and exported metadata as interfaces consumed by external projects.
- Maintain backward compatibility where practical, especially for persisted project data and exported formats.
- Do not silently change file formats, indexes, ownership semantics, or hardware interpretation.
- Avoid adding dependencies when the existing stack or browser APIs can reasonably solve the problem.
- Keep the application usable without a backend or external runtime service.
- Read seu-camilo.md
- Read professor-carvalho.md

The goal is not architectural perfection. The goal is reliable software that remains understandable as the project grows.

---

## Understand before changing

Before implementing a task:

1. Inspect the relevant existing code.
2. Identify the current data flow and affected modules.
3. Identify the canonical representation of the data being changed.
4. Check existing tests covering the behavior.
5. Check whether documentation describes the affected behavior.
6. Consider whether the change affects persisted projects, migrations, CHR layout, ownership, reservations, exported metadata, palettes, animations, diagnostics, or other NES-specific behavior.
7. Inspect adjacent consumers before changing a shared type or invariant.

Do not assume the issue description completely represents the implementation.

Do not fix a symptom in a projection, UI component, diagnostic, or exporter before understanding where the underlying state originates.

If the current implementation contradicts documentation, determine which represents the intended behavior before blindly preserving either one.

---

## Canonical state and projections

PNG2CHR Studio has multiple representations of project information. They must not become competing sources of truth.

As a general rule:

- persisted project data defines the durable project representation;
- domain/core models define canonical runtime semantics;
- workspace and UI models are projections or editing state;
- diagnostics derive facts from canonical state;
- exporters derive output from canonical state;
- caches and previews are disposable projections.

Do not introduce a second interpretation of the same domain concept merely because it is convenient for a UI component.

When similar information exists in persisted and in-memory representations, explicitly understand how identity and semantics map between them.

A fix that makes one view correct while leaving another consumer with different semantics is incomplete.

Shared domain rules should live in shared domain/core logic whenever reasonably possible rather than being independently reconstructed by UI components, diagnostics, and exporters.

---

## Domain identity is explicit

Do not accidentally conflate:

- asset identity;
- animation/frame identity;
- logical tile identity;
- physical CHR slot;
- pattern-table-relative tile index;
- NES-visible tile index;
- palette definition identity;
- hardware palette slot;
- reservation/region identity.

Numeric equality between two values does not imply that they represent the same domain concept.

Conversions between logical identity and physical NES layout should be explicit, testable, and documented when non-trivial.

Avoid fallback behavior that infers ownership or identity solely because unrelated numeric indexes happen to match.

---

## NES constraints are product requirements

NES hardware limitations are part of the application's domain and should be treated as first-class requirements.

Relevant constraints include, when applicable:

- 8×8 tiles;
- 2 bits per pixel;
- four entries per hardware subpalette;
- background and sprite palette banks;
- universal background color behavior;
- 256 tile indexes per pattern table;
- two 4 KiB pattern tables in an 8 KiB CHR address space;
- sprite/background pattern-table selection;
- 8×8 and 8×16 sprite addressing differences;
- nametable and Attribute Table limitations;
- sprite-per-scanline limitations where spatial information is sufficient to evaluate them;
- CHR capacity, occupancy, ownership, regions, and reservations;
- mapper-specific limitations when mapper behavior is explicitly modeled.

Do not remove or bypass hardware validation simply to make an operation succeed.

Do not report a hardware violation unless the application has enough information to establish it.

When a hardware property cannot be determined from the current model, represent it as unknown/not determinable rather than guessing.

When the application can detect an invalid or suspicious NES configuration, prefer giving the user a clear diagnostic explaining the limitation and possible resolution.

---

## Separate hardware facts from project policy

A hardware fact describes what the NES can represent.

Project policy describes how PNG2CHR Studio chooses to organize or constrain valid NES data.

Keep these concepts distinct.

For example, a project may reserve a region of CHR for a particular purpose. That reservation is project policy built on top of physical CHR limits; it is not itself an NES hardware restriction.

Diagnostics should identify the actual source of a constraint whenever practical:

- NES hardware;
- project configuration;
- allocation/ownership rule;
- persistence/schema integrity;
- exporter limitation.

This distinction prevents project conventions from being incorrectly presented as hardware laws.

---

## CHR ownership, allocation, regions, and reservations

Physical CHR state must remain internally consistent.

When working in this area:

- distinguish occupied, available, reserved, and conflicting slots;
- do not treat reservation as ownership;
- do not treat logical asset existence as proof of physical allocation;
- do not infer allocation solely from matching indexes;
- ensure allocation respects Pattern Table boundaries and reservations;
- ensure capacity calculations do not double-count unavailable slots;
- ensure diagnostics and CHR Memory views derive from the same underlying facts;
- preserve the distinction between Base CHR and project-generated content where relevant.

Changes to allocation or ownership semantics require regression tests.

---

## Palette semantics

Palette definitions and NES hardware palette slots are distinct concepts.

Do not conflate:

- reusable/declarative palette definitions;
- assignment of those definitions to hardware slots;
- background and sprite palette banks;
- the universal background color;
- palette references stored by assets or animations.

Changes to palette semantics must be traced through persistence, migration, previews/rendering, diagnostics, and exporters.

Do not independently reconstruct palette state in UI components when a canonical representation exists.

---

## Data integrity and exports

Treat project files and exported data carefully.

When modifying persistence or exporters:

- preserve existing project data whenever possible;
- provide migration/default behavior for older project versions when necessary;
- keep format versions explicit;
- do not silently reinterpret existing fields;
- validate indexes, offsets, sizes, and CHR boundaries;
- ensure exported C/ca65 data remains consistent with the canonical project representation;
- ensure physical CHR positions and NES-visible indexes are not accidentally confused;
- ensure diagnostics do not claim an export is valid when required information is missing or contradictory.

Changes affecting persisted or exported formats require regression tests.

If a format intentionally changes, update its documentation in the same work.

---

## Diagnostics are derived facts

Diagnostics must be based on explicit facts derived from canonical project state.

Prefer separating:

1. fact extraction;
2. rule evaluation;
3. severity classification;
4. user-facing presentation.

Avoid embedding independent domain interpretation inside diagnostic UI components.

A diagnostic should distinguish, where applicable:

- invalid;
- conflicting;
- suspicious;
- capacity-limited;
- unknown/not determinable.

Warnings should not be promoted to errors merely because a configuration is unusual.

Errors should correspond to conditions that are actually invalid under the applicable hardware or project contract.

---

## Testing

Every behavioral change should be accompanied by appropriate tests when reasonably possible.

Bug fixes should preferably include a regression test demonstrating the failure that was fixed.

Prioritize tests around:

- CHR encoding and decoding;
- tile allocation and reuse;
- ownership and asset mapping;
- regions and reservations;
- Pattern Table boundaries;
- Base CHR handling;
- deduplication;
- palette behavior and hardware-slot assignment;
- project persistence and migrations;
- animation metadata;
- exporters;
- NES validation rules;
- diagnostics;
- previously reported regressions.

When fixing a disagreement between two representations of the same project, test the boundary between those representations rather than only the final UI symptom.

Before considering a task complete, run the relevant tests.

For changes with broad impact, run the complete test suite, lint, and production build using the repository's existing commands.

Do not weaken tests, lint rules, validation rules, or TypeScript constraints merely to make CI pass unless the task explicitly establishes that the rule itself is wrong.

A change is not complete merely because it works manually in the browser.

---

## Documentation is part of the implementation

Documentation must evolve together with the code.

> **Fundamental rule:** Changes that alter behavior, architecture, formats, workflows, development commands, domain invariants, or documented functionality must update the corresponding documentation in the same work/PR.

Code, tests, and documentation form one delivery.

A task or PR is incomplete when it knowingly leaves relevant documentation describing obsolete behavior.

### README responsibility

`README.md` must accurately represent the current project and act as the entry point for someone discovering the repository today.

When implementing or removing a user-visible capability, check whether the README needs to change.

Avoid leaving:

- future plans described as implemented behavior;
- obsolete limitations;
- outdated architecture descriptions;
- obsolete workflows or commands.

If detailed technical information becomes too large for the README, move it into an appropriate document under `docs/` and link to it.

### Technical documentation

Important behavior that would be difficult to reconstruct from code should be documented in `docs/`.

Good candidates include:

- CHR allocation and ownership rules;
- Pattern Table behavior;
- CHR regions and reservations;
- project file formats;
- exporter formats;
- persistence/version migrations;
- palette model;
- animation and asset identity;
- NES validation rules;
- architectural decisions that affect future development.

Prefer documenting why a rule exists, especially when it comes from NES hardware behavior or an architectural invariant.

---

## Keep documentation trustworthy

Do not document intended behavior as if it already exists.

Documentation should clearly distinguish between:

- implemented behavior;
- known limitations;
- planned work.

Do not reopen a documented architectural decision casually.

If new evidence shows that an existing documented decision is wrong, identify:

1. the existing decision;
2. which assumption no longer holds;
3. the replacement behavior;
4. the code/tests affected;
5. the documentation that must change.

Avoid duplicating detailed documentation across several files. Prefer one authoritative explanation and links from other documents.

---

## Code quality

Follow the existing TypeScript style and project conventions.

Prefer:

- small focused functions;
- explicit domain types;
- pure functions for conversion, fact extraction, and validation logic;
- deterministic processing;
- descriptive names;
- separation between persisted state, canonical domain state, workspace state, and UI projections;
- reusable domain rules when multiple consumers need the same semantics.

Avoid:

- unexplained magic numbers;
- duplicated NES rules in multiple UI components;
- hidden mutations;
- unnecessary global state;
- parallel sources of truth;
- identity inferred from accidental numeric equality;
- mixing file parsing, domain logic, rendering, diagnostics, and exporting when they can reasonably remain separate.

NES constants should have names or comments when their meaning is not immediately obvious.

---

## UI and diagnostics

PNG2CHR Studio is a technical tool, but the user should not need to understand the source code to understand an error.

Validation messages should explain:

1. what is wrong;
2. whether the constraint comes from NES hardware or project configuration;
3. which resource/asset/slot is involved when known;
4. what the user can do about it, when practical.

Avoid silently correcting ambiguous input when that could produce unexpected exported data.

Warnings are preferable to hard failures when the result remains technically valid and the user may intentionally be doing something unusual.

Do not claim certainty when the project does not contain enough information to determine a hardware property.

Do not redesign unrelated UI while implementing a functional task.

---

## Scope discipline

Implement the requested task completely, but avoid expanding its scope unnecessarily.

Small adjacent fixes are acceptable when they are:

- directly related;
- low risk;
- necessary to keep behavior consistent.

Larger discoveries should be documented or proposed separately rather than quietly folded into the current change.

Do not perform broad cleanup merely because nearby code could be improved.

When an investigation uncovers a substantial independent problem, prefer creating or proposing a focused follow-up issue.

---

## Specialized reviewers

The repository may define read-only specialist agents for independent review.

These agents are critics, not implementers.

They may inspect code, documentation, tests, diffs, and repository state, and may run read-only validation commands, but they must not edit files, commit changes, or open implementation PRs.

### Seu Camilo

`seu-camilo` is the architecture and domain-integrity reviewer.

Use him for questions such as:

- Is this architecture consistent with the project model?
- Did this change introduce competing sources of truth?
- Are persistence, runtime models, diagnostics, and exporters still aligned?
- Is identity/ownership being interpreted correctly?
- Does this abstraction belong in the layer where it was introduced?
- Is a documented architectural decision being violated?

His authority is project architecture and integrity, not NES hardware truth by itself.

### Professor Carvalho

`professor-carvalho` is the NES hardware and validation reviewer.

Use him for questions such as:

- Is this configuration actually representable on NES hardware?
- Is this diagnostic based on a real hardware restriction?
- Are Pattern Table, palette, Attribute Table, sprite, or CHR rules modeled correctly?
- Does the application have enough information to make this hardware claim?
- Is project policy being incorrectly presented as an NES limitation?

His authority is NES hardware semantics and validation, not application architecture.

When a change affects both areas, both reviewers may give independent opinions.

Neither reviewer overrides tests, documentation, or explicit project decisions without evidence.

---

## Completion checklist

Before finishing a task, verify:

- the requested behavior is implemented;
- existing behavior was not unintentionally broken;
- canonical state and projections remain consistent;
- relevant regression tests were added or updated;
- relevant tests pass;
- lint passes;
- the production build succeeds when appropriate;
- persisted/exported formats remain valid;
- NES hardware constraints are still respected;
- project policy has not been confused with hardware constraints;
- `README.md` was reviewed for impact;
- relevant `docs/` files were reviewed for impact;
- documentation was updated when necessary;
- obsolete documentation introduced or exposed by the change was removed or corrected.

When reporting completion, summarize:

- what changed;
- important implementation decisions;
- tests performed;
- documentation updated;
- any remaining limitations or follow-up work.

---

## Pull requests

For implementation work, finish by opening a Pull Request against the appropriate target branch unless the user explicitly requests otherwise.

Do not merge the Pull Request.

The final report should include the branch, relevant commit(s), validation performed, and Pull Request link.

---

## Final rule

Code, tests, documentation, diagnostics, persisted state, and exported output must describe the same product.

Whenever one changes, verify whether the others must change with it.
