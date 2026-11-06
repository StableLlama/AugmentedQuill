# AGENTS.md

Agent operating guide for AugmentedQuill.

This file is intentionally optimized for coding agents: high-signal, executable guidance only.

## 1. Purpose And Scope

- Use this file as the primary agent playbook for this repository.
- Apply these rules for all files unless a more local AGENTS.md exists in a subdirectory.
- Prefer minimal, targeted changes. Avoid repo-wide refactors unless explicitly requested.

## 2. Project Snapshot

- Product: local-first AI writing assistant.
- Backend: FastAPI + Python (`src/augmentedquill`).
- Frontend: React + TypeScript + Vite (`src/frontend`).
- Tests: backend tests in `tests/unit`, frontend tests co-located with features.
- Production serving model: backend serves built frontend from `static/dist`.

## 3. Environment And Setup

### Required versions

- Python >= 3.12 (CI uses 3.12)
- Node >= 24 (CI uses 24)

### Backend setup (repo root)

```bash
source venv/bin/activate
python -m pip install -e ".[dev]"
```

### Frontend setup

```bash
cd src/frontend
npm install --legacy-peer-deps
```

## 4. Run Commands

### Dev mode (recommended)

Terminal 1:

```bash
source venv/bin/activate
augmentedquill --reload --host 127.0.0.1 --port 28000
```

Terminal 2:

```bash
cd src/frontend
npm run dev
```

- Vite dev server defaults to `http://127.0.0.1:28001` and proxies backend/static.

### Production-like local run

```bash
cd src/frontend && npm run build
cd ../..
source venv/bin/activate
augmentedquill --host 127.0.0.1 --port 8000
```

## 5. Mandatory Validation (Before Finishing)

Run the smallest relevant subset first, then broaden if needed.

### Backend checks

```bash
source venv/bin/activate
ruff check .
black --check .
python -m pytest
```

### Frontend checks

```bash
cd src/frontend
npm run lint
npm run typecheck
npm run test
npm run build
```

### Generated API types drift check

```bash
cd src/frontend
npm run check:generated-types
```

## 6. Architecture Boundaries (Do Not Cross)

### Backend

- Keep route handlers in `src/augmentedquill/api/v1` thin.
- Put business logic in `src/augmentedquill/services/<domain>`.
- Use shared response helpers in `src/augmentedquill/api/v1/http_responses.py` where applicable.
- Use project dependency resolution (`ProjectDep`) from `src/augmentedquill/api/v1/dependencies.py` for project-scoped routes.
- Keep all application LLM instructions separated from code and stored in `resources/config/instructions.json` so instruction sets can be project-language specific.
- Chat tools are **atomic and independent**: one tool call either applies completely or changes nothing, and each call in a batch fails on its own without rolling back the others (never add cross-call transactions). Validate every payload and every placement target _before_ the first write; if a later step of the same call fails, restore what the earlier step wrote (see `scene_tools._restore_scene_field_values`). Validation failures must return before any write — regression tests: `tests/unit/services/test_chat_tools.py` → `test_manage_scenes_update_is_atomic_*`, `test_manage_scenes_update_does_not_move_the_scene_when_content_is_rejected`.

### Frontend

- Keep feature logic in `src/frontend/features/<domain>`.
- Keep reusable UI primitives in `src/frontend/components/ui`.
- Use API facade/client modules in `src/frontend/services`.
- Do not introduce ad-hoc fetch calls in features when an API client exists.
- Failed tool calls must stay visible and must never look like changes: a mutation-producing call whose result carries `error` yields a red `failed` badge with no change hint (`mutationToolRegistry.buildFailedMutation`), failed calls are excluded from `tool_batch.operation_count` (backend `_tool_message_reports_error`), and the chat loop sends a corrective retry hint instead of accepting the model's summary (`chatExecutionHelpers.summarizeFailedToolCalls`).

### Scene markers and prose linking (STRICT — single implementation only)

