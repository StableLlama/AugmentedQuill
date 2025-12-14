AugmentedQuill — Development Guidelines

Scope
- Audience: Advanced developers working on this repository.
- Goal: Capture the project-specific build, configuration, testing, and development practices that will accelerate future work.

Project Snapshot
- Stack (from README):
  - Backend: Python, FastAPI
  - Frontend: HTMX
  - LLM Access: OpenAI API
  - Configuration: JSON files for both machine-specific and story-specific settings

Build and Configuration
1) Python and Tooling
- Recommended Python: 3.11+ (for performance, typing, and FastAPI ecosystem compatibility).
- Virtual environment: Use uv or venv/poetry (team preference). Examples with venv:
  - python3 -m venv .venv
  - source .venv/bin/activate
- Dependencies: Not yet committed (no requirements.txt/pyproject.toml present). Expect to include at least:
  - fastapi, uvicorn[standard]
  - httpx or aiohttp (if calling OpenAI directly without SDK)
  - openai (official SDK) or litellm (optional adapter)
  - pydantic (bundled via FastAPI, but explicit pin recommended)
  - jinja2 or similar (if server-side templates are used)
  - pytest or unittest for tests, plus optional plugins
- Until dependency files are added, install packages ad hoc during prototyping.

2) Runtime Configuration
- Machine-specific settings (e.g., OpenAI credentials) are JSON-based (per README). Establish the following conventions early:
  - Environment variable overrides always win (e.g., OPENAI_API_KEY, OPENAI_BASE_URL).
  - Default config path patterns:
    - config/machine.json — contains API credentials and model endpoints (never commit secrets).
    - config/story.json — active story/chapter settings.
  - Example machine.json structure:
    {
      "openai": {
        "api_key": "${OPENAI_API_KEY}",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
        "timeout_s": 60
      }
    }
  - Example story.json structure:
    {
      "project_title": "My Novel",
      "chapters": ["000-intro.md", "010-conflict.md"],
      "format": "markdown",
      "llm_prefs": {"temperature": 0.7, "max_tokens": 2048}
    }
- Secrets handling:
  - Prefer exporting OPENAI_API_KEY in the environment (avoids committing secrets in JSON).
  - Consider .env + python-dotenv if convenient, but do not commit secrets.

3) Local App Execution (expected)
- Once the FastAPI app module is added (e.g., app/main.py exposing app = FastAPI(...)) run via:
  - uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
- Frontend (HTMX) typically resides in templates/ + static/ or a single HTML with HTMX endpoints. Ensure CORS if you split origins.

Testing
Strategy
- Unit tests should cover:
  - JSON config parsing and precedence (env overrides > machine.json > defaults).
  - OpenAI client wrapper: request shaping, retries, and error handling (use fakes; never call real APIs in unit tests).
  - FastAPI routes: response schemas and status codes (use TestClient from fastapi.testclient or httpx.AsyncClient with lifespan).
  - Text processing utilities (formatting raw vs markdown, chapter management).
- Integration tests (optional initially): spin up app with in-memory/fake backends and hit key endpoints.

Test Layout
- Use a top-level tests/ directory:
  - tests/unit/... for isolated units
  - tests/integration/... for end-to-end flows
- Naming: test_*.py; functions and async tests named test_*.

Running Tests (unittest)
- Command to discover and run tests:
  - python3 -m unittest discover -s tests -p "test_*.py"
- Add verbose output with -v if desired.

Adding a New Test (unittest)
- Example skeleton:
  from unittest import TestCase

  class ConfigTest(TestCase):
      def test_defaults(self):
          # Arrange
          data = {"format": "markdown"}
          # Act
          # call your loader/validator
          # Assert
          self.assertIn("format", data)

FastAPI Route Testing Example (pytest-style, easily adapted to unittest)
- If adopting pytest, an example:
  import pytest
  from fastapi.testclient import TestClient
  from app.main import app

  def test_healthcheck():
      client = TestClient(app)
      resp = client.get("/health")
      assert resp.status_code == 200
      assert resp.json() == {"status": "ok"}

Demonstrated Working Test Run
- To verify test execution in this repository, a temporary unittest was created, executed, and then removed (as requested):
  - Created tests/test_sanity.py with a simple assertion.
  - Ran: python3 -m unittest discover -s tests -p "test_*.py"
  - Output:
    .\n----------------------------------------------------------------------\nRan 1 test in 0.000s\nOK
  - Time of verification: 2025-11-09 14:05 (local).
  - The temporary tests/ directory has been deleted; only this guidelines file remains.

Guidelines for Future Tests
- Avoid live OpenAI calls in tests. Provide an injectable client interface and use a fake/mock that returns deterministic responses.
- Timeouts and retries: make them configurable and short under tests to keep suites fast.
- Golden files: for long-form text transforms, consider storing expected outputs under tests/golden/. Normalize whitespace to reduce flakiness.
- Randomness: seed any random generators; pass deterministic seeds into LLM sampling wrappers under tests.

Additional Development Information
Code Style and Quality
- Follow PEP 8 and PEP 484 typing, aim for mypy clean in core modules.
- Recommended tooling (to be added): ruff for lint/format; black for formatting; pre-commit hooks.

API/Client Architecture Suggestions
- Encapsulate OpenAI access behind a small adapter:
  class LLMClient:
      async def complete(self, prompt: str, **opts) -> str: ...
- Keep prompt templates versioned and testable; include fixtures with small prompts to validate shaping.

Debugging Tips
- FastAPI:
  - Enable --reload and log_level=debug while developing.
  - Surface detailed validation errors (Pydantic) by validating inputs on boundaries.
- Frontend (HTMX):
  - Verify HTMX requests in the Network tab; partials should render server-side and swap properly.
  - Use hx-boost/hx-swap strategically; return minimal HTML fragments for performance.
- Rate limits and errors:
  - Implement exponential backoff and 429/5xx handling in the LLM client adapter; unit-test the policy with faked time.

Repository Hygiene
- Do not commit real API keys or machine-specific JSON.
- Provide sample configs under config/examples/ with documented fields.
- Keep README.md updated with any changes to app entrypoints and configuration fields.

Open Questions / TODOs
- Add dependency manifest (pyproject.toml or requirements.txt).
- Add initial FastAPI app skeleton, healthcheck, and CI for tests and lint.
- Decide between unittest vs pytest; current docs show unittest commands validated locally.
