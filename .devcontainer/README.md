# AugmentedQuill Dev Container

A fully sandboxed development environment for this repository:

- **Backend**: Python 3.12 (`mcr.microsoft.com/devcontainers/python:3.12`)
- **Frontend**: Node.js 24 (via the dev container Node feature)
- **Pre-installed**: GitHub CLI (`gh`), backend editable install `.[dev]`, frontend deps, Playwright Chromium + system deps
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

### Reaching LLM providers from the container

- **Cloud providers** (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, …)
  work out of the box — the dev container reaches the internet through the
  host's NAT. If your host needs an egress proxy, the container also passes
  through `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` and `ALL_PROXY`, which
  AugmentedQuill's HTTP client honors.
- **Providers on the Docker host** (e.g. Ollama on `localhost:11434`) are
  reachable via `http://host.docker.internal:<port>` — the dev container is
  started with `runArgs: ["--add-host=host.docker.internal:host-gateway"]`, so
  the name resolves to the host. Remember that `localhost` inside the container
  points at the container itself, not the host.
- **Providers in another container** can be reached by service/container name
  on a shared user-defined network, or via the Docker bridge gateway
  (`http://172.17.0.1:<port>`).
- Base URLs for host-local providers may need to be saved in **Settings →
  Machine Settings** (or set via `OPENAI_BASE_URL`) to pass AugmentedQuill's
  SSRF base-URL validation; `host.docker.internal` is already trusted. See the
  [Troubleshooting & FAQ](../docs/user_manual/13_troubleshooting.md#25-docker--container-networking-llm-providers-unreachable)
  chapter for details.

## Troubleshooting

- **Build fails with `The 'moby' option is not supported on debian 'trixie'`**:
  the `python:3.12` base image is Debian trixie based, and the
  `docker-outside-of-docker` feature defaults to installing the OSS Moby
  packages, which are not published for trixie. The feature is therefore
  configured with `"moby": false` (Docker CE CLI) in `devcontainer.json`. Keep
  that option when editing the feature block.
- **`Permission denied` while installing dependencies**: a stale root-owned
  named volume. Run **Dev Containers: Rebuild Container** (or
  `docker volume rm augmentedquill-venv augmentedquill-node_modules
augmentedquill-playwright` first).
- **Playwright browser missing**: `cd src/frontend && npx playwright install --with-deps chromium`.
- **Want to wipe the sandbox completely?** Rebuild the container and remove the
  three named volumes listed above — your source files and `data/` are never
  affected.