Scene marker handling is brittle (offsets, exclusivity, annotations, unlink/relink).
There must be exactly one implementation per side, and every caller must use it.

Backend — the only allowed home for marker and prose-link logic:

- `src/augmentedquill/services/scenes/scene_markers.py`
  - marker grammar, `parse_scene_spans`, `find_scene_marker_span`, `scene_block_bounds`,
    `scene_marker_token`, `scene_marker_token_ranges`, `inject_markers`, `remove_markers`,
    `transfer_scene_markers`, `validate_*` helpers.
- `src/augmentedquill/services/scenes/scene_service.py`
  - `link_prose`, `unlink_prose`, `relink_scope_prose`, `update_prose_content`,
    `append_text_to_scope`, `link_range_to_scene`, `scene_prose_is_linked`,
    `scope_link_for_content_path`, `reorder_scene_prose`, `create_scene`, `delete_scene`.

Rules:

- Do NOT build `<!--scene:...-->` strings, write local marker regexes, or manually
  insert/remove markers anywhere else — call the helpers above.
- Do NOT write prose files after hand-editing markers. Prose persistence for a scene must
  go through `append_text_to_scope` + `link_range_to_scene` (single range) or
  `link_prose`/`relink_scope_prose` (multi-range), so offset remapping and marker
  exclusivity validation always run.
- New prose-writing entry points (chat tools, REST routes, generation flows) must reuse the
  same finalize helpers. If one of them needs new behaviour, add it to the shared service
  function — never fork the logic.
- Frontend: all marker parsing, token construction and coordinate conversion must go through
  `src/frontend/features/editor/internalTags.ts` (`INLINE_*_REGEX`, `sceneMarkerToken`,
  `getSceneMarkerSpans`, `getSceneMarkerTokenRanges`, `stripInlineInternalMarkers`,
  `toVisibleOffset`/`toOriginalOffset`) and `features/scenes/proseLinkCoordinates.ts`.
  Do not add local marker regexes in components/stores.

Allowed exceptions (still keep them frozen and minimal):

- Version migration scripts in `src/augmentedquill/updates/` (they encode historical formats).
- Test assertions/fixtures that assert the on-disk marker format.

Coordinate spaces (get this wrong and scenes silently unlink — check it in every review):

- **Raw space**: offsets in file content _including_ marker tokens. Used by
  `link_prose`, `update_prose_content`, `SceneLinkProseRequest`, and any store value that
  carries `chapter.content` (which is marker-inclusive).
- **Visible space**: offsets in marker-stripped content, used by the CodeMirror document
  and by `relink_scope_prose` assignments (it strips scene _and_ annotation markers
  before re-injecting). Convert with `toVisibleOffset`/`toOriginalOffset`
  (`internalTags.ts`) — never by subtracting guesses.
- Measuring prose for boundary splitting must strip **all** internal markers
  (`strip_internal_markers`), not just scene markers: leftover annotation tokens shift
  every computed offset.

Hard-won invariants (each one already caused real data loss — keep them covered):

- Emptied scene spans stay ADJACENT pairs (`start1 end1 start2 end2`), never nested.
- An emptied (zero-width) span must never be dropped: it is the only thing keeping the
  scene linked. `relink_scope_prose` preserves them, `link_range_to_scene` re-links them
  instead of reporting success, and `transfer_scene_markers` maps a markers-only
  document onto new prose instead of dropping every marker.
- The editor's marker baseline (`lastSavedFullContentRef`) must always track
  `chapter.content`; the debounced save re-injects markers from it.
- `prose_link` is a dict even for brand-new scenes (`scope_type == "unlinked"`). Use the
  predicates only — backend `scene_prose_is_linked()`, frontend `isLinkedProseLink()`
  from `features/scenes/proseLinkCoordinates.ts`. Never `if scene.prose_link`.
