# AugmentedQuill Architecture

This document summarizes system architecture, runtime boundaries, and the data/control flow between frontend, backend, and LLM providers.

## 1) System Overview

AugmentedQuill is a two-tier application:

- Backend: FastAPI app in `app/` provides REST endpoints, story/project persistence orchestration, and server-side utility operations.
- Frontend: React SPA in `frontend/` provides writer-facing UX and invokes backend APIs.

The backend can also serve static frontend assets for production-like local runs.

## 2) Backend Architecture

### API Layer (`app/api/`)

- Responsibility: HTTP contracts, request validation, response shaping, endpoint composition.
- Design rule: API modules should remain thin and defer business logic to service modules.
- Route groups (`story_routes/`, `chapters_routes/`) split larger API surfaces into focused units.

### Service Layer (`app/services/`)

- Responsibility: domain workflows and orchestration.
- Key domains:
  - `projects/`: lifecycle, structure, registration, and metadata operations.
  - `story/`: story state changes, prompt handling, generation orchestration.
  - `chapters/`: chapter-level mutate/read workflows.
  - `chat/`: chat session execution, tool dispatch, and stream output handling.
  - `settings/`: machine/app setting read/update logic.
  - `sourcebook/`: sourcebook domain operations.
  - `llm/`: provider interaction, completions, stream handling, and LLM logging.

### Core and Shared Utilities

- `app/core/`: config/prompt bootstrap and cross-cutting runtime constants.
- `app/models/`: shared domain model definitions.
- `app/utils/`: generic helpers (stream parsing, image helpers, etc.).
- `app/updates/`: explicit data/version migration paths.

## 3) Frontend Architecture

### Composition Root

- `frontend/App.tsx` composes feature hooks/components and coordinates shared app state.

### Feature-First UI Structure

- `frontend/features/<domain>/` packages each business domain's components and hooks.
- Domain examples: chat, editor, story, chapters, projects, settings, sourcebook, layout, debug.

### API Access Layer

- `frontend/services/api.ts` and `frontend/services/apiClients/` provide typed backend API calls.
- `frontend/services/apiTypes.ts` defines API DTO contracts.
- This separation keeps UI code focused on interaction while service modules handle transport shape.

## 4) Frontend/Backend Interaction Model

1. User action occurs in a feature component/hook.
2. Feature invokes frontend API client (`frontend/services/...`).
3. Backend route handler (`app/api/...`) validates and dispatches.
4. Domain service (`app/services/<domain>/...`) executes workflow and persistence logic.
5. Response is returned to frontend and reflected in local UI state.

Streaming operations (story generation/chat streaming) follow the same chain, but return incremental events that UI consumers render progressively.

## 5) LLM Calling Architecture

LLM usage is intentionally split by responsibility:

- Frontend settings can maintain provider endpoint details and active model selections.
- Backend service modules construct domain-specific prompts and call into `app/services/llm/` helpers.
- `app/services/llm/llm_completion_ops.py` and `app/services/llm/llm_stream_ops.py` implement completion and streaming integration logic.
- `app/services/llm/llm_logging.py` supports optional request/response diagnostics.

### Typical LLM Flow

1. Feature initiates generation/chat request.
2. Backend service collects story/project/sourcebook context.
3. Prompt strategy from `app/core/prompts.py` and domain services defines model input.
4. LLM service executes completion/stream request.
5. Parsed output is mapped back to story/chat structures and sent to the frontend.

## 6) Persistence and Data Boundaries

- Runtime content is persisted under `data/projects/` (stories, chapter files, related content).
- Operational logs are under `data/logs/`.
- Static schemas and templates live under `resources/`.

The architecture treats `resources/` as reference/config contracts and `data/` as mutable runtime state.

## 7) Quality and Maintainability Conventions

- Keep HTTP concerns in `app/api/` and move domain logic into `app/services/`.
- Keep feature-specific frontend logic within the corresponding `frontend/features/<domain>/` directory.
- Use typed API contracts to avoid shape drift between frontend and backend.
- Enforce code hygiene headers with:
  - `python tools/enforce_code_hygiene.py .`
  - `python tools/check_copyright.py .`
