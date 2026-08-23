# AugmentedQuill Dev Container

A fully sandboxed development environment for this repository:

- **Backend**: Python 3.12 (`mcr.microsoft.com/devcontainers/python:3.12`)
- **Frontend**: Node.js 24 (via the dev container Node feature)
- **Pre-installed**: backend editable install `.[dev]`, frontend deps, Playwright Chromium + system deps
- **VS Code extensions**: Python + Pylance, Ruff, Black, ESLint, Prettier, Tailwind, Playwright

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (or Docker Desktop) with the
  Dev Containers extension installed in VS Code.

## Getting started

1. Open this repository in VS Code (make sure Docker is running).
2. Run the command **Dev Containers: Reopen in Container**.
   - The first time this builds/creates the container it runs the bootstrap
     script automatically (`pip install -e ".[dev]"`, `npm install`, Playwright
     browser install). This takes a few minutes.
3. Once the terminal prompt appears, everything is ready.

> Rebuild (not just reopen) when you change `.devcontainer/*` files:
> **Dev Containers: Rebuild Container**.

## Day-to-day workflow

Run the backend (terminal 1):

```bash
source venv/bin/activate
augmentedquill --reload --host 127.0.0.1 --port 28000
```

Run the frontend dev server (terminal 2):

```bash
cd src/frontend
npm run dev
```

Open `http://127.0.0.1:5173` in your host browser. The Vite server proxies
`/api` and `/static` to the backend (default port `8000`; the dev backend on
`28000` requires `VITE_BACKEND_URL=http://127.0.0.1:28000 npm run dev`).

Validation (same as CI, see `AGENTS.md` §5):

```bash
venv/bin/ruff check .
venv/bin/black --check .
venv/bin/pytest
cd src/frontend && npm run lint && npm run typecheck && npm run test && npm run build
```

E2E / docs screenshot suites (Playwright Chromium is already installed):

```bash
cd src/frontend
npx playwright test                       # lightweight fixture suite
npx playwright test --config=playwright.fullstack.config.ts
npx playwright test --config=docs-screenshots.config.ts
```

## How it stays sandboxed

| Item                        | Host                        | Inside container                                                 |
| --------------------------- | --------------------------- | ---------------------------------------------------------------- |
| `venv/`                     | host's own venv (untouched) | separate **named volume** `augmentedquill-venv`                  |
| `src/frontend/node_modules` | host's own (untouched)      | separate **named volume** `augmentedquill-node_modules`          |
| Playwright browsers         | n/a                         | **named volume** `augmentedquill-playwright` (survives rebuilds) |
| Source files / `data/`      | —                           | shared via the workspace bind mount                              |

Because Python venvs and `node_modules` contain platform-specific binaries and
absolute interpreter paths, they are _not_ shared with the host — the container
installs its own copies in named volumes. The host setup is left completely
intact, so you can still work outside the container.

## LLM endpoint configuration

The container passes through `OPENAI_API_KEY`, `OPENAI_BASE_URL`,
`OPENAI_MODEL`, `OPENAI_TIMEOUT_S` and `VITE_BACKEND_URL` from your host
environment (`remoteEnv` → `${localEnv:...}`). Set them in your host shell or
in a `.env` before launching the container. No secrets are committed to the
repository.

## Troubleshooting

- **`Permission denied` while installing dependencies**: a stale root-owned
  named volume. Run **Dev Containers: Rebuild Container** (or
  `docker volume rm augmentedquill-venv augmentedquill-node_modules
augmentedquill-playwright` first).
- **Playwright browser missing**: `cd src/frontend && npx playwright install --with-deps chromium`.
- **Want to wipe the sandbox completely?** Rebuild the container and remove the
  three named volumes listed above — your source files and `data/` are never
  affected.