- The scene editor must open in diff mode whenever the baseline prose differs from the
  current prose (pending AI diff), not only for AI-triggered opens. Its baseline slice
  comes from the scene's markers inside the baseline content
  (`getSceneProseFromContent`) — never from stored `prose_link` offsets, which go stale —
  and must be marker-free (the editor document is marker-free).
- The same rule applies to _all_ scene fields: `sceneFieldsDiffer()` (summary, beats,
  characters, sourcebook tags, temporal state, linked prose) decides the diff mode, so a
  `manage_scenes(action='update')` beat change is visible no matter how the dialog was
  opened. Only an unchanged scene keeps the diff view off.
- Beat diff rows are aligned by text, not by array position
  (`features/scenes/sceneBeatDiff.ts` → `diffSceneBeats`): position-based comparison
  flagged every beat after an insertion and could not show deletions. Added beats are
  tinted with the paper-based insert tokens (`highlightColors.diffInsertBg/Border`,
  layered over `contentSurface`), removed baseline beats render as read-only delete rows.
  Do not reintroduce theme classes (`bg-brand-50` / `bg-brand-gray-800/40`) for beat
  highlights — they are invisible against the dark dialog chrome.
- Save endpoints fail closed: `write_chapter_content_in_project` and
  `write_story_content_in_project` run `validate_marker_integrity` on the incoming
  payload, so a corrupting client is rejected instead of persisting broken markers.

Required tests for any marker/linking change:

- Backend: `tests/unit/services/test_scene_markers.py`, `test_scene_service.py`,
  `test_annotation_service.py`, `test_project_content_marker_preservation.py`, and
  API-level `tests/unit/api/v1/test_scenes_api.py`.
- Frontend: `features/editor/internalTags.test.ts`, `features/editor/Editor.sync.test.tsx`
  (marker-baseline suite), `features/scenes/proseLinkCoordinates.test.ts`, and
  `features/scenes/SceneCard.test.tsx` (linked/unlinked indicator).
- Regression tests must fail on the un-fixed code; verify that before declaring done.

## 7. Style And Conventions

### Test driven development (TDD)

Implement test cases to cover the user specification first and then implement the solution. Finish with implementing test cases that cover every valid input as well as those that have bad input to test correct error handling, so that any regression is easily detected.

### Required file headers

- Every new/modified `.py`, `.ts`, `.tsx`, `.js` file must include:
  - GPL header
  - Purpose line/docstring style used by the repository

Use:

```bash
python tools/enforce_code_hygiene.py .
python tools/check_copyright.py .
```

### Python

- Formatter/linter: Black + Ruff
- Line length: 88
- Favor typed signatures and small service helpers over oversized route functions.
- Code changes must be professional and solid; avoid shortcuts and temporary hacks.
- Use type annotations for all new/modified Python code (function params, return types, and important variables where needed for clarity).

### TypeScript/React

- Linting via `src/frontend/eslint.config.cjs`
- Key enforced rules include:
  - single quotes
  - no explicit `any`
  - prefer typed parameters
  - accessibility-focused jsx-a11y rules
- Code changes must be professional and solid; avoid shortcuts and temporary hacks.
- Use explicit, precise TypeScript types for all new/modified code; avoid implicit `any` and weakly typed shapes.

### Type design strategy (library-wide vs app-specific)

- Library/shared helper functions should accept reasonably wide, reusable input types where this does not reduce safety.
- Program/application functions should use the strictest minimal types possible to encode concrete invariants.
- Prefer converting from wide boundary types to strict internal types at module boundaries.
- Keep type contracts explicit; do not rely on ambiguous unions when domain types are known.

### Maintainability priorities (highest priority)

- Optimize first for maintainable and compact code.
- Avoid duplication; prefer shared helpers over copy-pasted logic.
- Enforce strict separation of concerns across route/service/model/UI layers.

### i18n and language handling (strict)

