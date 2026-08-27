# AGENTS.md

## Purpose

PNG2CHR Studio is a browser-based tool for creating, converting, inspecting, validating, and managing graphics and related data for Nintendo Entertainment System projects.

Favor practical NES development workflows over unnecessary abstraction.

The application should remain lightweight, deterministic, understandable, maintainable, and usable without a backend.

This file is a map and a set of project-wide invariants. It is not the complete project documentation.

---

## Repository knowledge

Before changing code, locate the documentation relevant to the task.

Start with:

* `README.md` for project overview, capabilities, setup, and user-facing behavior.
* `docs/` for detailed architecture, domain behavior, formats, workflows, and NES-specific rules.
* `.codex/agents/` only when a specialist reviewer is actually needed.
* `.codex/skills/` contains reusable workflow skills. Load one only when relevant to the current task.

Do not read every document before every task.

Use progressive discovery: inspect the task, identify affected concepts, then read the relevant code, tests, and documentation.

Repository code, tests, and versioned documentation are the source of truth. Do not rely on assumptions from previous tasks when the current repository can answer the question.

---

## Core engineering principles

* Prefer simple and explicit solutions over clever abstractions.
* Preserve existing behavior unless the task intentionally changes it.
* Reuse existing patterns before introducing new architecture.
* Avoid unrelated refactors.
* Avoid unnecessary dependencies.
* Do not silently change persisted formats, indexes, ownership semantics, or NES interpretation.
* Treat project files and exported formats as external interfaces.
* Maintain backward compatibility where practical.
* Fix underlying semantics rather than only a UI, diagnostic, or exporter symptom.
* Expand task scope only when required for correctness.

The goal is reliable software, not architectural perfection.

---

## Understand before changing

Before implementation:

1. Inspect the relevant code and existing tests.
2. Identify the affected data flow and canonical representation.
3. Check relevant documentation.
4. Inspect adjacent consumers when changing shared state, types, or invariants.
5. Determine whether persistence, exports, diagnostics, CHR layout, ownership, palettes, animations, or other NES-domain behavior are affected.

Do not assume the issue description completely represents the implementation.

If code and documentation disagree, investigate the intended behavior before preserving either one.

Do not perform repository-wide investigation when targeted inspection is sufficient.

---

## Canonical state and identity

Multiple representations may exist, but they must not become competing sources of truth.

General model:

* persisted project data is durable state;
* domain/core defines canonical runtime semantics;
* workspace/UI state is a projection or editing state;
* diagnostics derive facts from canonical state;
* exporters derive output from canonical state;
* caches and previews are disposable.

Never infer semantic identity from accidental numeric equality.

Keep these concepts distinct when relevant:

* asset, animation, and frame identity;
* logical tile identity;
* physical CHR slot;
* Pattern Table tile index;
* NES-visible tile index;
* palette definition;
* hardware palette slot;
* region and reservation identity.

Conversions between different identities must be explicit when non-trivial.

---

## NES hardware and project policy

NES hardware constraints are product requirements.

Do not bypass hardware validation merely to make an operation succeed.

Do not claim a hardware violation unless the Studio contains enough information to establish it.

When the result cannot be determined from available data, represent it as unknown/not determinable rather than guessing.

Always distinguish:

* NES hardware constraint;
* mapper/configuration behavior;
* project policy;
* allocation/ownership rule;
* persistence/schema rule;
* current Studio limitation.

A PNG2CHR Studio convention is not automatically an NES hardware limitation.

Detailed NES rules belong in the relevant documentation under `docs/`, not in this file.

---

## CHR, ownership, palettes, and diagnostics

When working with CHR:

* distinguish occupied, available, reserved, and conflicting physical slots;
* reservation is not ownership;
* logical asset existence is not proof of physical allocation;
* do not infer allocation from matching numeric indexes;
* respect Pattern Table boundaries and reservations;
* avoid double-counting capacity;
* keep Base CHR distinct from project-generated content where relevant.

When working with palettes, distinguish palette definitions from hardware palette slots, Background/Sprite banks, and universal background color semantics.

Diagnostics must derive from canonical project facts rather than reconstructing independent domain semantics in the UI.

Changes to these invariants require appropriate regression coverage.

---

## Scope and implementation discipline

Implement the requested task completely.

Small adjacent fixes are acceptable only when directly related, low risk, and necessary for consistency.

Do not:

