# Installation and First Run

Choose the option that matches how you want to use AugmentedQuill:

- **Desktop app (experimental)**: simplest for one person using one computer.
- **Docker**: useful for a home server or NAS; requires Docker.
- **From source**: for developers and contributors.

You do not need an AI provider to open the app or write manually. To use AI features, add a provider in **Settings → Machine Settings** after starting the app. You do not need to enter API keys in a terminal.

## 1. Desktop App (Electron, Experimental)

The desktop app is experimental, but Windows and Linux installers are currently published. It opens AugmentedQuill in its own application window, not your system web browser.

**Install and start:**

1. Open the [Releases](https://github.com/StableLlamaAI/AugmentedQuill/releases) page.
2. Download the installer for your system. Current releases provide a Windows `.exe` installer and a Linux `.AppImage`; a macOS installer is not currently published.
3. On Windows, run the installer and open **AugmentedQuill** from the Start menu. On Linux, open the downloaded AppImage; if your computer asks, allow it to run as an application.
4. AugmentedQuill opens in its own window. Your projects and settings are saved in the app's folder under your operating system's application-data location, not beside the installer. See [Where Your Data Is Stored](#where-your-data-is-stored) for how to find and back it up.

---

## 2. Docker (Home Server or NAS)

If you run a home server, NAS, or just prefer keeping your applications containerized, you can use Docker. This avoids installing Python or Node.js on your host machine.

**Prerequisites:**

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose installed.

**Install and start:**

1. Install Docker Engine with the Docker Compose plugin, or install Docker Desktop.
2. Create a folder for AugmentedQuill on the server. Download `docker-compose.yml` from this repository into that folder.
3. Open a terminal in that folder and run:

   ```bash
   docker compose up -d
   ```

   Docker downloads the published image and starts the app. The first start creates a `data/` folder beside `docker-compose.yml`; the app saves its projects and settings there. The Compose file does not require the source code or a Dockerfile.

4. On the same computer, open [http://localhost:8000](http://localhost:8000). From another device on your private network, use `http://<server-ip>:8000`.

AugmentedQuill has no built-in login or access control. Do not expose port `8000` to the public internet; use it only on a trusted computer or private network unless you add your own authentication and access controls.

To stop the app without deleting your work, run `docker compose down` in the same folder. Start it again with `docker compose up -d`. Your work remains in `data/`.

If you prefer not to use Compose, run this from the folder where you want the `data/` directory created:

```bash
docker run -d --name augmentedquill \
  -p 8000:8000 \
  -v "$PWD/data:/app/data" \
  ghcr.io/stablellamaai/augmentedquill:latest
```

Do not remove the host `data/` folder when updating or removing the container. Back it up separately. The app’s bundled resources stay inside the image; they are not user settings and are not mounted over by default.

**Docker networking notes for AI providers:**

- **Cloud providers** (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, …) work out of the box — containers reach the internet through the host's NAT. If cloud calls fail, ensure the host has working DNS/egress and isn't blocking the Docker bridge, and pass any required egress proxy through with `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` environment variables.
- **A provider running on the same host** (e.g. Ollama on `localhost:11434`) is **not** reachable via `localhost` from inside the container (that points at the container itself). Add `extra_hosts: ["host.docker.internal:host-gateway"]` to the service and use `http://host.docker.internal:11434/v1` as the base URL.
- **A provider running in another container** can be reached by its service/container name on a shared network (e.g. `http://ollama:11434/v1`) or via the Docker bridge gateway (`http://172.17.0.1:11434/v1`).
- For full troubleshooting steps, see [Troubleshooting & FAQ](docs/user_manual/13_troubleshooting.md#25-docker--container-networking-llm-providers-unreachable).

---

## 3. Developer Setup (From Source)

If you want to modify the code, contribute to the project, or just prefer running things from source, follow these steps.

**Prerequisites:**

- Python 3.12+
- Node.js 24+
- Git

**Installation:**

1. Clone the repository:

   ```bash
   git clone https://github.com/StableLlamaAI/AugmentedQuill.git
   cd AugmentedQuill
   ```

2. Set up the Python backend:

   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows use: venv\Scripts\activate
   pip install -e ".[dev]"
   ```

3. Build the frontend:

   ```bash
   cd src/frontend
   npm install
   npm run build
   cd ../..
   ```

4. Run the application:
   ```bash
   augmentedquill --host 127.0.0.1 --port 8000
   ```
   Then open `http://127.0.0.1:8000` in your browser.

By default, a source install stores runtime data in the repository's `data/` folder. Do not use this development folder as the only copy of important writing; back it up separately.

For hot-reloading during development, see the Development Workflow section in the [Developer Guide](DEVELOPMENT.md).

## Where Your Data Is Stored

The `data/` folder is the important folder to keep and back up. Its location depends on how you installed the app:

| Install type               | Host folder containing your data                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Desktop app (Electron)     | The AugmentedQuill folder under your OS application-data location (Windows: `%APPDATA%`; Linux: `~/.config`) |
| Docker Compose             | `data/` beside `docker-compose.yml`                                                                          |
| `docker run` command above | `data/` in the folder where you ran the command                                                              |
| From source                | `data/` in the repository by default                                                                         |

Inside `data/`:

- `config/machine.json` stores machine-wide settings, including model providers.
- `config/projects.json` remembers the current and recently used projects.
- `config/story.json` is a default/legacy story configuration used when no project-specific file is available. For normal writing, the active project's own `story.json` is the one that matters.
- `projects/<project-name>/` contains each project. Its `story.json` stores project metadata and project-specific settings; chapters, books, Sourcebook entries, images, and other project content are stored in that same project folder.
- `logs/` contains runtime logs.

For the desktop app, open the application-data location above and look for the `AugmentedQuill` folder. On Windows, press **Windows key + R**, enter `%APPDATA%`, and press **Enter**. On Linux, open your Home folder, show hidden files, and open `.config`.

For normal use, change settings in the app rather than editing these files: use **Settings → Machine Settings** for model providers and the **Projects** tab to create, import, export, or delete projects. Edit files directly only if you understand JSON and have made a backup first. The app may validate, normalize, or migrate project files when it opens them.

Some display and layout preferences are stored in the browser's local storage for the address you use to open AugmentedQuill. They are not part of the server's `data/` backup.

`resources/config/` is different: it contains bundled application resources such as model presets and AI instruction text. It is not where the app saves Machine Settings or projects. The default Docker setup keeps these bundled resources inside the image.

### Optional advanced path overrides

Most users should leave these unchanged. `AUGQ_USER_DATA_DIR` moves the runtime data root; by default, the projects folder is inside it. `AUGQ_PROJECTS_ROOT` moves only the projects folder. `AUGQ_PROJECTS_REGISTRY`, `AUGQ_MACHINE_CONFIG_PATH`, and `AUGQ_STORY_CONFIG_PATH` can override individual file paths. If you change paths in Docker, bind-mount those host folders into the container too, or the data may not survive container replacement.

### Branching notes for contributors

When contributing, branch from `develop` and open pull requests against `develop` (unless the change is an urgent fix to `main`).

- Feature branches: `feature/<short-desc>`
- Release branches: `release/vX.Y` (short-lived)
- Hotfix branches: `hotfix/vX.Y.Z` (branch from `main`)

The `main` branch always reflects the last release; `develop` is the integration branch used for ongoing development.