- Never hardcode user-facing English strings in UI components.
- Use `react-i18next` translation keys.
- Inputs/textareas that edit story text must set `lang={storyLanguage || 'en'}` (or equivalent) and keep spellcheck behavior correct.
- Never hardcode LLM facing prompts or prompt templates, use `instructions.json` and its infrastructure for project specific language prompts and templates.

## 8. Test Data Safety (Strict)

- Never use real runtime data directories in tests:
  - `data/config`
  - `data/projects`
  - `data/logs`
- Tests must isolate runtime paths via temp environment variables before importing app modules:
  - `AUGQ_USER_DATA_DIR`
  - `AUGQ_PROJECTS_ROOT`
  - `AUGQ_PROJECTS_REGISTRY`
  - `AUGQ_MACHINE_CONFIG_PATH` (when needed)
- Follow `tests/conftest.py` pattern for session-scoped temporary directories.

## 9. Generated Artifacts Rules

- Treat these as generated artifacts and do not hand-edit unless explicitly required:
  - `openapi.json` (from backend export tool)
  - `src/frontend/types/api.generated.ts` (from OpenAPI generation)
- If backend API contracts change, regenerate and validate generated type files.

## 9.5 Project File Schema Evolution Rules

- Changes to project/story files must either be intrinsic backward compatible or explicitly bump the config/schema version.
- Any version bump must include an automatic conversion function from the prior version.
- Conversions must be chainable step-by-step (for example v2 -> v3 -> v4) so older versions can be upgraded safely through intermediate migrations.
- Never introduce a breaking project-file format change without a tested migration path.
- Never introduce code that handles older versions of the files, always relay on the files having the current version and the version conversion scripts are used to make the files compatible. Do not use in project code for backward compatability.

## 10. Security And Operational Guardrails

- App is local-first and not designed for public internet exposure without external access controls.
- Prefer local loopback bindings for development (`127.0.0.1`).
- Be careful with LLM request/response logs and secrets in environment variables.

## 11. Agent Workflow Heuristics

- **Never run `git stash` or `git commit` (or any history-changing git operation such as `rebase`, `reset`, or creating/deleting branches) unless the user explicitly instructed you to.** Git state — stashes, staged/unstaged changes, and branches — is the user's work-in-progress and must be left untouched. In particular, never use `git stash` to temporarily move changes aside, and never create commits on the user's behalf.
- Read only what is needed for the current task.
- Prefer surgical edits over broad rewrites. But also do not hesitate a rewrite when that increases maintainability and prevents duplication.
- After edits, run relevant checks and report concrete outcomes.
- If failures are unrelated to your change, report them clearly instead of silently changing unrelated code.
- Preserve existing style and naming in touched files.

## 12. Token Budget Rules (What To Include vs Omit)

Use this section to avoid context waste in future agent updates.

### Keep in AGENTS.md

- Stable, repo-wide commands and constraints.
- Non-obvious pitfalls that frequently cause regressions.
- Hard requirements (test isolation, i18n constraints, generated file rules).
- Architectural boundaries that prevent misplaced code.

### Keep out of AGENTS.md

- Exhaustive file trees and long inventories.
- Full architecture narratives already covered in docs.
- Rare one-off historical incidents.
- Verbose style philosophy not tied to actionable checks.
- Duplicate instructions that are already enforced by tooling, unless the failure cost is high.

## 13. Fast Task Routing

- API endpoint behavior change: edit route in `api/v1`, implement logic in `services/<domain>`, add/update backend tests.
- Frontend feature/UI change: edit `features/<domain>`, keep strings in i18n resources, add/update component tests.
- Config/path behavior: inspect `src/augmentedquill/core/config.py` and corresponding tests in `tests/unit/core`.
- Chat tool change: update tool models/functions under `src/augmentedquill/services/chat/chat_tools` and validate tool schema behavior.

## 14. Definition Of Done For Agent Changes

- Code compiles/lints/tests for the touched area.
- Required generated artifacts updated (if applicable).
- No hardcoded UI strings introduced.
- No real user runtime data touched by tests.
- Diff is minimal and scoped to the request.
