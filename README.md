# AugmentedQuill
Web GUI for LLM assisted prose writing

The project is using Python with FastAPI on the backend and HTMX with Alpine.js
on the frontend. The LLMs are accessed via the OpenAI API.

The project features a simple user interface for writing prose like novels.
They can be short with a few paragraphs or long with a few hundred paragraphs
in multiple chapters.

There are settings for machine-specific environment (like how to access the
OpenAI API) and there are story-specific settings in a separate config file.
All configuration is done via JSON files.

The GUI is an interactive web page that can be accessed via a web browser.
In the main window the story or the current chapter is displayed. In the
sidebar the user can select the other chapters. The user can also select to
view the text as it is (raw) or as a formatted markdown text.

There is also an option to switch the main window to a simple chat with the
currently selected LLM.


## Quickstart

- Python 3.11+ recommended.
- Create and activate a virtual environment:
  - python3 -m venv .venv
  - source .venv/bin/activate
- Install dependencies:
  - pip install -r requirements.txt

## Running the API

This repository includes a minimal FastAPI app with a healthcheck endpoint and a rudimentary GUI.

Option A) Start via normal Python file (provides --help):
- python -m app.main --help
- python -m app.main --host 127.0.0.1 --port 8000 --reload

Option B) Start with uvicorn CLI directly:
- uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

Verify it is up:
- curl http://127.0.0.1:8000/health → {"status":"ok"}

Open the GUI in your browser:
- http://127.0.0.1:8000/
- Click the Refresh button to fetch a live status fragment via HTMX; the server time should update.

## Configuration

Configuration is JSON-based with environment variable precedence and interpolation.

- Machine-specific config (API credentials/endpoints): config/machine.json
- Story-specific config (active project): config/story.json
- Environment variables always override JSON values. JSON may include placeholders like ${OPENAI_API_KEY}.

Sample files can be found under config/examples/:
- config/examples/machine.json
- config/examples/story.json

Machine config supports multiple OpenAI model endpoints:
- openai.models: array of endpoints with fields {name, base_url, api_key, model, timeout_s}
- openai.selected: the name of the active endpoint
- Legacy single fields (openai.api_key/base_url/model/timeout_s) are kept in sync with the selected endpoint for backward compatibility.

In the Settings UI, you can add multiple endpoints, test availability, and load the list of remote models from an endpoint, then select which to use. All calls to the OpenAI API are done from the browser, not the backend.

Environment variables recognized for OpenAI (legacy/selected mirror):
- OPENAI_API_KEY
- OPENAI_BASE_URL
- OPENAI_MODEL
- OPENAI_TIMEOUT_S

Note: Direct browser access to third-party APIs requires proper CORS headers from the API. If your endpoint does not allow browser calls from your origin, you will need to configure an allowed origin or use a CORS-enabled proxy under your control.

### CORS and model loading
The Settings UI tries to load models directly from your OpenAI-compatible endpoint in the browser. If that direct call is blocked by CORS, the UI will automatically fall back to a same-origin proxy endpoint provided by this app:
- POST /api/openai/models with JSON body: {"base_url":"...","api_key":"...","timeout_s":60}
- The server fetches `${base_url}/models` and relays the JSON back to the browser.

This keeps your API key client-provided for development purposes while avoiding cross-origin limitations. For production, prefer configuring your endpoint to allow your app's origin or place a controlled proxy in front of it.

## Tests

- Run unit tests using unittest discovery:
  - python3 -m unittest discover -s tests -p "test_*.py" -v

Notes:
- Current tests focus on configuration parsing and do not call external services.
- Avoid committing real secrets. Use environment variables or placeholders.
