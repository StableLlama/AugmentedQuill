# AugmentedQuill Codebase Organization

This document defines where files belong and why each top-level area exists.

## Top-Level Layout

- `src/augmentedquill/`: Python backend application code (FastAPI API, domain services, models, utilities).
- `src/frontend/`: React + TypeScript single-page application (Vite-based).
- `tests/`: Python backend-focused test suite.
- `tools/`: Development and maintenance scripts.
- `resources/`: Configuration templates, JSON schemas, and static sample config assets.
- `static/`: Runtime-served static assets (images and built frontend output).
- `data/`: Local runtime project data, logs, and user project state.
- `docs/`: Human-facing technical documentation (organization and architecture).

## Backend (`src/augmentedquill/`)

- `src/augmentedquill/main.py`: Backend startup entry point and FastAPI app assembly.
- `src/augmentedquill/api/v1/`: HTTP route modules and route composition.
  - Use this for request/response contract and endpoint wiring.
  - Keep business logic out of route handlers; delegate to `src/augmentedquill/services/`.
  - `src/augmentedquill/api/v1/*_routes/` holds route-group helpers for larger API areas.
- `src/augmentedquill/services/`: Domain and use-case logic.
  - `chat/`: chat request handling, tool dispatch, streaming helpers.
  - `chapters/`: chapter CRUD and chapter-level operations.
  - `story/`: story generation, mutation, and story-state orchestration.
  - `projects/`: project lifecycle, structure, and metadata operations.
  - `settings/`: settings persistence and machine/project config updates.
  - `sourcebook/`: sourcebook entry and validation logic.
  - `llm/`: model invocation, streaming, completion, and logging operations.
- `src/augmentedquill/core/`: cross-cutting runtime configuration and prompt loading.
- `src/augmentedquill/models/`: backend data models and shared backend domain structures.
- `src/augmentedquill/utils/`: low-level helpers used by multiple services.
- `src/augmentedquill/updates/`: explicit migration/update scripts between story/config versions.

### Backend Placement Rules

- New API endpoint file: place in `src/augmentedquill/api/v1/` (or matching `*_routes/` subtree if the area is already split).
- New business rule or workflow: place in `src/augmentedquill/services/<domain>/`.
- New generic helper used by multiple domains: place in `src/augmentedquill/utils/`.
- New global configuration/prompt bootstrap logic: place in `src/augmentedquill/core/`.
- New persistent model type used across backend domains: place in `src/augmentedquill/models/`.
- New version migration: place in `src/augmentedquill/updates/`.

## Frontend (`src/frontend/`)

- `src/frontend/App.tsx`: composition root for app-level state and feature integration.
- `src/frontend/index.tsx`: browser entry point.
- `src/frontend/features/`: feature-oriented UI + hooks grouped by domain.
  - `chat/`, `editor/`, `projects/`, `settings/`, `sourcebook/`, `story/`, `chapters/`, `layout/`, `debug/`.
  - Keep feature-local UI and hooks inside the corresponding feature folder.
- `src/frontend/components/ui/`: reusable UI primitives shared by features.
- `src/frontend/services/`: API and integration adapters.
  - `api.ts` and `apiTypes.ts` define API request helpers and contract types.
  - `apiClients/` contains endpoint-grouped API clients.
- `src/frontend/types.ts`: app-wide shared frontend types.

### Frontend Placement Rules

- New domain-specific component or hook: place under `src/frontend/features/<domain>/`.
- New reusable presentational primitive: place in `src/frontend/components/ui/`.
- New backend endpoint client or adapter: place in `src/frontend/services/`.
- New frontend-only shared type used in many features: place in `src/frontend/types.ts` (or split into a typed module under `src/frontend/services/` when API-specific).

## Tests (`tests/`)

- `tests/unit/`: backend unit/integration-style tests grouped by backend architecture:
  - `api/v1/`: endpoints and route-level contracts.
  - `core/`: configuration, constant, and runtime-wide logic.
  - `models/`: data structure and schema validation.
  - `services/`: domain workflows, LLM orchestration, and project logic.
- `tests/conftest.py`: shared fixtures and setup.

### Test Placement Rules

- Backend behavior test: `tests/unit/<category>/test_<capability>.py`.
- Shared fixture/helper for tests: `tests/conftest.py` or a local helper in `tests/unit/`.

## Tooling and Runtime Data

- `tools/`: scripts for hygiene checks, debug helpers, and test support.
- `resources/config/`: canonical config templates and examples.
- `resources/schemas/`: JSON schema contracts for config/story documents.
- `data/projects/`: persisted project content during local usage.
- `data/logs/`: runtime logs, including optional LLM dumps.

## Hygiene Standards (Repository-Wide)

All `*.py`, `*.ts`, `*.tsx`, and `*.js` files are expected to start with:

1. GPL copyright notice.
2. A one-line `Purpose:` header describing why the file exists.

Use `python tools/enforce_code_hygiene.py .` to normalize headers and validate compliance.
