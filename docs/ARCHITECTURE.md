# AugmentedQuill Architecture

This document summarizes system architecture, runtime boundaries, and the data/control flow between frontend, backend, and LLM providers.

## 1) System Overview

AugmentedQuill is a two-tier application:

- Backend: FastAPI app in `src/augmentedquill/` provides REST endpoints, story/project persistence orchestration, and server-side utility operations.
- Frontend: React SPA in `src/frontend/` provides writer-facing UX and invokes backend APIs.

The backend can also serve static frontend assets for production-like local runs.

## 2) Backend Architecture

### API Layer (`src/augmentedquill/api/v1/`)

- Responsibility: HTTP contracts, request validation, response shaping, endpoint composition.
- Design rule: API modules should remain thin and defer business logic to service modules.
- Route groups (`story_routes/`, `chapters_routes/`) split larger API surfaces into focused units.

### Service Layer (`src/augmentedquill/services/`)

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

- `src/augmentedquill/core/`: config/prompt bootstrap and cross-cutting runtime constants.
- `src/augmentedquill/models/`: shared domain model definitions.
- `src/augmentedquill/utils/`: generic helpers (stream parsing, image helpers, etc.).
- `src/augmentedquill/updates/`: explicit data/version migration paths.

## 3) Frontend Architecture

### Composition Root

- `src/frontend/App.tsx` composes feature hooks/components and coordinates shared app state.

### Feature-First UI Structure

- `src/frontend/features/<domain>/` packages each business domain's components and hooks.
- Domain examples: chat, editor, story, chapters, projects, settings, sourcebook, layout, debug.

### API Access Layer

- `src/frontend/services/api.ts` and `src/frontend/services/apiClients/` provide typed backend API calls.
- `src/frontend/services/apiTypes.ts` defines API DTO contracts.
- This separation keeps UI code focused on interaction while service modules handle transport shape.

## 4) Frontend/Backend Interaction Model

1. User action occurs in a feature component/hook.
2. Feature invokes frontend API client (`src/frontend/services/...`).
3. Backend route handler (`src/augmentedquill/api/v1/...`) validates and dispatches.
4. Domain service (`src/augmentedquill/services/<domain>/...`) executes workflow and persistence logic.
5. Response is returned to frontend and reflected in local UI state.

Streaming operations (story generation/chat streaming) follow the same chain, but return incremental events that UI consumers render progressively.

## 5) LLM Calling Architecture

LLM usage is intentionally split by responsibility:

- Frontend settings can maintain provider endpoint details and active model selections.
- Backend service modules construct domain-specific prompts and call into `src/augmentedquill/services/llm/` helpers.
- `src/augmentedquill/services/llm/llm_completion_ops.py` and `src/augmentedquill/services/llm/llm_stream_ops.py` implement completion and streaming integration logic.
- `src/augmentedquill/services/llm/llm_logging.py` supports optional request/response diagnostics.

### Typical LLM Flow

1. Feature initiates generation/chat request.
2. Backend service collects story/project/sourcebook context.
3. Prompt strategy from `src/augmentedquill/core/prompts.py` and domain services defines model input.
4. LLM service executes completion/stream request.
5. Parsed output is mapped back to story/chat structures and sent to the frontend.

### Chat Tools (Function Calling)

AugmentedQuill implements LLM function calling using a **decorator-based architecture** that co-locates tool schemas with their implementations. This ensures consistency and eliminates manual schema maintenance.

- **Decorator** (`chat_tool_decorator.py`): `@chat_tool` decorator auto-registers tools and generates schemas from Pydantic models
- **Implementations** (`chat_tools/*.py`): Each domain (project, story, chapter, etc.) has its tools in a separate file
- **Schema Collection** (`chat_tools_schema.py`): Collects all registered tool schemas for LLM API calls
- **Dispatcher** (`chat_tool_dispatcher.py`): Routes tool calls to their handlers

#### Adding a New Tool

Define a Pydantic model and use the `@chat_tool` decorator:

```python
from pydantic import BaseModel, Field
from augmentedquill.services.chat.chat_tool_decorator import chat_tool

class MyParams(BaseModel):
    name: str = Field(..., description="Description")

@chat_tool(description="Tool description")
async def my_tool(params: MyParams, payload: dict, mutations: dict):
    return {"result": "value"}
```

Tools are auto-registered at import time and schemas are auto-generated from Pydantic models.

## 6) Persistence and Data Boundaries

- Runtime content is persisted under `data/projects/` (stories, chapter files, related content).
- Operational logs are under `data/logs/`.
- Static schemas and templates live under `resources/`.

The architecture treats `resources/` as reference/config contracts and `data/` as mutable runtime state.

## 7) Quality and Maintainability Conventions

- Keep HTTP concerns in `src/augmentedquill/api/v1/` and move domain logic into `src/augmentedquill/services/`.
- Keep feature-specific frontend logic within the corresponding `src/frontend/features/<domain>/` directory.
- Use typed API contracts to avoid shape drift between frontend and backend.
- Enforce code hygiene headers with:
  - `python tools/enforce_code_hygiene.py .`
