# Copilot Instructions

## Repository overview

- AugmentedQuill is a web-based GUI for AI-assisted prose writing, with a FastAPI backend and a React + TypeScript SPA frontend (Vite).
- Backend lives in src/augmentedquill/, frontend in src/frontend/, tests in tests/.
- Python 3.11+ required (CI uses 3.11; local validation on 3.12.3). Node.js 18+ required (CI uses 18).
- The backend serves the built frontend from static/dist; frontend build output must be present for production-like runs.

## High-level structure and key files

- Backend entrypoint: src/augmentedquill/main.py (FastAPI app factory, CLI entrypoint augmentedquill).
- Backend config utilities: src/augmentedquill/core/config.py (config paths and env interpolation).
- API layer: src/augmentedquill/api/v1/; services: src/augmentedquill/services/.
- Frontend entrypoints: src/frontend/index.tsx and src/frontend/App.tsx.
- Frontend API layer: src/frontend/services/api.ts and src/frontend/services/apiClients/.
- Build/lint/test config:
  - pyproject.toml (pytest, ruff, black, packaging).
  - src/frontend/package.json (npm scripts).
  - src/frontend/eslint.config.cjs, src/frontend/vite.config.ts, src/frontend/vitest.config.ts.
  - .pre-commit-config.yaml (ruff, black, prettier, eslint).
  - .github/workflows/code-quality.yml (CI checks).

## Runtime configuration and data

- Config files are read from resources/config/ (machine.json, story.json). Examples in resources/config/examples/.
- JSON schema contracts live in resources/schemas/.
- Runtime data and logs are stored under data/projects/ and data/logs/.
- Environment overrides: OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_TIMEOUT_S.

## Validated commands (run in this repo)

Backend setup (Python 3.12.3, venv):

- Always activate the venv before running any Python commands:
  - source venv/bin/activate
- python -m pip install -e ".[dev]"

Backend lint and tests (with venv active):

- ruff check .
- black --check .
- python -m pytest

Frontend setup (Node 18+ expected; npm install required before any frontend script):

- cd src/frontend && npm install
  - Note: npm reports 13 vulnerabilities (1 moderate, 12 high). This does not fail npm install or CI.

Frontend lint, tests, build:

- cd src/frontend && npm run lint
- cd src/frontend && npm run test
- cd src/frontend && npm run build
  - Build outputs to static/dist and is required for production-like runs.

## How to run

Production-like (serves built frontend):

- cd src/frontend && npm run build
- augmentedquill --host 127.0.0.1 --port 8000

Dev mode (hot reload + proxy):

- Terminal 1: augmentedquill --reload --host 127.0.0.1 --port 28000
- Terminal 2: cd src/frontend && npm run dev
- Vite dev server runs on http://127.0.0.1:28001 and proxies /api and /static to 28000.

## Required hygiene for new or modified files

- All .py/.ts/.tsx/.js files must include a GPL header and a Purpose line.
- Use python tools/enforce_code_hygiene.py . to normalize headers (this can modify files).
- Use python tools/check_copyright.py . to validate headers (fails if missing).

## CI and pre-commit parity

CI runs in .github/workflows/code-quality.yml:

- Backend: ruff check ., black --check, pytest.
- Frontend: npm run lint, npx prettier --check ., npm run test, npm run build.
  Pre-commit mirrors these via .pre-commit-config.yaml.

## Root inventory (important files and directories)

Files at repo root:

- CODE_OF_CONDUCT.md, CONTRIBUTING.md, LICENSE, README.md, SECURITY.md, pyproject.toml, tools.json, .pre-commit-config.yaml
  Directories at repo root:
- src/, tests/, tools/, docs/, resources/, static/, data/, .github/, AugmentedQuill.egg-info/

Top-level directories (one level down):

- src/augmentedquill/ (backend app)
- src/frontend/ (frontend app)
- tests/unit/ (backend tests)
- tools/ (repo scripts)
- resources/config/ and resources/schemas/ (config + schemas)
- static/ (images + built frontend output)
- data/ (local runtime data)

## Key README points (summary)

- Python 3.11+ and Node 18+ are required.
- Build frontend before running the app.
- Dev workflow: backend reload + Vite dev server.
- Config uses JSON with env overrides; samples in resources/config/examples/.

## Guidance

- Prefer editing backend logic in services/ and keep API routes thin.
- Prefer frontend changes inside features/<domain>/ and keep API calls in services/.
- Trust these instructions and only search the repo if something is missing or contradicts these notes.

## Chat Tools (LLM Function Calling)

To add a new chat tool:

1. Define a Pydantic model for parameters in the appropriate tool file (e.g., `src/augmentedquill/services/chat/chat_tools/project_tools.py`)
2. Decorate an async function with `@chat_tool(description="...")`
3. Implement: `async def tool_name(params: ParamsModel, payload: dict, mutations: dict) -> dict`
4. Return a dictionary (auto-wrapped as tool message)

Example:

```python
from pydantic import BaseModel, Field
from augmentedquill.services.chat.chat_tool_decorator import chat_tool

class MyParams(BaseModel):
    name: str = Field(..., description="Description")

@chat_tool(description="Does something")
async def my_tool(params: MyParams, payload: dict, mutations: dict):
    return {"result": "value"}
```

Tool files: `src/augmentedquill/services/chat/chat_tools/{project,story,chapter,sourcebook,image,order}_tools.py`
