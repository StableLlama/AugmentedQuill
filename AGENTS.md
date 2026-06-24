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

### Frontend

- Keep feature logic in `src/frontend/features/<domain>`.
- Keep reusable UI primitives in `src/frontend/components/ui`.
- Use API facade/client modules in `src/frontend/services`.
- Do not introduce ad-hoc fetch calls in features when an API client exists.

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
