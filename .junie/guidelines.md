AugmentedQuill — Development Guidelines

Scope

- Audience: Contributors working on this repository.
- Goal: Fast, accurate setup notes for day-to-day development.

Project Snapshot

- Backend: Python 3.11+ + FastAPI (entrypoint: `app/main.py`, CLI: `augmentedquill`).
- Frontend: React + TypeScript + Vite in `frontend/`.
- Config: JSON files under `config/`.
  - `config/examples/*.json` are tracked as templates.
  - `config/machine.json`, `config/story.json`, `config/projects.json` are local runtime/test artifacts and must stay untracked.

Local Development

1. Backend

- Create and activate a virtualenv.
- Install:
  - `pip install -e '.[dev]'`
- Run (development):
  - `augmentedquill --reload --host 127.0.0.1 --port 28000`
  - (alternative) `python -m app.main --reload --host 127.0.0.1 --port 28000`

2. Frontend

- Install:
  - `cd frontend && npm install`
- Run dev server:
  - `cd frontend && npm run dev`
- Default dev URL is the Vite server (see README for the configured port). API calls are proxied to the backend.

Testing

- Run: `pytest`

Repo Hygiene

- Never commit secrets. Keep local credentials in environment variables or local `config/machine.json`.
- `config/*.json` (except `config/examples/*.json`) must remain untracked.
- `.idea/` and `.junie/` are intentionally tracked to preserve IDE integration.
