# Copilot Instructions

This file is intentionally concise to reduce token overhead.

## Canonical policy source

- The canonical, comprehensive agent policy for this repository is `AGENTS.md` at the repository root.
- Apply `AGENTS.md` as the source of truth for architecture boundaries, style, testing, migration rules, and done criteria.

## Always-enforced highlights

- Never run `git stash` or `git commit` unless the user explicitly asks for it. Leave the user's git state (stashes, staged/unstaged changes, branches) untouched.
- Keep all application LLM instructions separated from code and stored in `resources/config/instructions.json`.
- Project/story file format changes must be backward compatible or include explicit schema/version bumps with automatic chainable migrations.
- Prioritize maintainable, compact code with strict separation of concerns and minimal duplication.
- Code must be professional and production-quality; avoid shortcuts and temporary hacks.
- Scene marker / scene-prose linking logic has exactly one implementation: backend `services/scenes/scene_markers.py` + `services/scenes/scene_service.py`, frontend `features/editor/internalTags.ts` + `features/scenes/proseLinkCoordinates.ts`. Never re-implement marker parsing/injection/offset math or link prose ad hoc — call the shared helpers (see `AGENTS.md` §6).

## Type discipline (Python + TypeScript)

- All new/modified Python and TypeScript code must be typed.
- Shared/library helpers should use reasonably wide reusable types where safety is preserved.
- Application/domain functions should use the strictest minimal types possible to encode invariants.
- Convert from wider boundary types to stricter internal types at module boundaries.
