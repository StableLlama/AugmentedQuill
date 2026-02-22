# AugmentedQuill

**NOTE:** This project is under heavy development. Do not try to use it for any productive work.

> **Important:** The main base for this code has moved to the GitHub project [StableLlamaAI/AugmentedQuill](https://github.com/StableLlamaAI/AugmentedQuill). The repository `StableLlama/AugmentedQuill` is now a fork of it.

<img src="static/images/logo_2048.png" alt="Augmented Quill - Your Words, Amplified" width="1024">

**AugmentedQuill** is a modern, web-based GUI for AI-assisted prose writing. It leverages Large Language Models (LLMs) via the OpenAI-compatible API to act as a writing partner, editor, and continuation engine.

It is designed for writers who want to maintain creative control while using AI to overcome writer's block, brainstorm ideas, or edit text.

## Features

- **Project Management**: Organize your work into projects.
- **Chapter-Based Writing**: Structure your story with multiple chapters.
- **Dual View Modes**:
  - **Raw**: Distraction-free text editing.
  - **Visual**: Markdown-rendered reading view.
- **AI Writing Partner**: A dedicated chat interface ("Writing Partner") to brainstorm, ask questions about your story, or get feedback.
- **Smart Editing Tools**:
  - **Text Generation**: Continue writing from where you left off.
  - **Prompt Overrides**: Customize system prompts for different AI personas (Editor, Writer, Chat).
- **Sourcebook Management**: Maintain a knowledge base of characters, locations, lore, items, organizations, and events with rich metadata, synonyms, and image associations.
- **Chat Session Management**: Save, load, and organize your conversations with the AI. Includes incognito mode for private chats that aren't saved to disk.
- **Web Search Integration**: Enable the AI to search the web for real-time information during conversations to enhance research and world-building.
- **Enhanced Metadata**: Track chapter conflicts, detailed notes, private notes, and comprehensive project information with advanced editing tools.
- **Visual Helpers**: Toggle whitespace characters to spot layout issues.
- **LLM Request Logging**: Debug and monitor AI interactions with detailed request/response logging (optional, for development).
- **Dark/Light Mode**: Fully themable UI.

## Project Types

AugmentedQuill supports three project types to accommodate different writing needs:

- **Short Story**: No chapters - perfect for short stories, poems, or notes. Content is stored in a single file.
- **Novel**: Multiple chapters - standard novel structure with sequential chapters.
- **Series**: Multiple books - epic sagas organized into multiple books, each containing chapters.

You can convert between project types in the Settings panel, with validation to prevent data loss (e.g., you cannot convert a multi-chapter novel to a short story).

## Architecture

The application follows a modular FastAPI architecture:

- **Backend**: FastAPI with modular routers for different API endpoints (Python 3.11+).
- **Frontend**: React SPA served by FastAPI (built with Vite, TypeScript).
- **Configuration**: JSON-based config files with environment variable support, versioning, and schema validation.
- **LLM Integration**: Client-side integration with OpenAI-compatible APIs (OpenAI, local models like Ollama/vLLM).

## Quickstart

We offer multiple ways to install and run AugmentedQuill, depending on your technical background and how you prefer to use it:

1. **Portable Executable (PyInstaller)**: For artists and authors who want to double-click an app and start writing in their own web browser.
2. **Standalone Desktop App (Electron)**: For those who prefer a complete, isolated desktop application experience.
3. **Docker**: For self-hosters and home servers.
4. **Developer Setup**: For those who want to modify the code or run from source.

**Please see our [Installation Guide](INSTALL.md) for detailed instructions on each option.**

### Development Workflow

If you want to modify the frontend and see changes on the fly:

1.  **Install Dev Dependencies**:

    ```bash
    pip install -e ".[dev]"
    cd src/frontend && npm install
    ```

2.  **Run in Development Mode**:
    - **Option A (VS Code)**: Use the "Full Stack Dev" launch configuration. This starts the backend and the frontend dev server automatically.
    - **Option B (Terminal)**:
      - Terminal 1 (Backend): `augmentedquill --reload`
      - Terminal 2 (Frontend): `cd src/frontend && npm run dev`
    - Open http://127.0.0.1:28001 (Vite Dev Server) for hot-reloading. API requests are proxied to port 28000.

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

In the Settings UI, you can add multiple endpoints, test availability, and load the list of remote models from an endpoint, then select which to use. All calls to the OpenAI API are done from the browser, not the backend.

Environment variables recognized for OpenAI:

- OPENAI_API_KEY
- OPENAI_BASE_URL
- OPENAI_MODEL
- OPENAI_TIMEOUT_S

Note: Direct browser access to third-party APIs requires proper CORS headers from the API. If your endpoint does not allow browser calls from your origin, you will need to configure an allowed origin or use a CORS-enabled proxy under your control.

### CORS and model loading

The Settings UI tries to load models directly from your OpenAI-compatible endpoint in the browser. If that direct call is blocked by CORS, the UI will automatically fall back to a same-origin proxy endpoint provided by this app:

- POST /api/v1/openai/models with JSON body: {"base_url":"...","api_key":"...","timeout_s":60}
- The server fetches `${base_url}/models` and relays the JSON back to the browser.

This keeps your API key client-provided for development purposes while avoiding cross-origin limitations. For production, prefer configuring your endpoint to allow your app's origin or place a controlled proxy in front of it.

## Tests

After installing with dev dependencies, run tests:

- `source venv/bin/activate && pytest`

Notes:

- Current tests focus on configuration parsing and do not call external services.
- Avoid committing real secrets. Use environment variables or placeholders.

## License

This project is licensed under the GNU General Public License v3.0 (GPLv3). See the [LICENSE](LICENSE) file for details.

Copyright (C) 2026 StableLlama

## Project Image Settings

AugmentedQuill allows you to manage reference images for your story. You can upload images, generate descriptions for them using Vision models, and create highly optimized art prompts for generation.

To maintain visual consistency across your project, you can configure **Project Image Settings**:

1.  Open the **Images** panel (Image icon in the sidebar).
2.  Expand the **Project Image Settings** section at the top.
3.  **Global Style**: Define a consistent art style (e.g., "Cyberpunk", "Oil Painting", "Watercolor"). This style will be prioritized in all generated prompts.
4.  **Additional Information**: Add specific technical parameters or LoRA triggers (e.g., "<lora:my_style:0.8>, dark lighting, no humans"). These details are appended to the generation prompt to ensure your specific generation pipeline rules are followed.

When you click "Create Prompt" for an image, the AI will intelligently fuse your image's specific description with your global style and additional parameters into a single, optimized prompt line.

## Branching Strategy

This repository uses a simple Git Flow variant to keep releases stable while allowing ongoing development:

- `main` — the stable branch that always reflects the last tagged release. Protected; merges to `main` should be done only via reviewed PRs and after passing CI.
- `develop` — the integration branch for ongoing development. Feature branches are branched from and merged into `develop`.
- `release/vX.Y` — short-lived release candidate branches created from `develop` when preparing a release.
- `hotfix/vX.Y.Z` — branch from `main` for urgent fixes; merge back into both `main` and `develop`.
- `feature/<short-desc>` — feature branches off `develop`.

Workflow summary:

1. Develop features on `feature/*` branches and open PRs against `develop`.
2. When ready, create `release/vX.Y` from `develop`, finalize tests and fixes, then merge into `main` and tag `vX.Y`.
3. Merge the release back into `develop` if any release-specific changes were made.
4. For urgent fixes, create `hotfix/*` from `main`, merge into `main` and `develop`, and tag as appropriate.

See CONTRIBUTING.md for PR and review requirements.