* perform broad cleanup because nearby code could be improved;
* introduce abstractions for hypothetical future requirements;
* reopen documented architectural decisions without new evidence;
* repeatedly inspect unchanged files without reason;
* repeatedly run expensive validation when focused checks can validate the current iteration;
* invoke extra agents merely to increase confidence in an already well-supported conclusion.

Substantial independent discoveries should become focused follow-up work rather than silently expanding the current task.

---

## Testing and validation

Behavior changes should receive appropriate tests when reasonably possible.

Bug fixes should preferably include a regression test.

During implementation, prefer focused tests for fast feedback.

Before completion:

* run relevant tests;
* run the complete test suite for broad-impact changes;
* run lint;
* run the production build when appropriate.

Do not weaken tests, validation rules, lint, or TypeScript constraints merely to make checks pass unless the task establishes that the rule itself is wrong.

A task is not complete merely because it works manually.

---

## Documentation

Code, tests, and documentation form one delivery.

Update relevant documentation when changing:

* behavior;
* architecture;
* persisted or exported formats;
* domain invariants;
* development workflows or commands;
* user-visible capabilities.

Do not duplicate detailed domain documentation into `AGENTS.md`.

Prefer one authoritative document under `docs/` and link or discover it from related documentation.

Do not document planned behavior as already implemented.

---

## Specialist reviewers

Specialist reviewers are optional, read-only critics.

They are **not part of the default implementation workflow**.

Do not invoke a specialist merely because a task touches their domain.

Invoke one only when:

* the user explicitly requests the review;
* the task explicitly requires independent review;
* material ambiguity remains after inspecting code, tests, and documentation;
* conflicting evidence requires specialist judgment;
* a high-risk decision materially benefits from independent review;
* the task is explicitly a quality pass or audit where specialist review is useful.

Give specialists a focused question. Do not request unrestricted repository-wide audits unless the task actually requires one.

Do not invoke both specialists when one is sufficient.

Do not automatically re-invoke a specialist after implementing feedback.

### Seu Camilo

`seu-camilo` is the architecture and domain-integrity reviewer defined under `.codex/agents/`.

Use him for unresolved questions involving:

* canonical state;
* competing sources of truth;
* persistence/runtime divergence;
* ownership or identity semantics;
* domain boundaries;
* diagnostics/exporter consistency;
* architectural integrity.

Do not use him for routine implementation that the main agent can resolve directly from repository evidence.

### Professor Carvalho

`professor-carvalho` is the NES hardware and validation reviewer defined under `.codex/agents/`.

Use him for unresolved questions involving:

* NES hardware correctness;
* CHR and Pattern Table behavior;
* palettes;
* sprites/OAM;
* nametables and Attribute Tables;
* hardware-dependent diagnostics;
* whether available project data is sufficient to assert a hardware violation.

Do not use him merely because a feature involves NES graphics.

---

## Agent efficiency

Correctness comes first, but computation should be purposeful.

* Prefer targeted search over broad exploration.
* Prefer focused tests during iteration.
* Avoid repeating established analysis.
* Keep intermediate reports concise.
* Do not dump large logs when the decisive portion is sufficient.
* Do not narrate routine tool calls.
* Use specialist agents only when their independent judgment adds material value.
* Spend additional reasoning and context when uncertainty or risk warrants it, not merely because more analysis is possible.

### Output efficiency

Use the `caveman` skill for agent communication.

Its purpose is to reduce unnecessary output tokens without reducing technical
correctness or completeness.

Apply it to:
- intermediate reasoning reports;
- tool-call narration;
- progress updates;
- routine completion summaries.

Do not let compression reduce clarity, omit important findings, or alter
persistent project artifacts such as code, comments, documentation, commits,
issues, or Pull Requests.

---

## Completion

Before considering implementation complete, verify that:

* requested behavior works;
* relevant regressions are covered;
* canonical representations remain consistent;
* relevant tests pass;
* lint passes;
* production build succeeds when appropriate;
* persisted/exported formats remain valid;
* NES hardware and project policy remain correctly distinguished;
* relevant documentation is current.

Report concisely:

* what changed;
* important decisions;
* validation performed;
* documentation changed;
* specialist review, if any;
* remaining limitations or follow-up work.

---

## Pull requests

For implementation work, open a Pull Request against the appropriate target branch unless explicitly instructed otherwise.

Do not merge the Pull Request.

Report the branch, relevant commit(s), validation performed, and Pull Request link.

---

## Final invariant

Code, tests, documentation, diagnostics, persisted state, and exported output must describe the same product.

When one changes, determine which others must change with it.
